"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Columns3, Search } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { TokenIcon } from "@/components/scanner/token-icon";
import { PRESETS, sortRows, type PresetId, type ScreenerRow } from "@/lib/screener/build";
import type { MarketStance } from "@/lib/bias/scan";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Screener — Velo / Coinalyze-style dense table. Two views:
//   Market      price & OI change across timeframes, volume, funding
//   Positioning sharps vs donors, vs-market, nearest liquidations
// Click a row to open the coin in the Terminal.
// ════════════════════════════════════════════════════════════════

interface Resp {
  rows: ScreenerRow[];
  historyMinutes: number;
  market: MarketStance;
  fetchedAt: number;
}

type View = "market" | "positioning";
type Align = "left" | "right";

interface Col {
  id: string;
  label: string;
  title?: string;
  view: View | "both";
  align: Align;
  w: string;
  sort?: keyof ScreenerRow;
  optional?: boolean; // can be hidden from the column picker
  cell: (r: ScreenerRow) => React.ReactNode;
}

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
function Pct({ v, digits = 2, muted }: { v: number | null; digits?: number; muted?: boolean }) {
  if (v == null || !isFinite(v)) return <span className="text-txt-dim">—</span>;
  return (
    <span className={cn(muted ? "text-txt-secondary" : v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-txt-secondary")}>
      {v > 0 ? "+" : ""}{v.toFixed(digits)}%
    </span>
  );
}
function Lean({ net, n }: { net: number | null; n: number }) {
  if (net == null || n === 0) return <span className="text-txt-dim">—</span>;
  const p = Math.round(net * 100);
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn(p > 10 ? "text-positive" : p < -10 ? "text-negative" : "text-txt-secondary")}>
        {p > 10 ? `${p}% L` : p < -10 ? `${-p}% S` : "flat"}
      </span>
      <span className="text-txt-dim text-[11px]">{n}</span>
    </span>
  );
}
const signed = (v: number | null) =>
  v == null ? <span className="text-txt-dim">—</span> : (
    <span className={cn(v >= 25 ? "text-positive" : v <= -25 ? "text-negative" : "text-txt-secondary")}>{v > 0 ? "+" : ""}{v}</span>
  );

const COLS: Col[] = [
  {
    id: "coin", label: "Market", view: "both", align: "left", w: "w-[150px]", sort: "coin",
    cell: (r) => (
      <span className="flex items-center gap-2.5">
        <TokenIcon symbol={r.symbol} size={18} />
        <span className="font-medium text-txt-primary">{r.coin}</span>
        <span className="text-[10.5px] text-txt-dim">{r.maxLeverage}×</span>
      </span>
    ),
  },
  { id: "price", label: "Price", view: "both", align: "right", w: "w-[100px]", sort: "price", cell: (r) => <span className="text-txt-primary">{price(r.price)}</span> },
  { id: "chg15m", label: "15m", view: "market", align: "right", w: "w-[72px]", sort: "chg15m", optional: true, cell: (r) => <Pct v={r.chg15m} /> },
  { id: "chg1h", label: "1h", view: "market", align: "right", w: "w-[72px]", sort: "chg1h", optional: true, cell: (r) => <Pct v={r.chg1h} /> },
  { id: "chg4h", label: "4h", view: "market", align: "right", w: "w-[72px]", sort: "chg4h", optional: true, cell: (r) => <Pct v={r.chg4h} /> },
  { id: "chg24h", label: "24h", view: "both", align: "right", w: "w-[76px]", sort: "chg24h", cell: (r) => <Pct v={r.chg24h} /> },
  { id: "vol", label: "Volume 24h", view: "market", align: "right", w: "w-[100px]", sort: "volume24h", optional: true, cell: (r) => <span className="text-txt-secondary">{usd(r.volume24h)}</span> },
  {
    id: "relvol", label: "Rel. vol", title: "24h volume ÷ its average over Mako's history", view: "market", align: "right", w: "w-[76px]", sort: "relVol", optional: true,
    cell: (r) => r.relVol == null ? <span className="text-txt-dim">—</span> : <span className={cn(r.relVol >= 2 ? "text-warning" : "text-txt-secondary")}>{r.relVol.toFixed(2)}×</span>,
  },
  { id: "oi", label: "Open interest", view: "market", align: "right", w: "w-[110px]", sort: "oiUsd", optional: true, cell: (r) => <span className="text-txt-secondary">{usd(r.oiUsd)}</span> },
  { id: "oi1h", label: "OI 1h", title: "Change in contracts (positions), not USD", view: "market", align: "right", w: "w-[72px]", sort: "oiChg1h", optional: true, cell: (r) => <Pct v={r.oiChg1h} /> },
  { id: "oi4h", label: "OI 4h", title: "Change in contracts (positions), not USD", view: "market", align: "right", w: "w-[72px]", sort: "oiChg4h", optional: true, cell: (r) => <Pct v={r.oiChg4h} /> },
  { id: "oi24h", label: "OI 24h", title: "Change in contracts (positions), not USD", view: "market", align: "right", w: "w-[76px]", sort: "oiChg24h", optional: true, cell: (r) => <Pct v={r.oiChg24h} /> },
  {
    id: "funding", label: "Funding 8h", title: "Hover for APR", view: "both", align: "right", w: "w-[92px]", sort: "funding8h",
    cell: (r) => (
      <span title={`${r.fundingApr >= 0 ? "+" : ""}${r.fundingApr.toFixed(1)}% APR`} className={cn(r.funding8h > 0.03 ? "text-warning" : r.funding8h < -0.01 ? "text-[#60A5FA]" : "text-txt-secondary")}>
        {r.funding8h >= 0 ? "+" : ""}{r.funding8h.toFixed(4)}%
      </span>
    ),
  },
  { id: "sharps", label: "Sharps", title: "Top profitable active HL wallets · net lean · wallet count", view: "positioning", align: "right", w: "w-[100px]", sort: "sharpsNet", cell: (r) => <Lean net={r.sharpsNet} n={r.sharpsN} /> },
  { id: "donors", label: "Donors", title: "Biggest active losers · net lean · wallet count", view: "positioning", align: "right", w: "w-[100px]", sort: "donorsNet", cell: (r) => <Lean net={r.donorsNet} n={r.donorsN} /> },
  { id: "div", label: "Divergence", title: "Sharps vs donors, −100…+100", view: "positioning", align: "right", w: "w-[92px]", sort: "divergence", cell: (r) => signed(r.divergence) },
  { id: "rel", label: "vs mkt", title: "Divergence minus the sharps' market-wide average", view: "positioning", align: "right", w: "w-[76px]", sort: "relative", cell: (r) => signed(r.relative) },
  {
    id: "liq", label: "Nearest liqs", title: "Closest tracked-wallet liquidation cluster within 25%", view: "positioning", align: "right", w: "w-[130px]", sort: "liqDistPct",
    cell: (r) => r.liqDistPct == null ? <span className="text-txt-dim">—</span> : (
      <span className="inline-flex items-baseline gap-1.5">
        <span className={r.liqSide === "long" ? "text-warning" : "text-[#60A5FA]"}>{r.liqDistPct > 0 ? "+" : ""}{r.liqDistPct.toFixed(1)}%</span>
        <span className="text-txt-dim text-[11px]">{usd(r.liqUsd ?? 0)}</span>
      </span>
    ),
  },
  {
    id: "pos", label: "Positioning", title: "Sharps vs donors + funding crowding, −100…+100", view: "positioning", align: "right", w: "w-[100px]", sort: "positioning",
    cell: (r) => <span className={cn("font-medium", r.positioning >= 20 ? "text-positive" : r.positioning <= -20 ? "text-negative" : "text-txt-secondary")}>{r.positioning > 0 ? "+" : ""}{r.positioning}</span>,
  },
];

export function ScreenerModule() {
  const { setBiasCoin, setActiveModule } = useAppStore();
  const [view, setView] = useState<View>("market");
  const [preset, setPreset] = useState<PresetId>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: keyof ScreenerRow; dir: 1 | -1 }>({ key: "volume24h", dir: -1 });
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    try {
      const h = localStorage.getItem("mako:screener:hidden");
      if (h) setHidden(JSON.parse(h));
      const v = localStorage.getItem("mako:screener:view");
      if (v === "market" || v === "positioning") setView(v);
    } catch { /* ignore */ }
  }, []);
  const setHiddenSaved = (h: string[]) => { setHidden(h); try { localStorage.setItem("mako:screener:hidden", JSON.stringify(h)); } catch { /* ignore */ } };
  const setViewSaved = (v: View) => {
    setView(v);
    setSort(v === "positioning" ? { key: "positioning", dir: -1 } : { key: "volume24h", dir: -1 });
    try { localStorage.setItem("mako:screener:view", v); } catch { /* ignore */ }
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["screener-v2"],
    queryFn: async (): Promise<Resp> => {
      const r = await fetch("/api/screener");
      if (!r.ok) throw new Error("screener");
      return r.json();
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const cols = COLS.filter((c) => (c.view === "both" || c.view === view) && !hidden.includes(c.id));
  const rows = useMemo(() => {
    const p = PRESETS.find((x) => x.id === preset) ?? PRESETS[0];
    const s = q.trim().toUpperCase();
    const filtered = (data?.rows ?? []).filter((r) => p.match(r) && (!s || r.symbol.includes(s)));
    return sortRows(filtered, sort.key, sort.dir);
  }, [data, preset, q, sort]);

  const choosePreset = (id: PresetId) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (p?.sort) setSort(p.sort);
  };
  const clickSort = (c: Col) => {
    if (!c.sort) return;
    setSort((s) => (s.key === c.sort ? { key: c.sort, dir: (s.dir * -1) as 1 | -1 } : { key: c.sort!, dir: c.align === "left" ? 1 : -1 }));
  };
  const open = (coin: string) => { setBiasCoin(coin); setActiveModule("terminal"); };

  const hist = data?.historyMinutes ?? 0;
  const histNote = hist < 24 * 60
    ? `Timeframe and OI-change columns fill as Mako's own history builds · ${hist < 60 ? `${hist}m` : `${Math.floor(hist / 60)}h ${hist % 60}m`} of 24h collected`
    : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-base">
      {/* Toolbar */}
      <div className="h-12 shrink-0 border-b border-border flex items-center gap-3 px-4">
        <span className="text-[14px] font-semibold text-txt-primary mr-1">Screener</span>
        <div className="flex items-center rounded-md border border-border p-0.5">
          {(["market", "positioning"] as View[]).map((v) => (
            <button key={v} onClick={() => setViewSaved(v)} className={cn("h-6 px-2.5 rounded text-[12px] font-medium capitalize", view === v ? "bg-elevated text-txt-primary" : "text-txt-muted hover:text-txt-primary")}>
              {v}
            </button>
          ))}
        </div>
        <span className="w-px h-5 bg-border" />
        <div className="flex items-center gap-0.5 overflow-x-auto">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => choosePreset(p.id)}
              title={p.hint}
              className={cn("h-7 px-2.5 rounded-md text-[12.5px] font-medium whitespace-nowrap transition-colors", preset === p.id ? "bg-elevated text-txt-primary" : "text-txt-muted hover:text-txt-primary hover:bg-panel")}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="ds-num text-[11.5px] text-txt-muted hidden xl:block">{rows.length} markets</span>
          <div className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-border bg-panel w-[180px]">
            <Search className="w-3.5 h-3.5 text-txt-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="flex-1 bg-transparent outline-none text-[12.5px] placeholder:text-txt-muted" />
          </div>
          {view === "market" && <ColumnPicker hidden={hidden} setHidden={setHiddenSaved} />}
        </div>
      </div>

      {(histNote || (view === "positioning" && data?.market?.baseline != null)) && (
        <div className="shrink-0 px-4 h-8 flex items-center gap-6 border-b border-border text-[11.5px] text-txt-muted">
          {view === "positioning" && data?.market?.baseline != null && (
            <span>
              Market baseline <span className={cn("ds-num font-medium", data.market.baseline <= -20 ? "text-negative" : data.market.baseline >= 20 ? "text-positive" : "text-txt-primary")}>{data.market.baseline > 0 ? "+" : ""}{data.market.baseline}</span>
              {" "}· sharps net short on {Math.round(data.market.sharpsShortShare * 100)}% of coins — read <span className="text-txt-secondary">vs mkt</span> for the coin-specific signal
            </span>
          )}
          {histNote && view === "market" && <span>{histNote}</span>}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse ds-num text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-bg-base">
            <tr className="h-9 border-b border-border">
              {cols.map((c) => (
                <th
                  key={c.id}
                  onClick={() => clickSort(c)}
                  title={c.title}
                  className={cn(
                    "px-3 font-medium text-[11.5px] text-txt-muted select-none whitespace-nowrap",
                    c.w,
                    c.align === "right" ? "text-right" : "text-left",
                    c.sort && "cursor-pointer hover:text-txt-primary",
                    c.id === "coin" && "pl-4"
                  )}
                >
                  <span className={cn("inline-flex items-center gap-1", c.align === "right" && "flex-row-reverse")}>
                    {c.label}
                    {sort.key === c.sort && (sort.dir === -1 ? <ArrowDown className="w-3 h-3 text-txt-primary" /> : <ArrowUp className="w-3 h-3 text-txt-primary" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isError ? (
              <tr><td colSpan={cols.length} className="py-16 text-center text-txt-muted">Couldn&rsquo;t load markets. Retrying…</td></tr>
            ) : isLoading ? (
              Array.from({ length: 14 }).map((_, i) => (
                <tr key={i} className="h-8 border-b border-border"><td colSpan={cols.length} className="px-4"><div className="h-3 w-full skeleton" /></td></tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={cols.length} className="py-16 text-center text-txt-muted">Nothing matches this screen right now.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.coin} onClick={() => open(r.coin)} className="h-8 border-b border-border/60 cursor-pointer hover:bg-white/[0.03]">
                  {cols.map((c) => (
                    <td key={c.id} className={cn("px-3 whitespace-nowrap", c.align === "right" ? "text-right" : "text-left", c.id === "coin" && "pl-4")}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className="px-4 py-4 text-[11.5px] text-txt-muted max-w-[900px] leading-[1.55]">
          Hyperliquid perps with $500K+ daily volume. OI change is measured in contracts (positions), not USD, so price moves don&rsquo;t distort it.
          Positioning uses tracked wallets, not the whole market. Click any market to open it in the Terminal.
        </p>
      </div>
    </div>
  );
}

function ColumnPicker({ hidden, setHidden }: { hidden: string[]; setHidden: (h: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const optional = COLS.filter((c) => c.optional && (c.view === "market" || c.view === "both"));
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} title="Columns" className={cn("h-8 w-8 rounded-md border border-border flex items-center justify-center", open ? "bg-elevated text-txt-primary" : "text-txt-muted hover:text-txt-primary")}>
        <Columns3 className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-[200px] rounded-lg border border-border-strong bg-elevated shadow-2xl py-1.5">
          {optional.map((c) => {
            const isOn = !hidden.includes(c.id);
            return (
              <button key={c.id} onClick={() => setHidden(isOn ? [...hidden, c.id] : hidden.filter((h) => h !== c.id))} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] hover:bg-white/[0.04]">
                <span className={cn("w-3.5 h-3.5 rounded-[3px] border", isOn ? "bg-accent border-accent" : "border-border-strong")} />
                <span className="text-txt-primary">{c.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
