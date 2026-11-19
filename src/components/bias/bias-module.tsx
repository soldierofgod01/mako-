"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Check, ChevronDown, Search } from "lucide-react";
import { CaretRight, Info, SidebarSimple } from "@phosphor-icons/react";
import { useAppStore } from "@/stores/app-store";
import { useOrderflow, CHART_INTERVALS, type ChartInterval, type OrderflowState } from "@/lib/hooks/use-orderflow";
import { DEFAULT_INDICATORS, INDICATORS, OrderflowChart, PARKED_INDICATORS, type Indicators } from "./orderflow-chart";
import { OrderBookPanel } from "./order-book";
import { BottomPanel } from "./bottom-panel";
import { TokenIcon } from "@/components/scanner/token-icon";
import { fmtUsd, WARMUP_MINUTES, type BiasResult, type Signal } from "@/lib/bias/engine";
import { fmtPrice } from "@/lib/bias/format";
import { cn } from "@/lib/utils";

export { fmtPrice };

// ════════════════════════════════════════════════════════════════
// Terminal — pick a coin, read its order flow, get a directional bias.
// Layout (exchange-terminal style, Nov 2026):
//   market bar
//   chart (own toolbar) │ live order book │ bias + evidence
//   bottom tabs (cohorts, liqs, prints, log)│
//   status strip
// Interpretation, not trade calls — the trader decides.
// ════════════════════════════════════════════════════════════════

interface MarketRow {
  symbol: string;
  coin: string;
  markPrice: number;
  volume24hUsd: number;
}

const usd = (x: number) => fmtUsd(x).replace("+", "");

export function BiasModule() {
  const { biasCoin, setBiasCoin } = useAppStore();

  // Restore last coin (store default is BTC).
  useEffect(() => {
    try {
      const saved = localStorage.getItem("mako:bias:coin");
      if (saved && saved !== biasCoin) setBiasCoin(saved);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [interval, setIntervalState] = useState<ChartInterval>("15m");
  const [indicators, setIndicatorsState] = useState<Indicators>(DEFAULT_INDICATORS);
  const [panelOpen, setPanelOpen] = useState(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem("mako:chart:interval") as ChartInterval | null;
      if (v && v in CHART_INTERVALS) setIntervalState(v);
      const ind = localStorage.getItem("mako:chart:indicators:v2");
      if (ind) {
        const saved = { ...DEFAULT_INDICATORS, ...JSON.parse(ind) } as Indicators;
        for (const id of PARKED_INDICATORS) saved[id] = "off";
        setIndicatorsState(saved);
      }
      if (localStorage.getItem("mako:terminal:panel") === "0") setPanelOpen(false);
    } catch { /* ignore */ }
  }, []);
  const setInterval_ = (i: ChartInterval) => {
    setIntervalState(i);
    try { localStorage.setItem("mako:chart:interval", i); } catch { /* ignore */ }
  };
  const setIndicators = (f: (i: Indicators) => Indicators) =>
    setIndicatorsState((prev) => {
      const next = f(prev);
      try { localStorage.setItem("mako:chart:indicators:v2", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  const togglePanel = () =>
    setPanelOpen((v) => {
      try { localStorage.setItem("mako:terminal:panel", v ? "0" : "1"); } catch { /* ignore */ }
      return !v;
    });

  const of = useOrderflow(biasCoin, interval);
  const liqLevels = of.cohorts?.data?.liqLevels ?? [];

  return (
    <div className="flex-1 flex flex-col gap-2 overflow-hidden">
      <MarketBar coin={biasCoin} onPick={setBiasCoin} of={of} panelOpen={panelOpen} onTogglePanel={togglePanel} />
      <div className="flex-1 flex gap-2 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex-1 min-h-0 flex gap-2">
            <section className="flex-1 min-w-0 ds-card-panel overflow-hidden flex flex-col">
              <ChartToolbar interval={interval} onInterval={setInterval_} indicators={indicators} setIndicators={setIndicators} />
              <div className="flex-1 min-h-0 relative">
                <OrderflowChart key={biasCoin} of={of} coin={biasCoin} interval={interval} indicators={indicators} setIndicators={setIndicators} liqLevels={liqLevels} />
              </div>
            </section>
            <div className="hidden lg:flex w-[248px] xl:w-[272px] shrink-0 flex-col min-h-0">
              <OrderBookPanel feed={of.live} coin={biasCoin} whaleMin={of.whaleMin} />
            </div>
          </div>
          <BottomPanel of={of} />
        </div>
        {panelOpen && (
          <aside className="terminal-side w-[320px] xl:w-[340px] shrink-0 overflow-y-auto rounded-xl">
            <div className="flex flex-col gap-2">
              <BiasCard bias={of.bias} of={of} />
              <EvidenceList bias={of.bias} />
            </div>
          </aside>
        )}
      </div>
      <StatusStrip of={of} />
    </div>
  );
}

// ─── Market bar ─────────────────────────────────────────────────

function MarketBar({ coin, onPick, of, panelOpen, onTogglePanel }: {
  coin: string; onPick: (c: string) => void; of: OrderflowState; panelOpen: boolean; onTogglePanel: () => void;
}) {
  const ctx = of.ctx;
  const countdown = useFundingCountdown();
  const chg = ctx?.change24hPct ?? 0;
  const px = of.lastPx;
  const chgAbs = px != null && ctx ? px - px / (1 + chg / 100) : null;
  const fundingPct = ctx ? ctx.fundingHourly * 100 : null;
  const tone = chg >= 0 ? "text-positive" : "text-negative";
  return (
    <div className="h-14 shrink-0 ds-card-panel flex items-center gap-5 pl-2 pr-3">
      <div className="flex items-center gap-2">
        <CoinPicker coin={coin} onPick={onPick} />
        {ctx?.maxLeverage ? (
          <span className="ds-num text-[10.5px] font-semibold text-positive bg-positive/10 rounded px-1.5 py-0.5">{ctx.maxLeverage}x</span>
        ) : null}
      </div>
      <div className="flex flex-col leading-[1.15] min-w-[96px]">
        <span className="ds-num text-[17px] font-semibold text-txt-primary">{fmtPrice(px)}</span>
        <span className={cn("ds-num text-[11.5px]", ctx ? tone : "text-txt-muted")}>
          {ctx ? `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%` : "—"}
        </span>
      </div>
      <Sep />
      <Stat wide label="24h change" value={ctx && chgAbs != null ? `${chgAbs >= 0 ? "+" : "−"}${Math.abs(chgAbs) >= 1 ? Math.abs(chgAbs).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmtPrice(Math.abs(chgAbs))}` : "—"} tone={ctx ? (chg >= 0 ? "pos" : "neg") : undefined} />
      <Stat label="Mark" value={ctx ? fmtPrice(ctx.markPx) : "—"} />
      <Stat wide label="Oracle" value={ctx ? fmtPrice(ctx.oraclePx) : "—"} />
      <Stat label="24h volume" value={ctx ? usd(ctx.volume24hUsd) : "—"} />
      <Stat label="Open interest" value={ctx ? usd(ctx.oiUsd) : "—"} />
      <Stat
        label="Funding / countdown"
        value={fundingPct == null ? "—" : `${fundingPct >= 0 ? "+" : ""}${fundingPct.toFixed(4)}%  ${countdown}`}
        tone={fundingPct == null ? undefined : fundingPct * 8 > 0.03 ? "neg" : fundingPct * 8 < -0.01 ? "pos" : undefined}
      />
      <div className="ml-auto flex items-center gap-2">
        <BiasChip bias={of.bias} />
        <button
          onClick={onTogglePanel}
          title={panelOpen ? "Hide bias panel" : "Show bias panel"}
          className={cn(
            "h-8 px-3 rounded-full text-[12.5px] font-medium flex items-center gap-1.5 transition-colors",
            panelOpen ? "bg-elevated-2 text-txt-primary" : "text-txt-muted hover:text-txt-primary hover:bg-elevated"
          )}
        >
          <SidebarSimple size={15} mirrored />
          Bias
        </button>
      </div>
    </div>
  );
}

const Sep = () => <span className="w-px h-7 bg-border shrink-0" />;

function Stat({ label, value, tone, wide }: { label: string; value: string; tone?: "pos" | "neg"; wide?: boolean }) {
  return (
    <div className={cn("hidden flex-col leading-[1.2] shrink-0", wide ? "xl:flex" : "lg:flex")}>
      <span className="text-[11px] text-txt-muted whitespace-nowrap">{label}</span>
      <span className={cn("ds-num text-[12.5px] font-medium whitespace-pre", tone === "pos" ? "text-positive" : tone === "neg" ? "text-negative" : "text-txt-primary")}>{value}</span>
    </div>
  );
}

/** Compact verdict so the read is visible even with the panel closed. */
function BiasChip({ bias }: { bias: BiasResult | null }) {
  if (!bias) return null;
  const warming = bias.warmingUp;
  const dir = bias.direction;
  const cls = warming || dir === "neutral"
    ? "text-txt-secondary bg-white/[0.05]"
    : dir === "long" ? "text-positive bg-positive/10" : "text-negative bg-negative/10";
  return (
    <span className={cn("h-8 px-3 rounded-full flex items-center gap-2 text-[12px] font-medium", cls)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", warming ? "bg-warning animate-pulse" : dir === "long" ? "bg-positive" : dir === "short" ? "bg-negative" : "bg-txt-muted")} />
      {warming ? "Reading tape" : dir === "neutral" ? "Neutral" : dir === "long" ? "Long bias" : "Short bias"}
      {!warming && <span className="ds-num opacity-80">{bias.score > 0 ? "+" : ""}{bias.score}</span>}
    </span>
  );
}

// ─── Chart toolbar ──────────────────────────────────────────────

function ChartToolbar({ interval, onInterval, indicators, setIndicators }: {
  interval: ChartInterval; onInterval: (i: ChartInterval) => void;
  indicators: Indicators; setIndicators: (f: (i: Indicators) => Indicators) => void;
}) {
  return (
    <div className="h-10 shrink-0 flex items-center gap-2 px-2 border-b border-border">
      <div className="flex items-center gap-0.5">
        {(Object.keys(CHART_INTERVALS) as ChartInterval[]).map((i) => (
          <button
            key={i}
            onClick={() => onInterval(i)}
            className={cn(
              "h-7 px-2.5 rounded-full text-[12px] font-medium ds-num transition-colors",
              interval === i ? "bg-elevated-2 text-txt-primary" : "text-txt-muted hover:text-txt-primary"
            )}
          >
            {i}
          </button>
        ))}
      </div>
      <span className="w-px h-5 bg-border" />
      <IndicatorsMenu indicators={indicators} setIndicators={setIndicators} />
    </div>
  );
}

// ─── Evidence (compact; click a row for the explanation) ────────

function EvidenceList({ bias }: { bias: BiasResult | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!bias) return null;
  return (
    <div className="ds-panel">
      <div className="h-10 px-4 flex items-center justify-between border-b border-border">
        <span className="text-[13px] font-semibold text-txt-primary">Evidence</span>
        <span className="text-[11px] text-txt-muted">weight · pull</span>
      </div>
      {bias.signals.map((s) => (
        <EvidenceRow key={s.id} s={s} open={openId === s.id} onToggle={() => setOpenId((v) => (v === s.id ? null : s.id))} />
      ))}
      <div className="px-4 py-2.5 border-t border-border flex items-center gap-1.5 text-[11px] text-txt-muted"
        title="Order flow is read live from Hyperliquid from the moment this tab opens. HL has no public historical tape, so delta, prints and OI change build up over the session. Cohorts come from Hyperliquid's public leaderboard; past PnL doesn't guarantee future skill.">
        <Info size={13} />
        A read on who is in control, not a trade call.
      </div>
    </div>
  );
}

function EvidenceRow({ s, open, onToggle }: { s: Signal; open: boolean; onToggle: () => void }) {
  const pull = s.available ? s.score : 0;
  const tone = pull >= 0.15 ? "text-positive" : pull <= -0.15 ? "text-negative" : "text-txt-secondary";
  return (
    <div className={cn("border-t border-border first-of-type:border-t-0", !s.available && "opacity-55")}>
      <button onClick={onToggle} className="w-full px-4 py-2 flex items-center gap-2 text-left ds-row-hover">
        <CaretRight size={11} className={cn("text-txt-muted shrink-0 transition-transform", open && "rotate-90")} />
        <span className="flex-1 min-w-0">
          <span className="block text-[12.5px] font-medium text-txt-primary truncate">{s.label}</span>
          <span className={cn("block ds-num text-[11.5px] truncate", tone)}>{s.available ? s.value : "—"}</span>
        </span>
        <span className="ds-num text-[11px] text-txt-muted w-8 text-right">{Math.round(s.weight * 100)}%</span>
        <PullBar v={pull} />
      </button>
      {open && <p className="px-4 pl-[33px] pb-2.5 -mt-0.5 text-[12px] text-txt-secondary leading-[1.5]">{s.available ? s.read : s.why}</p>}
    </div>
  );
}

/** Centered bar: fills left (bearish, red) or right (bullish, green). */
function PullBar({ v }: { v: number }) {
  const w = Math.min(1, Math.abs(v)) * 50;
  return (
    <div className="relative w-[56px] h-1.5 rounded-full bg-elevated overflow-hidden shrink-0">
      <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
      <div
        className={cn("absolute inset-y-0", v >= 0 ? "bg-positive" : "bg-negative")}
        style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
      />
    </div>
  );
}

// ─── Status strip ───────────────────────────────────────────────

function StatusStrip({ of }: { of: OrderflowState }) {
  const tapeMin = of.bias ? Math.floor(of.bias.tapeMinutes) : 0;
  const warm = of.bias ? Math.min(1, of.bias.tapeMinutes / WARMUP_MINUTES) : 0;
  const feed = of.status === "live" ? "Feed live" : of.status === "connecting" ? "Connecting" : "Feed blocked";
  return (
    <div className="h-5 shrink-0 flex items-center gap-4 px-2 text-[11px] text-txt-muted">
      <span className="flex items-center gap-1.5"><Dot ok={of.status !== "error"} />Hyperliquid mainnet</span>
      <span className="flex items-center gap-1.5">
        <Dot ok={of.status === "live"} warn={of.status === "connecting"} />
        {feed}
      </span>
      <span className="ds-num">Tape {tapeMin} min</span>
      {of.bias?.warmingUp && <span className="ds-num">Bias warm-up {Math.floor(warm * 100)}%</span>}
      {of.ctxError && <span className="text-negative">Market data delayed</span>}
    </div>
  );
}

const Dot = ({ ok, warn }: { ok: boolean; warn?: boolean }) => (
  <span className={cn("w-1.5 h-1.5 rounded-full", warn ? "bg-warning animate-pulse" : ok ? "bg-positive" : "bg-negative")} />
);

// ─── Shared pieces ──────────────────────────────────────────────

function useFundingCountdown() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (now == null) return "";
  // Hyperliquid pays funding every hour, on the hour.
  const left = 3_600_000 - (now % 3_600_000);
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}


function IndicatorsMenu({ indicators, setIndicators }: { indicators: Indicators; setIndicators: (f: (i: Indicators) => Indicators) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const active = INDICATORS.filter((i) => indicators[i.id] !== "off").length;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn("h-7 px-2.5 rounded-md text-[12.5px] font-medium flex items-center gap-1.5 transition-colors", open ? "bg-elevated text-txt-primary" : "text-txt-secondary hover:text-txt-primary hover:bg-panel")}
      >
        <BarChart3 className="w-3.5 h-3.5" />
        Indicators
        {active > 0 && <span className="ds-num text-[11px] text-txt-muted">{active}</span>}
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-50 w-[320px] rounded-lg border border-border-strong bg-elevated shadow-2xl py-1.5">
          {INDICATORS.map((i) => {
            const isOn = indicators[i.id] !== "off";
            return (
              <button
                key={i.id}
                onClick={() => setIndicators((s) => ({ ...s, [i.id]: isOn ? "off" : "on" }))}
                className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-white/[0.04]"
              >
                <span className={cn("mt-0.5 w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center shrink-0", isOn ? "bg-accent border-accent" : "border-border-strong")}>
                  {isOn && <Check className="w-2.5 h-2.5 text-black" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-txt-primary">{i.label}</span>
                  <span className="block text-[11.5px] text-txt-muted">{i.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


export function CoinPicker({ coin, onPick }: { coin: string; onPick: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["bias-markets"],
    queryFn: async (): Promise<MarketRow[]> => {
      const res = await fetch("/api/scanner");
      if (!res.ok) throw new Error("markets");
      const j = await res.json();
      return j.markets ?? [];
    },
    staleTime: 60_000,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const rows = useMemo(() => {
    const all = data ?? [];
    const s = q.trim().toUpperCase();
    return (s ? all.filter((m) => m.symbol.includes(s)) : all).slice(0, 60);
  }, [data, q]);

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 h-9 pl-1.5 pr-2.5 rounded-md hover:bg-elevated transition-colors"
      >
        <TokenIcon symbol={coin} size={22} />
        <span className="text-[15px] font-semibold text-txt-primary">{coin}</span>
        <span className="text-[11px] text-txt-muted">-PERP</span>
        <ChevronDown className="w-3.5 h-3.5 text-txt-muted" />
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-50 w-[300px] ds-panel shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 h-10 border-b border-border">
            <Search className="w-3.5 h-3.5 text-txt-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search Hyperliquid perps"
              className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-txt-muted"
            />
          </div>
          <div className="max-h-[360px] overflow-y-auto py-1">
            {!data && <div className="px-3 py-4 text-[12px] text-txt-muted">Loading markets…</div>}
            {data && rows.length === 0 && <div className="px-3 py-4 text-[12px] text-txt-muted">No match</div>}
            {rows.map((m) => (
              <button
                key={m.coin}
                onClick={() => {
                  onPick(m.coin);
                  setOpen(false);
                  setQ("");
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 h-9 text-left ds-row-hover",
                  m.coin === coin && "bg-elevated"
                )}
              >
                <TokenIcon symbol={m.coin} size={18} />
                <span className="text-[13px] font-medium text-txt-primary flex-1">{m.coin}</span>
                <span className="ds-num text-[11.5px] text-txt-muted">{fmtUsd(m.volume24hUsd).replace("+", "")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Bias card ──────────────────────────────────────────────────

function BiasCard({ bias, of }: { bias: BiasResult | null; of: OrderflowState }) {
  if (!bias) {
    return <div className="ds-panel ds-panel-signature h-[190px] skeleton" />;
  }
  const dirText = bias.direction === "long" ? "Long bias" : bias.direction === "short" ? "Short bias" : "Neutral";
  const dirColor = bias.direction === "long" ? "text-positive" : bias.direction === "short" ? "text-negative" : "text-txt-secondary";
  const markerLeft = `${(bias.score + 100) / 2}%`;
  const warm = Math.min(1, bias.tapeMinutes / WARMUP_MINUTES);
  // Accent light only when the read is directional — colour means something.
  const glow =
    bias.direction === "neutral" ? undefined
      : `radial-gradient(120% 70% at 85% -10%, ${bias.direction === "long" ? "rgba(31,184,128," : "rgba(239,68,68,"}${bias.strength === "strong" ? 0.16 : 0.08}), transparent 65%)`;

  return (
    <div className="ds-panel ds-panel-signature p-4 relative overflow-hidden">
      {glow && <div className="absolute inset-0 pointer-events-none" style={{ background: glow }} />}
      <div className="relative">
      <div className="flex items-start justify-between">
        <div>
          <div className="ds-label mb-1">Order-flow bias</div>
          <div className={cn("text-[26px] font-semibold tracking-[-0.02em] leading-none", dirColor)}>
            {dirText}
            {bias.direction !== "neutral" && (
              <span className="ml-2 text-[13px] font-medium text-txt-secondary capitalize">{bias.strength}</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className={cn("ds-num text-[26px] font-semibold leading-none", dirColor)}>
            {bias.score > 0 ? "+" : ""}
            {bias.score}
          </div>
          <div className="ds-label mt-1">score / 100</div>
        </div>
      </div>

      {/* Gauge */}
      <div className="mt-5 relative h-2 rounded-full bg-elevated overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-[40%] bg-negative/15" />
        <div className="absolute inset-y-0 right-0 w-[40%] bg-positive/15" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
      </div>
      <div className="relative h-0">
        <div
          className="absolute -top-[13px] w-[3px] h-[14px] rounded-full bg-txt-primary transition-[left] duration-700"
          style={{ left: `calc(${markerLeft} - 1.5px)` }}
        />
      </div>
      <div className="flex justify-between mt-1.5 ds-micro">
        <span>Sellers</span>
        <span>Balanced</span>
        <span>Buyers</span>
      </div>

      <p className="mt-4 text-[13.5px] text-txt-primary leading-[1.5]">{bias.summary}</p>

      {of.mtf && <MtfRow mtf={of.mtf} />}

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniStat label="Confidence" value={`${bias.confidence}%`} />
        <MiniStat label="Agree / against" value={`${bias.agreeing} / ${bias.opposing}`} />
        <MiniStat label="Data coverage" value={`${Math.round(bias.coverage * 100)}%`} />
      </div>

      {of.restored && of.restored.minutes > 0 && (
        <p className="mt-3 text-[11.5px] text-txt-muted">
          Resumed {of.restored.minutes} min of saved tape
          {of.restored.gapSec > 90 ? ` · ${Math.round(of.restored.gapSec / 60)} min gap while away (not reconstructed)` : ""}.
        </p>
      )}
      {bias.warmingUp && (
        <div className="mt-4">
          <div className="flex justify-between ds-label mb-1.5">
            <span>Reading the tape — bias firms up after {WARMUP_MINUTES} min</span>
            <span className="ds-num">{Math.floor(warm * 100)}%</span>
          </div>
          <div className="h-1 rounded-full bg-elevated overflow-hidden">
            <div className="h-full bg-accent transition-[width] duration-1000" style={{ width: `${warm * 100}%` }} />
          </div>
        </div>
      )}
      {of.status === "error" && (
        <p className="mt-4 text-[12px] text-negative leading-[1.5]">
          Can&rsquo;t reach Hyperliquid&rsquo;s live feed from this network. The bias needs the live tape.
        </p>
      )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-void border border-border px-2.5 py-2">
      <div className="ds-label text-[11px]">{label}</div>
      <div className="ds-num text-[13px] text-txt-primary mt-0.5">{value}</div>
    </div>
  );
}


// ─── Multi-timeframe ────────────────────────────────────────────

function MtfRow({ mtf }: { mtf: NonNullable<OrderflowState["mtf"]> }) {
  const items = [mtf["5m"], mtf["15m"], mtf["1h"]];
  const dirs = items.filter((b) => !b.warmingUp).map((b) => b.direction);
  const conflict = dirs.includes("long") && dirs.includes("short");
  return (
    <div className="mt-4">
      <div className="grid grid-cols-3 gap-2">
        {items.map((b) => {
          const tone = b.direction === "long" ? "text-positive" : b.direction === "short" ? "text-negative" : "text-txt-secondary";
          return (
            <div key={b.horizon} className={cn("rounded-[8px] border px-2.5 py-2", b.horizon === "15m" ? "border-border-strong bg-elevated/40" : "border-border bg-void")}>
              <div className="flex items-baseline justify-between">
                <span className="ds-num text-[11px] text-txt-muted">{b.horizon}</span>
                <span className={cn("ds-num text-[12.5px] font-semibold", b.warmingUp ? "text-txt-dim" : tone)}>
                  {b.warmingUp ? "…" : `${b.score > 0 ? "+" : ""}${b.score}`}
                </span>
              </div>
              <div className={cn("text-[11.5px] font-medium mt-0.5 capitalize", b.warmingUp ? "text-txt-dim" : tone)}>
                {b.warmingUp ? "Warming up" : b.direction}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11.5px] text-txt-muted leading-[1.45]">
        {conflict
          ? "Timeframes disagree — short-term flow is fighting the bigger picture. Expect chop or a turn."
          : items.every((b) => !b.warmingUp && b.direction === items[0].direction && b.direction !== "neutral")
            ? "All timeframes agree."
            : "15m is the main read. 5m = right now, 1h = bigger picture (needs ~20 min of tape)."}
      </p>
    </div>
  );
}

