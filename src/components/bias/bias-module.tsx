"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Search } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useOrderflow, CHART_INTERVALS, type ChartInterval, type OrderflowState } from "@/lib/hooks/use-orderflow";
import { OrderflowChart } from "./orderflow-chart";
import { TokenIcon } from "@/components/scanner/token-icon";
import { CvdChart } from "./cvd-chart";
import { fmtUsd, WARMUP_MINUTES, type BiasResult, type Signal } from "@/lib/bias/engine";
import { cn } from "@/lib/utils";
import type { CohortSide } from "@/lib/cohorts/cohorts";

// ════════════════════════════════════════════════════════════════
// Bias — pick a coin, read its order flow, get a directional bias.
// Left: TradingView chart. Right: the bias and every piece of evidence
// behind it. Interpretation, not trade calls — the trader decides.
// ════════════════════════════════════════════════════════════════

interface MarketRow {
  symbol: string;
  coin: string;
  markPrice: number;
  volume24hUsd: number;
}

export function fmtPrice(p: number | null | undefined): string {
  if (p == null || !isFinite(p)) return "—";
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (p >= 1) return p.toFixed(p >= 100 ? 2 : 3);
  if (p >= 0.01) return p.toFixed(4);
  return p.toPrecision(4);
}

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
  useEffect(() => {
    try {
      const v = localStorage.getItem("mako:chart:interval") as ChartInterval | null;
      if (v && v in CHART_INTERVALS) setIntervalState(v);
    } catch { /* ignore */ }
  }, []);
  const setInterval_ = (i: ChartInterval) => {
    setIntervalState(i);
    try { localStorage.setItem("mako:chart:interval", i); } catch { /* ignore */ }
  };

  const of = useOrderflow(biasCoin, interval);
  const liqLevels = of.cohorts?.data?.liqLevels ?? [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-base">
      <HeaderBar coin={biasCoin} onPick={setBiasCoin} of={of} />
      <div className="flex-1 flex min-h-0">
        {/* Left — chart */}
        <section className="flex-1 min-w-0 border-r border-border bg-[#0A0A0C]">
          <OrderflowChart key={biasCoin} of={of} interval={interval} onInterval={setInterval_} liqLevels={liqLevels} />
        </section>
        {/* Right — analysis */}
        <aside className="w-[340px] lg:w-[400px] xl:w-[460px] shrink-0 overflow-y-auto">
          <div className="p-4 flex flex-col gap-4">
            <BiasCard bias={of.bias} of={of} />
            <SignalList bias={of.bias} />
            <LiqPanel of={of} />
            <CohortPanel of={of} />
            <CvdPanel of={of} />
            <PrintsPanel of={of} />
            <BookPanel of={of} />
            <TrackRecord of={of} />
            <p className="text-[11.5px] text-txt-muted leading-[1.55] px-1 pb-4">
              Order flow is read live from Hyperliquid from the moment this tab opens — HL has no public
              historical tape, so delta, prints and OI change build up over the session. Wallet cohorts come from
              Hyperliquid&rsquo;s public leaderboard; past PnL doesn&rsquo;t guarantee future skill. Weights are a starting
              point, not back-tested; the track record above is how we find out if they work. A bias is a read on
              who is in control, not a trade call.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────

function HeaderBar({ coin, onPick, of }: { coin: string; onPick: (c: string) => void; of: OrderflowState }) {
  const ctx = of.ctx;
  const f8h = ctx ? ctx.fundingHourly * 8 * 100 : null;
  return (
    <div className="h-14 shrink-0 border-b border-border flex items-center gap-6 px-4">
      <CoinPicker coin={coin} onPick={onPick} />
      <div className="flex items-baseline gap-2.5">
        <span className="ds-num text-[18px] font-semibold text-txt-primary">{fmtPrice(of.lastPx)}</span>
        {ctx && (
          <span className={cn("ds-num text-[12.5px]", ctx.change24hPct >= 0 ? "text-positive" : "text-negative")}>
            {ctx.change24hPct >= 0 ? "+" : ""}
            {ctx.change24hPct.toFixed(2)}%
          </span>
        )}
      </div>
      <HeaderStat label="Open interest" value={ctx ? fmtUsd(ctx.oiUsd).replace("+", "") : "—"} />
      <HeaderStat
        label="Funding / 8h"
        value={f8h == null ? "—" : `${f8h >= 0 ? "+" : ""}${f8h.toFixed(4)}%`}
        tone={f8h == null ? undefined : f8h > 0.03 ? "neg" : f8h < -0.01 ? "pos" : undefined}
      />
      <HeaderStat label="24h volume" value={ctx ? fmtUsd(ctx.volume24hUsd).replace("+", "") : "—"} />
      <div className="ml-auto flex items-center gap-2">
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full",
            of.status === "live" ? "bg-accent" : of.status === "connecting" ? "bg-warning animate-pulse" : "bg-negative"
          )}
        />
        <span className="ds-label">
          {of.status === "live" ? `Live · ${of.tradeCount.toLocaleString()} trades` : of.status === "connecting" ? "Connecting…" : "Feed blocked"}
        </span>
      </div>
    </div>
  );
}

function HeaderStat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="hidden lg:flex flex-col leading-tight">
      <span className="ds-label text-[11px]">{label}</span>
      <span className={cn("ds-num text-[12.5px]", tone === "pos" ? "text-positive" : tone === "neg" ? "text-negative" : "text-txt-primary")}>
        {value}
      </span>
    </div>
  );
}

function CoinPicker({ coin, onPick }: { coin: string; onPick: (c: string) => void }) {
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
        <TokenIcon symbol={coin.toUpperCase()} size={22} />
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
                <TokenIcon symbol={m.symbol} size={18} />
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

  return (
    <div className="ds-panel ds-panel-signature p-5">
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
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-bg-base border border-border px-2.5 py-2">
      <div className="ds-label text-[11px]">{label}</div>
      <div className="ds-num text-[13px] text-txt-primary mt-0.5">{value}</div>
    </div>
  );
}

// ─── Evidence ───────────────────────────────────────────────────

function SignalList({ bias }: { bias: BiasResult | null }) {
  if (!bias) return null;
  return (
    <div className="ds-panel">
      <div className="px-4 pt-4 pb-2 flex items-baseline justify-between">
        <span className="ds-section-title">Evidence</span>
        <span className="ds-label">weight · pull</span>
      </div>
      <div className="flex flex-col">
        {bias.signals.map((s) => (
          <SignalRow key={s.id} s={s} />
        ))}
      </div>
    </div>
  );
}

function SignalRow({ s }: { s: Signal }) {
  const pull = s.available ? s.score : 0;
  const tone = pull >= 0.15 ? "text-positive" : pull <= -0.15 ? "text-negative" : "text-txt-secondary";
  return (
    <div className={cn("px-4 py-3 border-t border-border", !s.available && "opacity-55")}>
      <div className="flex items-center gap-3">
        <span className="text-[13px] font-medium text-txt-primary flex-1">{s.label}</span>
        <span className="ds-num text-[11px] text-txt-muted">{Math.round(s.weight * 100)}%</span>
        <PullBar v={pull} />
      </div>
      <div className={cn("ds-num text-[12px] mt-1", tone)}>{s.value}</div>
      <p className="text-[12px] text-txt-secondary leading-[1.5] mt-1">{s.available ? s.read : s.why}</p>
    </div>
  );
}

/** Centered bar: fills left (bearish, red) or right (bullish, green). */
function PullBar({ v }: { v: number }) {
  const w = Math.min(1, Math.abs(v)) * 50;
  return (
    <div className="relative w-[72px] h-1.5 rounded-full bg-elevated overflow-hidden">
      <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
      <div
        className={cn("absolute inset-y-0", v >= 0 ? "bg-positive" : "bg-negative")}
        style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
      />
    </div>
  );
}

function CvdPanel({ of }: { of: OrderflowState }) {
  const last = of.cvd[of.cvd.length - 1];
  return (
    <div className="ds-panel">
      <div className="px-4 pt-4 flex items-baseline justify-between">
        <span className="ds-section-title">Cumulative delta</span>
        <span className={cn("ds-num text-[12.5px]", last && last.cvd >= 0 ? "text-positive" : "text-negative")}>
          {last ? fmtUsd(last.cvd) : "—"}
        </span>
      </div>
      <p className="px-4 mt-1 text-[11.5px] text-txt-muted">
        Session CVD (mint) vs price (grey). Price rising while CVD falls — or the reverse — is divergence.
      </p>
      <div className="h-[180px] px-2 pb-2 mt-2">
        {of.cvd.length > 1 ? (
          <CvdChart data={of.cvd} />
        ) : (
          <div className="h-full flex items-center justify-center text-[12px] text-txt-muted">Waiting for trades…</div>
        )}
      </div>
    </div>
  );
}

function PrintsPanel({ of }: { of: OrderflowState }) {
  return (
    <div className="ds-panel">
      <div className="px-4 pt-4 pb-2 flex items-baseline justify-between">
        <span className="ds-section-title">Large prints</span>
        <span className="ds-label">≥ {fmtUsd(of.whaleMin).replace("+", "")}</span>
      </div>
      {of.bigPrints.length === 0 ? (
        <div className="px-4 pb-4 text-[12px] text-txt-muted">None yet this session.</div>
      ) : (
        <div className="max-h-[220px] overflow-y-auto pb-2">
          {of.bigPrints.map((t, i) => (
            <div key={`${t.t}-${i}`} className="flex items-center px-4 h-7 ds-row-hover">
              <span className={cn("w-12 text-[12px] font-medium", t.side === 1 ? "text-positive" : "text-negative")}>
                {t.side === 1 ? "Buy" : "Sell"}
              </span>
              <span className="ds-num text-[12px] text-txt-primary flex-1">{fmtUsd(t.usd).replace("+", "")}</span>
              <span className="ds-num text-[12px] text-txt-secondary w-24 text-right">{fmtPrice(t.px)}</span>
              <span className="ds-num text-[11px] text-txt-muted w-16 text-right">
                {new Date(t.t).toLocaleTimeString([], { hour12: false })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BookPanel({ of }: { of: OrderflowState }) {
  const book = of.book;
  if (!book) {
    return <div className="ds-panel h-[120px] skeleton" />;
  }
  const max = Math.max(...book.bids.map((l) => l.usd), ...book.asks.map((l) => l.usd), 1);
  const rows = Math.min(8, book.bids.length, book.asks.length);
  return (
    <div className="ds-panel">
      <div className="px-4 pt-4 pb-2 flex items-baseline justify-between">
        <span className="ds-section-title">Order book</span>
        <span className="ds-label">top {rows} levels</span>
      </div>
      <div className="px-4 pb-4 grid grid-cols-2 gap-x-2">
        {Array.from({ length: rows }).map((_, i) => (
          <BookRowPair key={i} bid={book.bids[i]} ask={book.asks[i]} max={max} />
        ))}
      </div>
    </div>
  );
}

function BookRowPair({ bid, ask, max }: { bid: { px: number; usd: number }; ask: { px: number; usd: number }; max: number }) {
  return (
    <>
      <div className="relative h-6 flex items-center justify-between px-1.5">
        <div className="absolute inset-y-0.5 right-0 bg-positive/12 rounded-sm" style={{ width: `${(bid.usd / max) * 100}%` }} />
        <span className="relative ds-num text-[11px] text-txt-muted">{fmtUsd(bid.usd).replace("+", "")}</span>
        <span className="relative ds-num text-[11.5px] text-positive">{fmtPrice(bid.px)}</span>
      </div>
      <div className="relative h-6 flex items-center justify-between px-1.5">
        <div className="absolute inset-y-0.5 left-0 bg-negative/12 rounded-sm" style={{ width: `${(ask.usd / max) * 100}%` }} />
        <span className="relative ds-num text-[11.5px] text-negative">{fmtPrice(ask.px)}</span>
        <span className="relative ds-num text-[11px] text-txt-muted">{fmtUsd(ask.usd).replace("+", "")}</span>
      </div>
    </>
  );
}

function TrackRecord({ of }: { of: OrderflowState }) {
  const s = of.logStats;
  return (
    <div className="ds-panel ds-stat-accent px-4 py-3.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-txt-primary">Track record · this browser</span>
        <span className="ds-num text-[13px] text-txt-primary">
          {s?.hitRate != null ? `${Math.round(s.hitRate * 100)}%` : "—"}
        </span>
      </div>
      <p className="text-[11.5px] text-txt-muted leading-[1.5] mt-1">
        {s && s.graded > 0
          ? `${s.hits}/${s.graded} directional reads on this coin were right 15 min later${s.graded < 30 ? " — too few to trust yet" : ""}. ${s.pending} pending.`
          : "Logs the bias every 5 min and checks price 15 min later. Needs 30+ graded reads before the number means anything."}
      </p>
    </div>
  );
}

// ─── Sharps vs donors ───────────────────────────────────────────

function CohortPanel({ of }: { of: OrderflowState }) {
  const c = of.cohorts;
  const d = c?.data;
  const div = d?.divergence ?? 0;
  const ageMin = c ? Math.max(0, Math.round((Date.now() - c.updatedAt) / 60_000)) : 0;
  return (
    <div className="ds-panel">
      <div className="px-4 pt-4 flex items-baseline justify-between">
        <span className="ds-section-title">Sharps vs donors</span>
        <span className={cn("ds-num text-[13px] font-medium", div >= 20 ? "text-positive" : div <= -20 ? "text-negative" : "text-txt-secondary")}>
          {d ? `${div > 0 ? "+" : ""}${div}` : "—"}
        </span>
      </div>
      <p className="px-4 mt-1 text-[11.5px] text-txt-muted leading-[1.5]">
        Top {c?.tracked.sharps ?? "…"} profitable active wallets vs the {c?.tracked.donors ?? "…"} biggest active losers on
        Hyperliquid. Positive = winners are longer than losers.
      </p>
      {!c ? (
        <div className="m-4 h-[88px] skeleton" />
      ) : !d ? (
        <div className="px-4 py-4 text-[12px] text-txt-muted">No tracked wallets hold this coin right now.</div>
      ) : (
        <div className="px-4 pt-3 pb-4 flex flex-col gap-3">
          <CohortRow label="Sharps" side={d.sharps} />
          <CohortRow label="Donors" side={d.donors} />
          <div className="ds-micro">Updated {ageMin === 0 ? "just now" : `${ageMin}m ago`} · tracked wallets only, not the whole market</div>
        </div>
      )}
    </div>
  );
}

function CohortRow({ label, side }: { label: string; side: CohortSide }) {
  const gross = side.longUsd + side.shortUsd;
  const longPct = gross > 0 ? (side.longUsd / gross) * 100 : 50;
  const n = side.longWallets + side.shortWallets;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[12.5px] font-medium text-txt-primary">
          {label} <span className="text-txt-muted font-normal">· {n} wallet{n === 1 ? "" : "s"}</span>
        </span>
        <span className="ds-num text-[11.5px] text-txt-secondary">
          {gross > 0 ? `${Math.round(longPct)}% long` : "no positions"}
        </span>
      </div>
      <div className="h-2 rounded-full bg-negative/40 overflow-hidden flex">
        <div className="h-full bg-positive/80" style={{ width: `${longPct}%` }} />
      </div>
      <div className="flex justify-between mt-1 ds-num text-[11px] text-txt-muted">
        <span>L {fmtUsd(side.longUsd).replace("+", "")} · {side.longWallets}</span>
        <span>{side.shortWallets} · S {fmtUsd(side.shortUsd).replace("+", "")}</span>
      </div>
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
            <div key={b.horizon} className={cn("rounded-[8px] border px-2.5 py-2", b.horizon === "15m" ? "border-border-strong bg-elevated/40" : "border-border bg-bg-base")}>
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

// ─── Liquidation levels ─────────────────────────────────────────

function LiqPanel({ of }: { of: OrderflowState }) {
  const px = of.lastPx ?? 0;
  const levels = (of.cohorts?.data?.liqLevels ?? []).filter((l) => px > 0 && Math.abs(l.px - px) / px <= 0.25);
  const above = levels.filter((l) => l.px > px).sort((a, b) => a.px - b.px).slice(0, 3);
  const below = levels.filter((l) => l.px <= px).sort((a, b) => b.px - a.px).slice(0, 3);
  return (
    <div className="ds-panel">
      <div className="px-4 pt-4 flex items-baseline justify-between">
        <span className="ds-section-title">Liquidation levels</span>
        <span className="ds-label">tracked wallets</span>
      </div>
      <p className="px-4 mt-1 text-[11.5px] text-txt-muted leading-[1.5]">
        Where tracked sharps and donors get force-closed. A move into a cluster can accelerate as liquidations fire. Tracked
        wallets only, not the whole market.
      </p>
      {!of.cohorts ? (
        <div className="m-4 h-[60px] skeleton" />
      ) : above.length + below.length === 0 ? (
        <div className="px-4 py-4 text-[12px] text-txt-muted">No tracked liquidations within 25% of price.</div>
      ) : (
        <div className="px-4 pt-2 pb-3">
          {[...above.reverse(), null, ...below].map((l, i) =>
            l === null ? (
              <div key="px" className="flex items-center gap-2 my-1.5">
                <span className="flex-1 h-px bg-border-strong" />
                <span className="ds-num text-[11px] text-txt-primary">{fmtPrice(px)}</span>
                <span className="flex-1 h-px bg-border-strong" />
              </div>
            ) : (
              <LiqRow key={i} l={l} px={px} />
            )
          )}
        </div>
      )}
    </div>
  );
}

function LiqRow({ l, px }: { l: import("@/lib/cohorts/cohorts").LiqLevel; px: number }) {
  const longSide = l.longUsd >= l.shortUsd;
  const usd = l.longUsd + l.shortUsd;
  const dist = ((l.px - px) / px) * 100;
  return (
    <div className="flex items-center h-7 text-[12px]">
      <span className={cn("w-[86px] font-medium", longSide ? "text-warning" : "text-[#60A5FA]")}>{longSide ? "Long liqs" : "Short liqs"}</span>
      <span className="ds-num text-txt-primary flex-1">{fmtPrice(l.px)}</span>
      <span className="ds-num text-txt-secondary w-16 text-right">{dist > 0 ? "+" : ""}{dist.toFixed(1)}%</span>
      <span className="ds-num text-txt-primary w-20 text-right">{fmtUsd(usd).replace("+", "")}</span>
      <span className="ds-num text-txt-muted w-10 text-right">{l.wallets}w</span>
    </div>
  );
}
