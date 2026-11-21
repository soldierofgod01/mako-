"use client";
import { useEffect, useState } from "react";
import { STATE_COPY, type RegimeRead, type RegimeState as RState } from "@/lib/bias/regime";
import type { RegimeState } from "@/lib/bias/use-regime";
import { fmtPrice } from "@/lib/bias/format";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Range regime card — the Terminal's headline (bias v2).
// Not directional on purpose: colours are amber (breakout) and blue (hold),
// never green/red, so it can't be read as long/short.
// ════════════════════════════════════════════════════════════════

const TONE: Record<RState, { text: string; dot: string; glow: string | null; chip: string }> = {
  breakout: { text: "text-warning", dot: "bg-warning", glow: "rgba(245,158,11,", chip: "text-warning bg-warning/10" },
  normal: { text: "text-txt-secondary", dot: "bg-txt-muted", glow: null, chip: "text-txt-secondary bg-white/[0.05]" },
  "lean-hold": { text: "text-tier-diamond", dot: "bg-tier-diamond", glow: "rgba(96,165,250,", chip: "text-tier-diamond bg-tier-diamond/10" },
  hold: { text: "text-tier-diamond", dot: "bg-tier-diamond", glow: "rgba(96,165,250,", chip: "text-tier-diamond bg-tier-diamond/10" },
};

const pctTxt = (p: number) => `${Math.round(p * 100)}%`;

/** Has live price already traded through the range this read is about? */
function brokeLine(r: RegimeRead, px: number | null, label: string): string | null {
  if (px == null) return null;
  const pad = 0.1 * (r.rangeHi - r.rangeLo);
  if (px > r.rangeHi + pad) return `Price is already above the ${label} high: this range has broken up.`;
  if (px < r.rangeLo - pad) return `Price is already below the ${label} low: this range has broken down.`;
  return null;
}

function volWord(pct: number) {
  if (pct < 0.1) return "very quiet";
  if (pct < 0.3) return "quiet";
  if (pct < 0.7) return "normal";
  if (pct < 0.9) return "hot";
  return "very hot";
}

function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Compact chip for the market bar. */
export function RegimeChip({ regime }: { regime: RegimeState }) {
  const r = regime.h4;
  if (!r) return null;
  const t = TONE[r.state];
  return (
    <span className={cn("h-8 px-3 rounded-full flex items-center gap-2 text-[12px] font-medium", t.chip)} title="4h range regime — whether the range breaks, not which way">
      <span className={cn("w-1.5 h-1.5 rounded-full", t.dot)} />
      {STATE_COPY[r.state].title}
      <span className="ds-num opacity-80">4h · {pctTxt(r.pBreak)}</span>
    </span>
  );
}

export function RegimeCard({ regime, livePx }: { regime: RegimeState; livePx: number | null }) {
  const now = useNow();
  const r = regime.h4;
  if (!r) {
    if (regime.error) {
      return (
        <div className="ds-panel ds-panel-signature p-4 text-[12.5px] text-txt-muted">
          Can&rsquo;t load candles from Hyperliquid for the range regime right now.
        </div>
      );
    }
    if (!regime.loading) {
      return (
        <div className="ds-panel ds-panel-signature p-4 text-[12.5px] text-txt-muted">
          Not enough history on this coin for a range regime yet (needs ~11 days of candles).
        </div>
      );
    }
    return <div className="ds-panel ds-panel-signature h-[230px] skeleton" />;
  }
  const t = TONE[r.state];
  const copy = STATE_COPY[r.state];
  const glow = t.glow ? `radial-gradient(120% 70% at 85% -10%, ${t.glow}0.12), transparent 65%)` : undefined;
  const nextMin = Math.max(0, Math.ceil((r.nextAt - now) / 60_000));

  return (
    <div className="ds-panel ds-panel-signature p-4 relative overflow-hidden">
      {glow && <div className="absolute inset-0 pointer-events-none" style={{ background: glow }} />}
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="ds-label mb-1">Range regime · next 4h</div>
            <div className={cn("text-[24px] font-semibold tracking-[-0.02em] leading-[1.05]", t.text)}>{copy.title}</div>
            <div className="text-[13px] text-txt-primary mt-1.5">{copy.line}</div>
          </div>
          <div className="text-right shrink-0">
            <div className={cn("ds-num text-[26px] font-semibold leading-none", t.text)}>{pctTxt(r.pBreak)}</div>
            <div className="ds-label mt-1">range breaks</div>
            <div className="ds-micro mt-0.5">usual {pctTxt(r.base)}</div>
          </div>
        </div>

        <RangeBar r={r} px={livePx} />
        {brokeLine(r, livePx, "4h") && <p className="mt-2 text-[12px] text-warning">{brokeLine(r, livePx, "4h")}</p>}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Mini label="Typical next-4h range" value={`≈ ${r.expRangePct.toFixed(r.expRangePct < 1 ? 2 : 1)}%`} />
          <Mini label="Recent vol" value={`${volWord(r.pct)} · ${Math.round(r.pct * 100)}th pct`} />
        </div>

        {regime.h1 && <OneHourRow r={regime.h1} px={livePx} />}

        <p className="mt-3 text-[11.5px] text-txt-muted leading-[1.5]">
          Says whether price trades past the last 4h high or low, not which way.
          Tested on 20 coins without lookahead: &ldquo;breakout likely&rdquo; calls broke ~83%, &ldquo;range likely holds&rdquo; ~42%.
          Updates only at bar close · next in {nextMin} min.
          {r.thin && " Limited history on this coin, so the read is less reliable."}
        </p>
      </div>
    </div>
  );
}

function RangeBar({ r, px }: { r: RegimeRead; px: number | null }) {
  const p = px ?? r.lastClose;
  const pos = r.rangeHi > r.rangeLo ? Math.max(0, Math.min(1, (p - r.rangeLo) / (r.rangeHi - r.rangeLo))) : 0.5;
  return (
    <div className="mt-5">
      <div className="flex justify-between ds-micro mb-1.5">
        <span>4h low</span>
        <span>4h high</span>
      </div>
      <div className="relative h-2 rounded-full bg-elevated">
        <div className="absolute inset-y-0 left-0 w-[12%] rounded-l-full bg-white/[0.06]" />
        <div className="absolute inset-y-0 right-0 w-[12%] rounded-r-full bg-white/[0.06]" />
        <div
          className="absolute -top-[3px] w-[3px] h-[14px] rounded-full bg-txt-primary transition-[left] duration-700"
          style={{ left: `calc(${pos * 100}% - 1.5px)` }}
          title={`Price ${fmtPrice(p)}`}
        />
      </div>
      <div className="flex justify-between mt-1.5 ds-num text-[12px] text-txt-primary">
        <span>{fmtPrice(r.rangeLo)}</span>
        <span className="text-txt-muted">{(((r.rangeHi - r.rangeLo) / r.lastClose) * 100).toFixed(2)}% wide</span>
        <span>{fmtPrice(r.rangeHi)}</span>
      </div>
    </div>
  );
}

function OneHourRow({ r, px }: { r: RegimeRead; px: number | null }) {
  const t = TONE[r.state];
  const broke = brokeLine(r, px, "1h");
  return (
    <div className="mt-2 rounded-[8px] border border-border bg-void px-2.5 py-2">
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="ds-label text-[11px]">Next 1h</div>
        <div className={cn("text-[12.5px] font-medium", t.text)}>{STATE_COPY[r.state].title}</div>
      </div>
      <div className="text-right ds-num text-[11.5px] text-txt-secondary leading-[1.4]">
        <div><span className={t.text}>{pctTxt(r.pBreak)}</span> breaks · usual {pctTxt(r.base)}</div>
        <div>{fmtPrice(r.rangeLo)} – {fmtPrice(r.rangeHi)}</div>
      </div>
    </div>
    {broke && <div className="mt-1 text-[11.5px] text-warning">{broke}</div>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-void border border-border px-2.5 py-2">
      <div className="ds-label text-[11px]">{label}</div>
      <div className="ds-num text-[13px] text-txt-primary mt-0.5">{value}</div>
    </div>
  );
}
