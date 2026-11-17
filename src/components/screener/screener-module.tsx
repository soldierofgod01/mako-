"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Columns3, Search, Star } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { TokenIcon } from "@/components/scanner/token-icon";
import { PRESETS, sortRows, type PresetId, type ScreenerRow } from "@/lib/screener/build";
import type { MarketStance } from "@/lib/bias/scan";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Screener — Orion-scale table: 14px values, 44px rows, wide columns,
// horizontal scroll with the Market column pinned. Two views:
//   Market      price path, price & OI change across timeframes,
//               volume, volatility, funding
//   Positioning sharps vs donors, vs-market, nearest liquidations
// Columns can be dragged to reorder and hidden; favourites, column
// order and funding unit persist in localStorage.
// ════════════════════════════════════════════════════════════════

interface Resp {
  rows: ScreenerRow[];
  historyMinutes: number;
  market: MarketStance;
  fetchedAt: number;
}

type View = "market" | "positioning";
type Align = "left" | "right";
type FundUnit = "1h" | "8h" | "apr";
type Preset = PresetId | "favs";

interface Ctx { fund: FundUnit }
interface Col {
  id: string;
  label: string;
  title?: string;
  view: View | "both";
  align: Align;
  w: string; // min width
  sort?: keyof ScreenerRow;
  optional?: boolean;
  cell: (r: ScreenerRow, ctx: Ctx) => React.ReactNode;
}

// Screener-only change colours: brighter than the app's emerald so moves
// pop at a glance, but kept off the brand mint (#33FFA3) so the two greens
// don't blur together.
const UP = "text-[#0ECB81]";
const DN = "text-[#F6465D]";
const UP_HEX = "#0ECB81";
const DN_HEX = "#F6465D";

// ─── Formatting ───
const usd = (x: number) => {
  const a = Math.abs(x);
  if (a >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(x / 1e3).toFixed(0)}K`;
  return `$${x.toFixed(0)}`;
};
const price = (p: number) => {
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (p >= 1) return p.toFixed(p >= 100 ? 2 : 3);
  if (p >= 0.01) return p.toFixed(4);
  return p.toPrecision(4);
};
const Dash = () => <span className="text-txt-dim">—</span>;

function Pct({ v, digits = 2 }: { v: number | null; digits?: number }) {
  if (v == null || !isFinite(v)) return <Dash />;
  return <span className={v > 0 ? UP : v < 0 ? DN : "text-txt-secondary"}>{v > 0 ? "+" : ""}{v.toFixed(digits)}%</span>;
}
function Lean({ net, n }: { net: number | null; n: number }) {
  if (net == null || n === 0) return <Dash />;
  const p = Math.round(net * 100);
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className={p > 10 ? UP : p < -10 ? DN : "text-txt-secondary"}>{p > 10 ? `${p}% L` : p < -10 ? `${-p}% S` : "flat"}</span>
      <span className="text-txt-muted text-[12px]">{n}</span>
    </span>
  );
}
const signed = (v: number | null) =>
  v == null ? <Dash /> : <span className={v >= 25 ? UP : v <= -25 ? DN : "text-txt-secondary"}>{v > 0 ? "+" : ""}{v}</span>;

function fundingText(r: ScreenerRow, u: FundUnit) {
  const v = u === "1h" ? r.funding8h / 8 : u === "8h" ? r.funding8h : r.fundingApr;
  const d = u === "apr" ? 1 : u === "1h" ? 5 : 4;
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
}

function Spark({ pts }: { pts: number[] }) {
  if (pts.length < 3) return <span className="text-txt-dim text-[12px]">building…</span>;
  const W = 112, H = 30, pad = 2;
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const span = hi - lo || hi * 0.001 || 1;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const up = pts[pts.length - 1] >= pts[0];
  const c = up ? UP_HEX : DN_HEX;
  const id = `g${up ? "u" : "d"}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="inline-block align-middle">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity="0.22" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${W},${H}L0,${H}Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const COLS: Col[] = [
  { id: "price", label: "Price", view: "both", align: "right", w: "min-w-[120px]", sort: "price", cell: (r) => <span className="text-txt-primary">{price(r.price)}</span> },
  {
    id: "spark", label: "24h chart", title: "Price over the last 24h (30-min steps)", view: "market", align: "right", w: "min-w-[140px]", optional: true,
    cell: (r) => <Spark pts={r.spark} />,
  },
  { id: "chg15m", label: "15m", view: "market", align: "right", w: "min-w-[96px]", sort: "chg15m", optional: true, cell: (r) => <Pct v={r.chg15m} /> },
  { id: "chg1h", label: "1h", view: "market", align: "right", w: "min-w-[96px]", sort: "chg1h", optional: true, cell: (r) => <Pct v={r.chg1h} /> },
  { id: "chg4h", label: "4h", view: "market", align: "right", w: "min-w-[96px]", sort: "chg4h", optional: true, cell: (r) => <Pct v={r.chg4h} /> },
  { id: "chg24h", label: "24h", view: "both", align: "right", w: "min-w-[100px]", sort: "chg24h", cell: (r) => <Pct v={r.chg24h} /> },
  { id: "vol", label: "Volume 24h", view: "market", align: "right", w: "min-w-[130px]", sort: "volume24h", optional: true, cell: (r) => <span className="text-txt-primary">{usd(r.volume24h)}</span> },
  {
    id: "relvol", label: "Rel. vol", title: "24h volume ÷ its average over Mako's history", view: "market", align: "right", w: "min-w-[104px]", sort: "relVol", optional: true,
    cell: (r) => r.relVol == null ? <Dash /> : <span className={r.relVol >= 2 ? "text-warning" : "text-txt-secondary"}>{r.relVol.toFixed(2)}×</span>,
  },
  {
    id: "vol1h", label: "Volatility 1h", title: "Realised volatility: stdev of 5-min returns over the last hour, scaled to 1h", view: "market", align: "right", w: "min-w-[130px]", sort: "vol1h", optional: true,
    cell: (r) => r.vol1h == null ? <Dash /> : <span className="text-txt-primary">{r.vol1h.toFixed(2)}%</span>,
  },
  { id: "oi", label: "Open interest", view: "market", align: "right", w: "min-w-[136px]", sort: "oiUsd", optional: true, cell: (r) => <span className="text-txt-primary">{usd(r.oiUsd)}</span> },
  { id: "oi1h", label: "OI 1h", title: "Change in contracts (positions), not USD", view: "market", align: "right", w: "min-w-[96px]", sort: "oiChg1h", optional: true, cell: (r) => <Pct v={r.oiChg1h} /> },
  { id: "oi4h", label: "OI 4h", title: "Change in contracts (positions), not USD", view: "market", align: "right", w: "min-w-[96px]", sort: "oiChg4h", optional: true, cell: (r) => <Pct v={r.oiChg4h} /> },
  { id: "oi24h", label: "OI 24h", title: "Change in contracts (positions), not USD", view: "market", align: "right", w: "min-w-[100px]", sort: "oiChg24h", optional: true, cell: (r) => <Pct v={r.oiChg24h} /> },
  {
    id: "oivol", label: "OI / Vol", title: "Open interest ÷ 24h volume. High = positions held (sticky, squeeze fuel). Low = mostly churn.", view: "market", align: "right", w: "min-w-[104px]", sort: "oiVolRatio", optional: true,
    cell: (r) => r.oiVolRatio == null ? <Dash /> : <span className="text-txt-secondary">{r.oiVolRatio.toFixed(2)}</span>,
  },
  {
    id: "funding", label: "Funding", view: "both", align: "right", w: "min-w-[124px]", sort: "funding8h",
    cell: (r, { fund }) => (
      <span className={r.funding8h > 0.03 ? "text-warning" : r.funding8h < -0.01 ? "text-[#60A5FA]" : "text-txt-secondary"}>{fundingText(r, fund)}</span>
    ),
  },
  { id: "sharps", label: "Sharps", title: "Top profitable active HL wallets · net lean · wallet count", view: "positioning", align: "right", w: "min-w-[130px]", sort: "sharpsNet", cell: (r) => <Lean net={r.sharpsNet} n={r.sharpsN} /> },
  { id: "donors", label: "Donors", title: "Biggest active losers · net lean · wallet count", view: "positioning", align: "right", w: "min-w-[130px]", sort: "donorsNet", cell: (r) => <Lean net={r.donorsNet} n={r.donorsN} /> },
  { id: "div", label: "Divergence", title: "Sharps vs donors, −100…+100", view: "positioning", align: "right", w: "min-w-[120px]", sort: "divergence", cell: (r) => signed(r.divergence) },
  { id: "rel", label: "vs mkt", title: "Divergence minus the sharps' market-wide average", view: "positioning", align: "right", w: "min-w-[100px]", sort: "relative", cell: (r) => signed(r.relative) },
  {
    id: "liq", label: "Nearest liqs", title: "Closest tracked-wallet liquidation cluster within 25%", view: "positioning", align: "right", w: "min-w-[160px]", sort: "liqDistPct",
    cell: (r) => r.liqDistPct == null ? <Dash /> : (
      <span className="inline-flex items-baseline gap-2">
        <span className={r.liqSide === "long" ? "text-warning" : "text-[#60A5FA]"}>{r.liqDistPct > 0 ? "+" : ""}{r.liqDistPct.toFixed(1)}%</span>
        <span className="text-txt-muted text-[12px]">{usd(r.liqUsd ?? 0)}</span>
      </span>
    ),
  },
  {
    id: "pos", label: "Positioning", title: "Sharps vs donors + funding crowding, −100…+100", view: "positioning", align: "right", w: "min-w-[130px]", sort: "positioning",
    cell: (r) => <span className={cn("font-semibold", r.positioning >= 20 ? UP : r.positioning <= -20 ? DN : "text-txt-secondary")}>{r.positioning > 0 ? "+" : ""}{r.positioning}</span>,
  },
];
const DEFAULT_ORDER = COLS.map((c) => c.id);

// ─── localStorage helpers ───
function load<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function save(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

export function ScreenerModule() {
  const { setBiasCoin, setActiveModule } = useAppStore();
  const [view, setView] = useState<View>("market");
  const [preset, setPreset] = useState<Preset>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: keyof ScreenerRow; dir: 1 | -1 }>({ key: "volume24h", dir: -1 });
  const [hidden, setHidden] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  const [favs, setFavs] = useState<string[]>([]);
  const [fund, setFund] = useState<FundUnit>("8h");
  const [drag, setDrag] = useState<{ from: string; over: string | null } | null>(null);

  useEffect(() => {
    setHidden(load<string[]>("mako:screener:hidden", []));
    const v = load<string>("mako:screener:view", "market");
    if (v === "market" || v === "positioning") setView(v);
    const o = load<string[]>("mako:screener:order", DEFAULT_ORDER).filter((id) => DEFAULT_ORDER.includes(id));
    setOrder([...o, ...DEFAULT_ORDER.filter((id) => !o.includes(id))]);
    setFavs(load<string[]>("mako:screener:favs", []));
    const f = load<string>("mako:screener:fund", "8h");
    if (f === "1h" || f === "8h" || f === "apr") setFund(f);
  }, []);

  const setHiddenSaved = (h: string[]) => { setHidden(h); save("mako:screener:hidden", h); };
  const setViewSaved = (v: View) => {
    setView(v);
    setSort(v === "positioning" ? { key: "positioning", dir: -1 } : { key: "volume24h", dir: -1 });
    save("mako:screener:view", v);
  };
  const setFundSaved = (f: FundUnit) => { setFund(f); save("mako:screener:fund", f); };
  const toggleFav = (coin: string) => {
    setFavs((cur) => {
      const next = cur.includes(coin) ? cur.filter((c) => c !== coin) : [...cur, coin];
      save("mako:screener:favs", next);
      return next;
    });
  };
  const moveCol = (from: string, to: string) => {
    if (from === to) return;
    setOrder((cur) => {
      const next = cur.filter((id) => id !== from);
      next.splice(next.indexOf(to), 0, from);
      save("mako:screener:order", next);
      return next;
    });
  };
  const resetCols = () => { setOrder(DEFAULT_ORDER); setHiddenSaved([]); save("mako:screener:order", DEFAULT_ORDER); };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["screener-v3"],
    queryFn: async (): Promise<Resp> => {
      const r = await fetch("/api/screener");
      if (!r.ok) throw new Error("screener");
      return r.json();
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const byId = useMemo(() => new Map(COLS.map((c) => [c.id, c])), []);
  const cols = order.map((id) => byId.get(id)!).filter((c) => c && (c.view === "both" || c.view === view) && !hidden.includes(c.id));
  const total = data?.rows.length ?? 0;
  const rows = useMemo(() => {
    const s = q.trim().toUpperCase();
    const match = preset === "favs" ? (r: ScreenerRow) => favs.includes(r.coin) : (PRESETS.find((x) => x.id === preset) ?? PRESETS[0]).match;
    const filtered = (data?.rows ?? []).filter((r) => match(r) && (!s || r.symbol.includes(s) || r.coin.includes(s)));
    return sortRows(filtered, sort.key, sort.dir);
  }, [data, preset, q, sort, favs]);

  const choosePreset = (id: Preset) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (p?.sort) setSort(p.sort);
  };
  const clickSort = (key: keyof ScreenerRow | undefined, align: Align) => {
    if (!key) return;
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: align === "left" ? 1 : -1 }));
  };
  const open = (coin: string) => { setBiasCoin(coin); setActiveModule("terminal"); };

  const hist = data?.historyMinutes ?? 0;
  const histNote = hist < 24 * 60
    ? `Timeframe, OI-change and 24h-chart columns fill as Mako's own history builds · ${hist < 60 ? `${hist}m` : `${Math.floor(hist / 60)}h ${hist % 60}m`} of 24h collected`
    : null;
  const sortIcon = (k?: keyof ScreenerRow) =>
    k && sort.key === k ? (sort.dir === -1 ? <ArrowDown className="w-3.5 h-3.5 text-txt-primary" /> : <ArrowUp className="w-3.5 h-3.5 text-txt-primary" />) : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-base">
      {/* Toolbar — title, views, search, funding unit, columns */}
      <div className="h-16 shrink-0 flex items-center gap-6 px-6 border-b border-border">
        <span className="text-[20px] font-semibold tracking-[-0.02em] text-txt-primary">Screener</span>
        <div className="flex items-center h-full gap-5">
          {(["market", "positioning"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setViewSaved(v)}
              className={cn(
                "h-full text-[15px] font-medium capitalize border-b-2 -mb-px transition-colors",
                view === v ? "text-txt-primary border-txt-primary" : "text-txt-muted border-transparent hover:text-txt-primary"
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2.5 h-10 px-3.5 rounded-lg border border-border-strong bg-panel w-[280px] focus-within:border-txt-muted">
            <Search className="w-4 h-4 text-txt-muted shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search markets" className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-txt-primary placeholder:text-txt-muted" />
            <span className="ds-num text-[12.5px] text-txt-muted shrink-0">{rows.length}/{total}</span>
          </div>
          <div className="flex items-center h-10 rounded-lg border border-border-strong p-1" title="Funding rate unit">
            {(["1h", "8h", "apr"] as FundUnit[]).map((u) => (
              <button
                key={u}
                onClick={() => setFundSaved(u)}
                className={cn("h-full px-3 rounded-md text-[13px] font-medium", fund === u ? "bg-elevated-2 text-txt-primary" : "text-txt-muted hover:text-txt-primary")}
              >
                {u === "apr" ? "APR" : u}
              </button>
            ))}
          </div>
          <ColumnPicker view={view} hidden={hidden} setHidden={setHiddenSaved} reset={resetCols} />
        </div>
      </div>

      {/* Preset pills */}
      <div className="h-14 shrink-0 flex items-center gap-2 px-6 border-b border-border overflow-x-auto">
        <PresetPill active={preset === "favs"} onClick={() => choosePreset("favs")} hint="Markets you've starred">
          <Star className={cn("w-3.5 h-3.5", preset === "favs" ? "fill-warning text-warning" : "")} />
          Favourites{favs.length ? <span className="text-txt-muted ds-num">{favs.length}</span> : null}
        </PresetPill>
        <span className="w-px h-5 bg-border mx-1 shrink-0" />
        {PRESETS.map((p) => (
          <PresetPill key={p.id} active={preset === p.id} onClick={() => choosePreset(p.id)} hint={p.hint}>{p.label}</PresetPill>
        ))}
      </div>

      {(histNote || (view === "positioning" && data?.market?.baseline != null)) && (
        <div className="shrink-0 px-6 h-10 flex items-center gap-6 border-b border-border text-[13px] text-txt-muted">
          {view === "positioning" && data?.market?.baseline != null && (
            <span>
              Market baseline <span className={cn("ds-num font-semibold", data.market.baseline <= -20 ? DN : data.market.baseline >= 20 ? UP : "text-txt-primary")}>{data.market.baseline > 0 ? "+" : ""}{data.market.baseline}</span>
              {" "}· sharps net short on {Math.round(data.market.sharpsShortShare * 100)}% of coins — read <span className="text-txt-secondary">vs mkt</span> for the coin-specific signal
            </span>
          )}
          {histNote && view === "market" && <span>{histNote}</span>}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 ds-num text-[14px]">
          <thead className="sticky top-0 z-20">
            <tr className="h-11">
              <th
                onClick={() => clickSort("coin", "left")}
                className="sticky left-0 z-30 bg-bg-base border-b border-border min-w-[230px] pl-6 pr-4 text-left text-[12px] font-semibold uppercase tracking-[0.05em] text-txt-muted select-none cursor-pointer hover:text-txt-primary"
              >
                <span className="inline-flex items-center gap-1.5">Market {sortIcon("coin")}</span>
              </th>
              {cols.map((c) => (
                <th
                  key={c.id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDrag({ from: c.id, over: null }); }}
                  onDragOver={(e) => { if (!drag) return; e.preventDefault(); if (drag.over !== c.id) setDrag({ ...drag, over: c.id }); }}
                  onDrop={(e) => { e.preventDefault(); if (drag) moveCol(drag.from, c.id); setDrag(null); }}
                  onDragEnd={() => setDrag(null)}
                  onClick={() => clickSort(c.sort, c.align)}
                  title={c.title ? `${c.title} · drag to reorder` : "Drag to reorder"}
                  className={cn(
                    "bg-bg-base border-b border-border px-4 text-[12px] font-semibold uppercase tracking-[0.05em] text-txt-muted select-none whitespace-nowrap",
                    c.w,
                    c.align === "right" ? "text-right" : "text-left",
                    c.sort ? "cursor-pointer hover:text-txt-primary" : "cursor-grab",
                    drag?.from === c.id && "opacity-40",
                    drag?.over === c.id && drag.from !== c.id && "shadow-[inset_2px_0_0_0_var(--color-accent)]"
                  )}
                >
                  <span className={cn("inline-flex items-center gap-1.5", c.align === "right" && "flex-row-reverse")}>
                    {c.id === "funding" ? `Funding ${fund === "apr" ? "APR" : fund}` : c.label}
                    {sortIcon(c.sort)}
                  </span>
                </th>
              ))}
              <th className="bg-bg-base border-b border-border w-full" />
            </tr>
          </thead>
          <tbody>
            {isError ? (
              <tr><td colSpan={cols.length + 2} className="py-20 text-center text-txt-muted">Couldn&rsquo;t load markets. Retrying…</td></tr>
            ) : isLoading ? (
              Array.from({ length: 14 }).map((_, i) => (
                <tr key={i} className="h-11"><td colSpan={cols.length + 2} className="px-6 border-b border-border"><div className="h-3.5 w-full skeleton" /></td></tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={cols.length + 2} className="py-20 text-center text-txt-muted">
                {preset === "favs" ? "No favourites yet — star a market to pin it here." : "Nothing matches this screen right now."}
              </td></tr>
            ) : (
              rows.map((r) => {
                const fav = favs.includes(r.coin);
                return (
                  <tr key={r.coin} onClick={() => open(r.coin)} className="group h-11 cursor-pointer">
                    <td className="sticky left-0 z-10 bg-bg-base group-hover:bg-panel border-b border-border pl-3 pr-4 whitespace-nowrap">
                      <span className="flex items-center gap-2.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleFav(r.coin); }}
                          title={fav ? "Remove from favourites" : "Add to favourites"}
                          className="w-7 h-7 -mr-0.5 flex items-center justify-center rounded hover:bg-elevated"
                        >
                          <Star className={cn("w-4 h-4", fav ? "fill-warning text-warning" : "text-txt-dim group-hover:text-txt-muted")} />
                        </button>
                        <TokenIcon symbol={r.symbol} size={22} />
                        <span className="text-[14.5px] font-semibold text-txt-primary">{r.coin}</span>
                        <span className="px-1.5 py-px rounded bg-elevated text-[11.5px] font-medium text-txt-secondary">{r.maxLeverage}×</span>
                      </span>
                    </td>
                    {cols.map((c) => (
                      <td key={c.id} className={cn("px-4 border-b border-border whitespace-nowrap group-hover:bg-panel", c.align === "right" ? "text-right" : "text-left")}>
                        {c.cell(r, { fund })}
                      </td>
                    ))}
                    <td className="border-b border-border group-hover:bg-panel" />
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <p className="px-6 py-5 text-[13px] text-txt-muted max-w-[960px] leading-[1.6]">
          Hyperliquid perps with $500K+ daily volume. OI change is measured in contracts (positions), not USD, so price moves don&rsquo;t distort it.
          Positioning uses tracked wallets, not the whole market. Drag column headers to reorder. Click any market to open it in the Terminal.
        </p>
      </div>
    </div>
  );
}

function PresetPill({ active, onClick, hint, children }: { active: boolean; onClick: () => void; hint: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={hint}
      className={cn(
        "h-9 px-4 rounded-full text-[13.5px] font-medium whitespace-nowrap inline-flex items-center gap-1.5 border transition-colors shrink-0",
        active ? "bg-elevated-2 border-border-strong text-txt-primary" : "border-transparent text-txt-muted hover:text-txt-primary hover:bg-panel"
      )}
    >
      {children}
    </button>
  );
}

function ColumnPicker({ view, hidden, setHidden, reset }: { view: View; hidden: string[]; setHidden: (h: string[]) => void; reset: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const optional = COLS.filter((c) => c.optional && (c.view === view || c.view === "both"));
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} title="Columns" className={cn("h-10 w-10 rounded-lg border border-border-strong flex items-center justify-center", open ? "bg-elevated text-txt-primary" : "text-txt-muted hover:text-txt-primary")}>
        <Columns3 className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-[230px] rounded-xl border border-border-strong bg-elevated shadow-2xl py-2">
          {optional.length === 0 && <p className="px-4 py-2 text-[13px] text-txt-muted">No optional columns in this view.</p>}
          {optional.map((c) => {
            const isOn = !hidden.includes(c.id);
            return (
              <button key={c.id} onClick={() => setHidden(isOn ? [...hidden, c.id] : hidden.filter((h) => h !== c.id))} className="w-full flex items-center gap-3 px-4 py-2 text-left text-[14px] hover:bg-white/[0.04]">
                <span className={cn("w-4 h-4 rounded-[4px] border", isOn ? "bg-accent border-accent" : "border-border-strong")} />
                <span className="text-txt-primary">{c.label}</span>
              </button>
            );
          })}
          <div className="mx-4 my-1.5 h-px bg-border" />
          <button onClick={reset} className="w-full px-4 py-2 text-left text-[13px] text-txt-muted hover:text-txt-primary">Reset order &amp; columns</button>
        </div>
      )}
    </div>
  );
}
