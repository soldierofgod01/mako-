"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "@/stores/app-store";
import { CoinPicker, fmtPrice } from "@/components/bias/bias-module";
import { BarChart, Panel, Stat, TimeChart, type SeriesSpec } from "./charts";
import { CostBasisPanel, PulsePanel } from "@/components/bias/pulse-panel";
import { VolPanel } from "@/components/bias/vol-panel";
import { useVol } from "@/lib/vol/use-vol";
import type { CohortsResponse } from "@/lib/hooks/use-orderflow";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Analytics — Velo-style per-coin dashboard, Hyperliquid data only.
// One idea per panel. Panels that depend on Mako's own history (OI,
// sharps vs donors) say how much history exists instead of faking it.
// ════════════════════════════════════════════════════════════════

interface Resp {
  coin: string;
  hourly: { t: number; c: number; v: number }[];
  funding: { t: number; apr: number }[];
  oi: { t: number; oiUsd: number }[];
  cohort: { t: number; divergence: number; relative: number | null }[];
  byHour: { hour: number; avg: number; n: number }[];
  byWeekday: { label: string; avg: number; n: number }[];
  sessions: Record<"asia" | "eu" | "us", { t: number; v: number }[]>;
  hours: { candles1h: number; days: number; oiSpanH: number };
}
interface Ctx {
  ctx: { markPx: number; oiUsd: number; fundingHourly: number; volume24hUsd: number; change24hPct: number; maxLeverage: number };
}

const RANGES = { "1W": 7, "1M": 30 } as const;

type ViewId = "overview" | "pulse" | "vol" | "basis";
const VIEWS: { id: ViewId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "pulse", label: "Market pulse" },
  { id: "vol", label: "Volatility" },
  { id: "basis", label: "Cost basis" },
];
type Range = keyof typeof RANGES;

const usd = (x: number) => {
  const a = Math.abs(x);
  const s = x < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}b`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}m`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}k`;
  return `${s}$${a.toFixed(0)}`;
};
const pct = (d: number) => (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;
const fmtPct2 = pct(2);
const fmtPct1 = pct(1);
const fmtPct3 = pct(3);
const fmtSigned = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}`;

const C = { mint: "#33FFA3", blue: "#4C8DFF", violet: "#B26BFF", amber: "#F5B83D", cyan: "#2BD4D9", orange: "#F0643C" };

export function AnalyticsModule() {
  const { biasCoin, setBiasCoin } = useAppStore();
  const [range, setRange] = useState<Range>("1W");
  const [view, setView] = useState<ViewId>("overview");
  useEffect(() => {
    try {
      const v = localStorage.getItem("mako:analytics:view") as ViewId | null;
      if (v && VIEWS.some((x) => x.id === v)) setView(v);
    } catch { /* ignore */ }
  }, []);
  const pickView = (v: ViewId) => { setView(v); try { localStorage.setItem("mako:analytics:view", v); } catch { /* ignore */ } };
  useEffect(() => {
    try {
      const saved = localStorage.getItem("mako:bias:coin");
      if (saved && saved !== biasCoin) setBiasCoin(saved);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["analytics", biasCoin],
    queryFn: async (): Promise<Resp> => {
      const r = await fetch(`/api/analytics?coin=${encodeURIComponent(biasCoin)}`);
      if (!r.ok) throw new Error("analytics");
      return r.json();
    },
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const { data: ctxData } = useQuery({
    queryKey: ["analytics-ctx", biasCoin],
    queryFn: async (): Promise<Ctx> => {
      const r = await fetch(`/api/bias?coin=${encodeURIComponent(biasCoin)}`);
      if (!r.ok) throw new Error("ctx");
      return r.json();
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  // "Now" section: same queries (and cache keys) the Terminal uses.
  const px = ctxData?.ctx.markPx ?? null;
  const vol = useVol(biasCoin, px, 3_600_000);
  const { data: cohorts } = useQuery({
    queryKey: ["bias-cohorts", biasCoin],
    queryFn: async (): Promise<CohortsResponse> => {
      const r = await fetch(`/api/cohorts?coin=${encodeURIComponent(biasCoin)}`);
      if (!r.ok) throw new Error("cohorts failed");
      return r.json();
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const S = useMemo(() => {
    if (!data) return null;
    // Window anchored on the newest data point, so charts only rebuild when data or range change.
    const newest = Math.max(data.hourly[data.hourly.length - 1]?.t ?? 0, data.funding[data.funding.length - 1]?.t ?? 0);
    const since = newest - RANGES[range] * 86_400_000;
    const cut = <T extends { t: number }>(a: T[]) => a.filter((x) => x.t >= since);
    const price: SeriesSpec[] = [{ kind: "area", color: C.blue, data: cut(data.hourly).map((x) => ({ t: x.t, v: x.c })) }];
    const volume: SeriesSpec[] = [{ kind: "histogram", color: C.blue, data: cut(data.hourly).map((x) => ({ t: x.t, v: x.v })) }];
    const funding: SeriesSpec[] = [{ kind: "line", color: C.amber, data: cut(data.funding).map((x) => ({ t: x.t, v: x.apr })) }];
    const oi: SeriesSpec[] = [{ kind: "area", color: C.violet, data: cut(data.oi).map((x) => ({ t: x.t, v: x.oiUsd })) }];
    const cohort: SeriesSpec[] = [
      { kind: "line", color: C.mint, data: cut(data.cohort).map((x) => ({ t: x.t, v: x.divergence })) },
      { kind: "line", color: C.violet, data: cut(data.cohort).filter((x) => x.relative != null).map((x) => ({ t: x.t, v: x.relative as number })) },
    ];
    const sessions: SeriesSpec[] = [
      { kind: "line", color: C.blue, data: data.sessions.us.map((x) => ({ t: x.t, v: x.v })) },
      { kind: "line", color: C.violet, data: data.sessions.eu.map((x) => ({ t: x.t, v: x.v })) },
      { kind: "line", color: C.amber, data: data.sessions.asia.map((x) => ({ t: x.t, v: x.v })) },
    ];
    return { price, volume, funding, oi, cohort, sessions };
  }, [data, range]);

  const ctx = ctxData?.ctx;
  const nowHour = new Date().getUTCHours();
  const today = (new Date().getUTCDay() + 6) % 7;
  const oiSpan = data?.hours.oiSpanH ?? 0;
  const cohortN = data?.cohort.length ?? 0;

  return (
    <div className="flex-1 overflow-y-auto bg-bg-base">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-bg-base/95 backdrop-blur border-b border-border">
        <div className="h-14 px-4 flex items-center gap-4">
          <CoinPicker coin={biasCoin} onPick={setBiasCoin} />
          <div className="flex items-center gap-1">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => pickView(v.id)}
                className={cn("h-7 px-3 rounded-full text-[13px] font-medium transition-colors", view === v.id ? "bg-elevated-2 text-txt-primary" : "text-txt-secondary hover:text-txt-primary")}
              >
                {v.label}
              </button>
            ))}
          </div>
          {view === "overview" && <div className="flex items-center rounded-md border border-border p-0.5">
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <button key={r} onClick={() => setRange(r)} className={cn("h-6 px-2.5 rounded text-[12px] font-medium", range === r ? "bg-elevated text-txt-primary" : "text-txt-muted hover:text-txt-primary")}>
                {r}
              </button>
            ))}
          </div>}
          <div className="ml-auto hidden xl:flex items-center gap-6">
            <Stat label="Price" value={ctx ? fmtPrice(ctx.markPx) : "—"} />
            <Stat label="24h" value={ctx ? fmtPct2(ctx.change24hPct) : "—"} tone={ctx ? (ctx.change24hPct >= 0 ? "pos" : "neg") : undefined} />
            <Stat label="Open interest" value={ctx ? usd(ctx.oiUsd) : "—"} />
            <Stat label="Funding APR" value={ctx ? fmtPct1(ctx.fundingHourly * 24 * 365 * 100) : "—"} />
            <Stat label="24h volume" value={ctx ? usd(ctx.volume24hUsd) : "—"} />
            <Stat label="Max leverage" value={ctx ? `${ctx.maxLeverage}×` : "—"} />
          </div>
        </div>
      </div>

      {view === "overview" && (
        <>
      <div className="px-3 pt-3">
        {isError ? (
          <div className="py-24 text-center text-[13px] text-txt-muted">Couldn&rsquo;t load analytics for {biasCoin}. Retrying…</div>
        ) : isLoading || !data || !S ? (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[300px] rounded-lg border border-border skeleton" />)}
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            <Panel title={`${biasCoin} Price`}>
              <TimeChart series={S.price} format={(v) => fmtPrice(v)} />
            </Panel>
            <Panel title={`${biasCoin} Open Interest`} note={oiSpan < RANGES[range] * 24 ? `Mako has tracked OI for ${oiSpan < 1 ? `${Math.round(oiSpan * 60)} min` : `${oiSpan.toFixed(1)} h`} (builds to 7 days)` : undefined}>
              <TimeChart series={S.oi} format={usd} empty="OI history is building — Hyperliquid has no OI history, so Mako records its own every 5 minutes." />
            </Panel>
            <Panel title={`${biasCoin} Funding Rate (APR)`}>
              <TimeChart series={S.funding} format={fmtPct1} zeroLine />
            </Panel>
            <Panel title={`${biasCoin} Volume`} note="Hourly, Hyperliquid">
              <TimeChart series={S.volume} format={usd} />
            </Panel>
            <Panel
              title={`${biasCoin} Sharps vs Donors`}
              legend={[{ label: "Divergence", color: C.mint }, { label: "vs market", color: C.violet }]}
              note={cohortN < 20 ? `${cohortN} reads logged so far` : undefined}
            >
              <TimeChart series={S.cohort} format={fmtSigned} zeroLine empty="Logged every 15 minutes when tracked wallets hold this coin. Check back soon." />
            </Panel>
            <Panel title={`${biasCoin} Cumulative Return by Session`} legend={[{ label: "US", color: C.blue }, { label: "Europe", color: C.violet }, { label: "Asia", color: C.amber }]} note="30d · UTC hours: Asia 0–8, EU 8–14, US 14–24">
              <TimeChart series={S.sessions} format={fmtPct1} zeroLine />
            </Panel>
            <Panel title={`${biasCoin} Average Return by Hour (UTC)`} note={`1h candles, last 30 days · current hour highlighted`}>
              <BarChart data={data.byHour.map((h) => ({ label: String(h.hour), value: h.avg }))} format={fmtPct3} highlight={nowHour} xEvery={3} />
            </Panel>
            <div className="xl:col-span-2 min-w-0 flex">
              <div className="flex-1 min-w-0 [&>section]:h-full">
                <Panel title={`${biasCoin} Average Return by Day (UTC)`} note={`Daily candles, last ${data.hours.days} days · today highlighted`}>
                  <BarChart data={data.byWeekday.map((d) => ({ label: d.label, value: d.avg }))} format={fmtPct2} highlight={today} />
                </Panel>
              </div>
            </div>
          </div>
        )}
      </div>
          <div className="px-3">
        <p className="px-1 pt-4 pb-6 text-[11.5px] text-txt-muted max-w-[900px] leading-[1.55]">
          Hyperliquid data only — no cross-exchange aggregation. Price, volume, funding and returns come straight from Hyperliquid. Open
          interest and sharps-vs-donors come from Mako&rsquo;s own recordings, so they start short and grow. Average returns are historical
          tendencies over a small sample, not forecasts.
        </p>
          </div>
        </>
      )}
      {view !== "overview" && (
        // Fill the space under the header so the views have no dead area at the bottom.
        <div className="h-[calc(100%-57px)] min-h-[640px]">
          {view === "pulse" && <PulsePanel vol={vol} coin={biasCoin} oiUsd={ctxData?.ctx.oiUsd ?? null} />}
          {view === "vol" && <VolPanel vol={vol} px={px} />}
          {view === "basis" && <CostBasisPanel px={px} cohorts={cohorts && cohorts.coin === biasCoin ? cohorts : null} />}
        </div>
      )}
    </div>
  );
}


