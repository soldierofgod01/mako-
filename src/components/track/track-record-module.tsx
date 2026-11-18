"use client";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { SignalSection } from "./signal-section";

// ════════════════════════════════════════════════════════════════
// Public track record. Every 15 min the server snapshots the Bias Scanner;
// 1h and 4h later the database records the price and grades the call.
// Nothing is deleted. Numbers include the benchmark that makes them honest.
// ════════════════════════════════════════════════════════════════

interface Bucket {
  n: number;
  hits: number;
  hit_rate: number | null;
  avg_edge_bps: number | null;
  down_share?: number | null; // calls only: share of these coins that fell
}

interface Stats {
  started_at: string | null;
  last_tick: string | null;
  ticks: number;
  snapshots: number;
  calls_1h: Bucket;
  calls_4h: Bucket;
  standouts_1h: Bucket;
  standouts_4h: Bucket;
  recent: {
    t: string;
    coin: string;
    positioning: number;
    relative: number | null;
    ret_1h: number;
    ex_1h: number;
  }[];
}

interface FlowH {
  n_min: number; hit_min: number | null; edge_min_bps: number | null; bench_min: number | null;
  n_ep: number; hit_ep: number | null; edge_ep_bps: number | null;
}
interface FlowStats {
  since: string | null;
  last: string | null;
  coins: string[] | null;
  horizons: Partial<Record<"5m" | "15m" | "1h", FlowH>>;
}

export function TrackRecordModule() {
  const { data: flow } = useQuery({
    queryKey: ["track-flow"],
    queryFn: async (): Promise<FlowStats> => {
      const res = await fetch("/api/track/flow");
      if (!res.ok) throw new Error("flow");
      return res.json();
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const { data, isLoading, isError } = useQuery({
    queryKey: ["track-stats"],
    queryFn: async (): Promise<Stats> => {
      const res = await fetch("/api/track/stats");
      if (!res.ok) throw new Error("stats");
      return res.json();
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const fmtDate = (s: string | null) =>
    s ? new Date(s).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 md:px-10 py-8 max-w-[1100px] mx-auto">
        <div className="mb-7">
          <h1 className="ds-page-title">Track record</h1>
          <p className="mt-2 text-[14px] text-txt-secondary leading-[1.55] max-w-[720px]">
            Mako records its own calls around the clock and grades them automatically against what price did next. Nothing is
            edited or deleted. Each number sits next to the benchmark it has to beat.
          </p>
        </div>

        {isError ? (
          <div className="ds-panel ds-panel-signature py-14 text-center text-[13px] text-txt-muted">Track record unavailable. Retrying…</div>
        ) : isLoading || !data ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => <div key={i} className="ds-panel h-[170px] skeleton" />)}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-8 gap-y-2 mb-5 ds-label">
              <span>Logging since <span className="ds-num text-txt-primary">{fmtDate(data.started_at)}</span></span>
              <span>Last snapshot <span className="ds-num text-txt-primary">{fmtDate(data.last_tick)}</span></span>
              <span>Snapshots <span className="ds-num text-txt-primary">{data.ticks.toLocaleString()}</span></span>
              <span>Logged reads <span className="ds-num text-txt-primary">{data.snapshots.toLocaleString()}</span></span>
            </div>

            <h2 className="ds-section-title mb-1">Order-flow bias (Terminal)</h2>
            <p className="text-[12.5px] text-txt-muted mb-3 max-w-[760px]">
              The Terminal&rsquo;s smoothed bias, recorded every minute around the clock for {flow?.coins?.length ? flow.coins.join(", ") : "BTC, ETH, SOL, HYPE"} and
              graded 5 minutes, 15 minutes and 1 hour later. The headline is graded per <span className="text-txt-secondary">new call</span> (each time the bias
              turns long or short), because consecutive minutes of the same call aren&rsquo;t independent. Benchmark: a random caller with the same
              long/short mix.
              {flow?.since ? ` Recording since ${fmtDate(flow.since)}.` : " Starts once the recorder is running."}
            </p>
            <div className="grid gap-4 md:grid-cols-3 mb-8">
              {(["5m", "15m", "1h"] as const).map((h) => <FlowCard key={h} horizon={h} s={flow?.horizons?.[h]} />)}
            </div>

            <SignalSection />

            <h2 className="ds-section-title mb-1">Positioning calls</h2>
            <p className="text-[12.5px] text-txt-muted mb-3 max-w-[760px]">
              Coins with a strong read (|positioning| ≥ 30). A hit means price moved the way the read pointed. Benchmark: how often
              those coins fell anyway. Sharps are short most of the market, so a high hit rate can just mean &ldquo;the market went
              down&rdquo;.
            </p>
            <div className="grid gap-4 md:grid-cols-2 mb-8">
              <StatCard title="1 hour later" b={data.calls_1h} benchmark={data.calls_1h.down_share} benchLabel="coins that fell" />
              <StatCard title="4 hours later" b={data.calls_4h} benchmark={data.calls_4h.down_share} benchLabel="coins that fell" />
            </div>

            <h2 className="ds-section-title mb-1">Stand-outs</h2>
            <p className="text-[12.5px] text-txt-muted mb-3 max-w-[760px]">
              Coins where sharps break hardest from their own market-wide stance (|vs mkt| ≥ 40), graded against the average coin over
              the same window. This removes the market move, so it&rsquo;s the stricter test. Benchmark: 50%.
            </p>
            <div className="grid gap-4 md:grid-cols-2 mb-8">
              <StatCard title="1 hour later · vs average coin" b={data.standouts_1h} benchmark={0.5} benchLabel="coin flip" />
              <StatCard title="4 hours later · vs average coin" b={data.standouts_4h} benchmark={0.5} benchLabel="coin flip" />
            </div>

            <h2 className="ds-section-title mb-3">Latest graded calls · 1h</h2>
            <div className="ds-panel overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_0.8fr_0.8fr_0.9fr_0.9fr_0.6fr] gap-3 px-4 h-9 items-center border-b border-border ds-label text-[11.5px]">
                <span>Logged</span>
                <span>Coin</span>
                <span className="text-right">Positioning</span>
                <span className="text-right">vs mkt</span>
                <span className="text-right">Move 1h</span>
                <span className="text-right">vs avg coin</span>
                <span className="text-right">Result</span>
              </div>
              {data.recent.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-txt-muted">
                  No graded calls yet — the first ones land about an hour after logging starts.
                </div>
              ) : (
                data.recent.map((r, i) => {
                  const hit = Math.sign(r.ret_1h) === Math.sign(r.positioning);
                  return (
                    <div key={`${r.t}-${r.coin}-${i}`} className="grid grid-cols-[1fr_1fr_0.8fr_0.8fr_0.9fr_0.9fr_0.6fr] gap-3 px-4 h-9 items-center border-b border-border last:border-b-0">
                      <span className="ds-num text-[12px] text-txt-secondary">{fmtDate(r.t)}</span>
                      <span className="text-[12.5px] font-medium text-txt-primary">{r.coin}</span>
                      <span className={cn("ds-num text-[12px] text-right", r.positioning > 0 ? "text-positive" : "text-negative")}>
                        {r.positioning > 0 ? "+" : ""}{r.positioning}
                      </span>
                      <span className="ds-num text-[12px] text-right text-txt-secondary">
                        {r.relative == null ? "—" : `${r.relative > 0 ? "+" : ""}${r.relative}`}
                      </span>
                      <Pct v={r.ret_1h} />
                      <Pct v={r.ex_1h} />
                      <span className={cn("text-[12px] font-medium text-right", hit ? "text-positive" : "text-negative")}>{hit ? "Hit" : "Miss"}</span>
                    </div>
                  );
                })
              )}
            </div>

            <p className="mt-6 text-[12px] text-txt-muted leading-[1.55] max-w-[760px]">
              This grades the Scanner&rsquo;s positioning signal, the part that can run on a server around the clock. The Terminal&rsquo;s live
              order-flow read needs a live feed per coin and is tracked per browser instead. Prices are Hyperliquid mark prices, with no
              fees or slippage. Under ~100 graded calls, treat any hit rate as noise. Not trade calls.
            </p>
          </>
        )}
        <div className="h-8" />
      </div>
    </div>
  );
}

function StatCard({ title, b, benchmark, benchLabel }: { title: string; b: Bucket; benchmark: number | null | undefined; benchLabel: string }) {
  const rate = b.hit_rate;
  const beat = rate != null && benchmark != null ? rate - benchmark : null;
  const thin = b.n < 100;
  return (
    <div className="ds-panel ds-panel-signature p-5">
      <div className="ds-label mb-3">{title}</div>
      <div className="flex items-end justify-between">
        <div>
          <div className="ds-num text-[30px] font-semibold leading-none text-txt-primary">
            {rate == null ? "—" : `${(rate * 100).toFixed(1)}%`}
          </div>
          <div className="ds-label mt-1.5">hit rate · {b.hits}/{b.n}</div>
        </div>
        <div className="text-right">
          <div className={cn("ds-num text-[15px] font-medium", b.avg_edge_bps == null ? "text-txt-muted" : b.avg_edge_bps >= 0 ? "text-positive" : "text-negative")}>
            {b.avg_edge_bps == null ? "—" : `${b.avg_edge_bps >= 0 ? "+" : ""}${b.avg_edge_bps.toFixed(1)} bps`}
          </div>
          <div className="ds-label mt-1">avg move in call direction</div>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-[12px]">
        <span className="text-txt-muted">
          Benchmark ({benchLabel}): <span className="ds-num text-txt-secondary">{benchmark == null ? "—" : `${(benchmark * 100).toFixed(1)}%`}</span>
        </span>
        <span className={cn("ds-num font-medium", beat == null ? "text-txt-muted" : beat > 0 ? "text-positive" : "text-negative")}>
          {beat == null ? "" : `${beat > 0 ? "+" : ""}${(beat * 100).toFixed(1)} pts`}
        </span>
      </div>
      {thin && <div className="mt-2 text-[11.5px] text-warning">Sample too small to trust ({b.n} / 100).</div>}
    </div>
  );
}

function Pct({ v }: { v: number }) {
  const p = v * 100;
  return (
    <span className={cn("ds-num text-[12px] text-right", p >= 0 ? "text-positive" : "text-negative")}>
      {p >= 0 ? "+" : ""}{p.toFixed(2)}%
    </span>
  );
}

function FlowCard({ horizon, s }: { horizon: string; s?: FlowH }) {
  const rate = s?.hit_ep ?? null;
  const bench = s?.bench_min ?? null;
  const beat = rate != null && bench != null ? rate - bench : null;
  const n = s?.n_ep ?? 0;
  return (
    <div className="ds-panel ds-panel-signature p-5">
      <div className="ds-label mb-3">{horizon} bias · graded {horizon} later</div>
      <div className="flex items-end justify-between">
        <div>
          <div className="ds-num text-[30px] font-semibold leading-none text-txt-primary">{rate == null ? "—" : `${(rate * 100).toFixed(1)}%`}</div>
          <div className="ds-label mt-1.5">per new call · {n} calls</div>
        </div>
        <div className="text-right">
          <div className={cn("ds-num text-[15px] font-medium", s?.edge_ep_bps == null ? "text-txt-muted" : s.edge_ep_bps >= 0 ? "text-positive" : "text-negative")}>
            {s?.edge_ep_bps == null ? "—" : `${s.edge_ep_bps >= 0 ? "+" : ""}${s.edge_ep_bps.toFixed(1)} bps`}
          </div>
          <div className="ds-label mt-1">avg move in call direction</div>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-[12px]">
        <span className="text-txt-muted">
          Benchmark <span className="ds-num text-txt-secondary">{bench == null ? "—" : `${(bench * 100).toFixed(1)}%`}</span>
          {s?.hit_min != null && <> · per minute <span className="ds-num text-txt-secondary">{(s.hit_min * 100).toFixed(1)}%</span></>}
        </span>
        <span className={cn("ds-num font-medium", beat == null ? "text-txt-muted" : beat > 0 ? "text-positive" : "text-negative")}>
          {beat == null ? "" : `${beat > 0 ? "+" : ""}${(beat * 100).toFixed(1)} pts`}
        </span>
      </div>
      {n < 50 && <div className="mt-2 text-[11.5px] text-warning">Sample too small to trust ({n} / 50 calls).</div>}
    </div>
  );
}
