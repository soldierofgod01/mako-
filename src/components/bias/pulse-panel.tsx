"use client";
import { useEffect, useMemo, useState } from "react";
import { fmtPrice } from "@/lib/bias/format";
import type { CohortsResponse } from "@/lib/hooks/use-orderflow";
import type { VolState } from "@/lib/vol/use-vol";
import { BAND_LABEL, GROUPS, groupSummary, usdShort, type Band, type PulseMetric } from "@/lib/pulse/pulse";
import { usePulse } from "@/lib/pulse/use-pulse";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Market Pulse tab — Glassnode Market Pulse format for one HL coin.
// Trader cost basis tab — where tracked HL wallets entered, who's underwater.
// ════════════════════════════════════════════════════════════════

/**
 * Bid + ask notional within ±1% of mid. HL sends 20 levels a side, which at full
 * precision spans only a few hundredths of a percent on BTC — so ask for an
 * aggregated book (3, then 2 sig figs) until 20 levels actually reach ±1%.
 * Aggregated levels straddling the 1% line count only if their price is inside it.
 */
function useDepth(coin: string) {
  const [d, setD] = useState<number | null>(null);
  useEffect(() => {
    let dead = false;
    setD(null);
    const load = async () => {
      for (const nSigFigs of [3, 2]) {
        try {
          const r = await fetch("https://api.hyperliquid.xyz/info", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "l2Book", coin, nSigFigs }),
          });
          if (!r.ok) return;
          const j = (await r.json()) as { levels: { px: string; sz: string }[][] };
          const [bids, asks] = j.levels.map((side) => side.map((l) => ({ px: +l.px, sz: +l.sz })));
          if (!bids?.length || !asks?.length) return;
          const mid = (bids[0].px + asks[0].px) / 2;
          const reaches = bids[bids.length - 1].px <= mid * 0.99 && asks[asks.length - 1].px >= mid * 1.01;
          if (!reaches && nSigFigs === 3) continue;
          let sum = 0;
          for (const l of bids) if (l.px >= mid * 0.99) sum += l.px * l.sz;
          for (const l of asks) if (l.px <= mid * 1.01) sum += l.px * l.sz;
          if (!dead) setD(sum);
          return;
        } catch { return; }
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => { dead = true; clearInterval(id); };
  }, [coin]);
  return d;
}

const BAND_TONE: Record<Band, string> = {
  low: "text-txt-primary bg-white/[0.10]",
  lower: "text-txt-secondary bg-white/[0.04]",
  mid: "text-txt-secondary bg-white/[0.04]",
  upper: "text-txt-secondary bg-white/[0.04]",
  high: "text-txt-primary bg-white/[0.10]",
};

export function PulsePanel({ vol, coin, oiUsd }: { vol: VolState; coin: string; oiUsd: number | null }) {
  const depth = useDepth(coin);
  const p = usePulse(coin, vol, oiUsd, depth);
  if (p.loading && !p.metrics.length) {
    return <div className="p-3 grid grid-cols-4 gap-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[92px] skeleton" />)}</div>;
  }
  if (!p.metrics.length) return <div className="p-4 text-[13px] text-txt-secondary">Couldn&rsquo;t load history for {coin}.</div>;
  return (
    <div className="p-3 grid grid-cols-1 xl:grid-cols-4 lg:grid-cols-2 gap-3">
      {GROUPS.map((g) => {
        const ms = p.metrics.filter((m) => m.group === g.id);
        if (!ms.length) return null;
        const sum = groupSummary(ms);
        return (
          <section key={g.id} className="flex flex-col gap-2 min-w-0">
            <div className="flex items-baseline justify-between px-0.5">
              <span className="text-[13.5px] font-semibold text-txt-primary">{g.label}</span>
              <span className="text-[12px] text-txt-secondary">
                {sum.level ? <span className={cn("font-medium", sum.level === "Moderate" ? "text-txt-secondary" : "text-txt-primary")}>{sum.level}</span> : "live"}
                {sum.trend && <span> · {sum.trend}</span>}
              </span>
            </div>
            {ms.map((m) => <MetricCard key={m.id} m={m} />)}
          </section>
        );
      })}
      <p className="xl:col-span-4 lg:col-span-2 text-[12px] text-txt-muted leading-[1.5]">
        Bands compare each reading with its own history for this coin: below the 20th percentile is the low band, above the 80th the high band.
        Changes are vs ~7 days ago. Open interest and perp CVD histories are still building, and the windows are labelled.
        Book depth uses Hyperliquid&rsquo;s aggregated book so it really spans ±1%, refreshed every 15s. Descriptive, not a trade call.
      </p>
    </div>
  );
}

function MetricCard({ m }: { m: PulseMetric }) {
  return (
    <div className="rounded-[10px] bg-void border border-border px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-txt-secondary truncate">{m.label}</span>
        <span className="ds-num text-[17px] font-semibold text-txt-primary whitespace-nowrap">{m.display}</span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-1">
        {m.band ? (
          <span className={cn("text-[12px] font-medium rounded px-1.5 py-0.5", BAND_TONE[m.band])}>
            {BAND_LABEL[m.band]}{m.pct != null ? ` · p${Math.round(m.pct)}` : ""}
          </span>
        ) : (
          <span className="text-[12px] text-txt-muted">{m.window}</span>
        )}
        {m.change && (
          <span className={cn("ds-num text-[12px] whitespace-nowrap", m.changeSign > 0 ? "text-positive" : m.changeSign < 0 ? "text-negative" : "text-txt-secondary")}>
            {m.change}{!m.change.includes("(") && <span className="text-txt-muted"> 7d</span>}
          </span>
        )}
      </div>
      {m.band && m.window && <div className="text-[11.5px] text-txt-muted mt-0.5">{m.window}</div>}
      <p className="text-[13px] text-[#C2C2C8] leading-[1.45] mt-1">{m.read}</p>
    </div>
  );
}

// ─── Trader cost basis ──────────────────────────────────────────

/** Round a price label to 3 significant figures (68,205.3 → 68,200). */
const roundTo = (x: number) => { const m = 10 ** (Math.floor(Math.log10(Math.abs(x))) - 2); return Math.round(x / m) * m; };

export function CostBasisPanel({ px, cohorts }: { px: number | null; cohorts: CohortsResponse | null | undefined }) {
  const entries = cohorts?.data?.entries ?? null;
  const tracked = cohorts ? cohorts.tracked.sharps + cohorts.tracked.donors : 0;

  const view = useMemo(() => {
    if (!entries?.length || !px) return null;
    const side = (long: boolean) => {
      const es = entries.filter(([, usd]) => (long ? usd > 0 : usd < 0));
      const usd = es.reduce((s, [, u]) => s + Math.abs(u), 0);
      const avg = usd > 0 ? es.reduce((s, [e, u]) => s + e * Math.abs(u), 0) / usd : null;
      const under = es.filter(([e]) => (long ? e > px : e < px)).reduce((s, [, u]) => s + Math.abs(u), 0);
      return { n: es.length, usd, avg, underShare: usd > 0 ? under / usd : null };
    };
    // Entry distribution: range widens until it holds ~90% of tracked notional (10%–40% each side).
    const byDist = entries.map(([e, u]) => ({ d: Math.abs(e / px - 1), u: Math.abs(u) })).sort((a, b) => a.d - b.d);
    const total = byDist.reduce((s, x) => s + x.u, 0);
    let acc = 0, span = 0.1;
    for (const x of byDist) { acc += x.u; if (acc >= total * 0.9) { span = x.d * 1.05; break; } }
    span = Math.min(0.4, Math.max(0.1, span));
    const lo = px * (1 - span), hi = px * (1 + span), rows = 24, step = (hi - lo) / rows;
    const bins = Array.from({ length: rows }, (_, i) => ({ lo: lo + i * step, hi: lo + (i + 1) * step, long: 0, short: 0 }));
    let outside = 0;
    for (const [e, u] of entries) {
      const i = Math.floor((e - lo) / step);
      if (i < 0 || i >= rows) { outside += Math.abs(u); continue; }
      if (u > 0) bins[i].long += u; else bins[i].short += -u;
    }
    return { longs: side(true), shorts: side(false), bins: bins.reverse(), outside, span };
  }, [entries, px]);

  if (!cohorts) return <div className="m-4 h-[120px] skeleton" />;
  if (!view || !px) return <div className="px-4 py-3 text-[13px] text-txt-secondary">No tracked wallets hold this coin right now.</div>;
  const max = Math.max(...view.bins.map((b) => Math.max(b.long, b.short)), 1);
  const pxRow = view.bins.findIndex((b) => px >= b.lo && px < b.hi);

  const SideCard = ({ label, s, long }: { label: string; s: typeof view.longs; long: boolean }) => (
    <div className="rounded-[10px] bg-void border border-border px-3 py-2.5">
      <div className="flex items-baseline justify-between">
        <span className={cn("text-[13px] font-medium", long ? "text-positive" : "text-negative")}>{label}</span>
        <span className="ds-num text-[12px] text-txt-secondary">{s.n} positions · {usdShort(s.usd)}</span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        <div>
          <div className="text-[12px] text-txt-secondary">Break-even (avg entry)</div>
          <div className="ds-num text-[17px] font-semibold text-txt-primary">{s.avg ? fmtPrice(s.avg) : "—"}</div>
          {s.avg && <div className="ds-num text-[12px] text-txt-muted">{((s.avg / px - 1) * 100).toFixed(1)}% from price</div>}
        </div>
        <div>
          <div className="text-[12px] text-txt-secondary">Underwater</div>
          <div className={cn("ds-num text-[17px] font-semibold", "text-txt-primary")}>
            {s.underShare != null ? `${Math.round(s.underShare * 100)}%` : "—"}
          </div>
          <div className="text-[12px] text-txt-muted">of {long ? "long" : "short"} notional</div>
        </div>
      </div>
      <p className="text-[13px] text-[#C2C2C8] leading-[1.45] mt-1.5">
        {s.underShare == null ? "" : s.underShare > 0.6
          ? long
            ? `Most longs are trapped above price. A move back to ${s.avg ? fmtPrice(s.avg) : "their entries"} meets break-even selling.`
            : `Most shorts are trapped below price. Further upside forces covering (squeeze fuel); ${s.avg ? fmtPrice(s.avg) : "their entries"} is where they get out flat.`
          : s.underShare < 0.3
            ? `Most ${long ? "longs" : "shorts"} are in profit — less forced activity, but profit-taking can cap the move.`
            : `Split between profit and loss — no strong trapped side.`}
      </p>
    </div>
  );

  return (
    <div className="p-3 flex gap-3 min-h-full">
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <SideCard label="Tracked longs" s={view.longs} long />
          <SideCard label="Tracked shorts" s={view.shorts} long={false} />
        </div>
        <p className="text-[12px] text-txt-muted leading-[1.5]">
          Entry prices of positions held by {tracked} tracked Hyperliquid wallets (top profitable + biggest losers), refreshed every few minutes.
          A sample of the market, not all of it: Hyperliquid positions are public, so this is real entries, not an estimate.
        </p>
      </div>
      <div className="w-[300px] shrink-0 rounded-[10px] bg-void border border-border px-3 py-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] text-txt-secondary">Entry distribution · ±{Math.round(view.span * 100)}%</span>
          <span className="text-[12px] text-txt-muted"><span className="text-positive">long</span> · <span className="text-negative">short</span></span>
        </div>
        <div className="mt-1.5">
          {view.bins.map((b, i) => (
            <div key={i} className={cn("grid grid-cols-[1fr_58px_1fr] items-center h-[13px] gap-1", i === pxRow && "bg-white/[0.06] rounded-sm")}>
              <div className="flex justify-end h-2"><div className="h-full rounded-sm bg-negative/70" style={{ width: `${(b.short / max) * 100}%` }} /></div>
              <span className={cn("ds-num text-[9.5px] text-center", i === pxRow ? "text-txt-primary font-semibold" : "text-txt-muted")}>{fmtPrice(roundTo((b.lo + b.hi) / 2))}</span>
              <div className="h-2"><div className="h-full rounded-sm bg-positive/70" style={{ width: `${(b.long / max) * 100}%` }} /></div>
            </div>
          ))}
        </div>
        {view.outside > 0 && <div className="mt-1 text-[11.5px] text-txt-muted">{usdShort(view.outside)} entered further away</div>}
      </div>
    </div>
  );
}
