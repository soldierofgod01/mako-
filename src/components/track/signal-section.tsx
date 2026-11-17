"use client";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Screener screens, graded. Postgres logs a coin every time it ENTERS a
// screen (not flagged in the previous hour) and grades it 1h / 4h / 24h later.
// The headline is vs the average (median) coin over the same window, so a
// market-wide dump doesn't make "Crowded longs" look clever.
// ════════════════════════════════════════════════════════════════

type Hz = "1h" | "4h" | "24h";
interface Bucket {
  n: number;
  hit_rate: number | null;
  edge_bps: number | null;
  ex_hit_rate: number | null;
  ex_edge_bps: number | null;
  ex_median_bps: number | null;
}
interface SignalStats {
  since: string | null;
  events: number;
  counts: Record<string, number>;
  by_signal: Record<string, Partial<Record<Hz, Bucket>>>;
  recent: {
    t: string; coin: string; signal: string; dir: number;
    f8: number | null; oi_chg4h: number | null; px_chg4h: number | null;
    funding_pctile: number | null; oi_z: number | null;
    ret_1h: number | null; mkt_1h: number | null; ret_4h: number | null; mkt_4h: number | null;
  }[];
}

const SCREENS: { id: string; label: string; call: string }[] = [
  { id: "squeeze", label: "Squeeze setup", call: "Expects up" },
  { id: "crowded_longs", label: "Crowded longs", call: "Expects down" },
  { id: "long_squeeze", label: "Long squeeze", call: "Expects down" },
];
const LABEL: Record<string, string> = Object.fromEntries(SCREENS.map((s) => [s.id, s.label]));
const HZ: Hz[] = ["1h", "4h", "24h"];
const MIN_N = 100;

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";

export function SignalSection() {
  const { data, isError } = useQuery({
    queryKey: ["track-signals"],
    queryFn: async (): Promise<SignalStats> => {
      const res = await fetch("/api/track/signals");
      if (!res.ok) throw new Error("signals");
      return res.json();
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <>
      <h2 className="ds-section-title mb-1">Screener screens</h2>
      <p className="text-[12.5px] text-txt-muted mb-3 max-w-[760px]">
        Every time a coin enters a screen it&rsquo;s logged and graded 1, 4 and 24 hours later. A hit means the coin beat the
        average coin in the screen&rsquo;s direction, so a market-wide move doesn&rsquo;t count. Benchmark: 50%.
        {data?.since ? ` Logging since ${fmtDate(data.since)} · ${data.events} entries.` : ""}
      </p>

      {isError ? (
        <div className="ds-panel py-10 text-center text-[13px] text-txt-muted mb-8">Unavailable. Retrying…</div>
      ) : !data ? (
        <div className="ds-panel h-[160px] skeleton mb-8" />
      ) : (
        <>
          <div className="ds-panel overflow-x-auto mb-4">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-[1.4fr_repeat(3,1fr)] gap-3 px-4 h-9 items-center border-b border-border ds-label text-[11.5px]">
                <span>Screen</span>
                {HZ.map((h) => <span key={h} className="text-right">{h} later · vs avg coin</span>)}
              </div>
              {SCREENS.map((s) => (
                <div key={s.id} className="grid grid-cols-[1.4fr_repeat(3,1fr)] gap-3 px-4 py-3 items-center border-b border-border last:border-b-0">
                  <div>
                    <div className="text-[13px] font-medium text-txt-primary">{s.label}</div>
                    <div className="ds-label mt-0.5">{s.call} · {data.counts[s.id] ?? 0} entries</div>
                  </div>
                  {HZ.map((h) => <Cell key={h} b={data.by_signal[s.id]?.[h]} />)}
                </div>
              ))}
            </div>
          </div>

          <h3 className="ds-label mb-2">Latest entries</h3>
          <div className="ds-panel overflow-x-auto mb-3">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[1fr_0.8fr_1.1fr_0.8fr_0.8fr_0.8fr_0.9fr_0.9fr] gap-3 px-4 h-9 items-center border-b border-border ds-label text-[11.5px]">
                <span>Entered</span>
                <span>Coin</span>
                <span>Screen</span>
                <span className="text-right">Funding 8h</span>
                <span className="text-right">Fund. pctile</span>
                <span className="text-right">OI z</span>
                <span className="text-right">1h vs avg</span>
                <span className="text-right">4h vs avg</span>
              </div>
              {data.recent.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-txt-muted">No entries yet.</div>
              ) : (
                data.recent.slice(0, 15).map((r, i) => (
                  <div key={`${r.t}-${r.coin}-${r.signal}-${i}`} className="grid grid-cols-[1fr_0.8fr_1.1fr_0.8fr_0.8fr_0.8fr_0.9fr_0.9fr] gap-3 px-4 h-9 items-center border-b border-border last:border-b-0">
                    <span className="ds-num text-[12px] text-txt-secondary">{fmtDate(r.t)}</span>
                    <span className="text-[12.5px] font-medium text-txt-primary">{r.coin}</span>
                    <span className="text-[12px] text-txt-secondary">{LABEL[r.signal] ?? r.signal}</span>
                    <span className="ds-num text-[12px] text-right text-txt-secondary">{r.f8 == null ? "—" : `${r.f8.toFixed(4)}%`}</span>
                    <span className="ds-num text-[12px] text-right text-txt-secondary">{r.funding_pctile == null ? "—" : `${Math.round(r.funding_pctile * 100)}`}</span>
                    <span className="ds-num text-[12px] text-right text-txt-secondary">{r.oi_z == null ? "—" : r.oi_z.toFixed(1)}</span>
                    <Ex r={r.ret_1h} m={r.mkt_1h} dir={r.dir} />
                    <Ex r={r.ret_4h} m={r.mkt_4h} dir={r.dir} />
                  </div>
                ))
              )}
            </div>
          </div>
          <p className="text-[12px] text-txt-muted leading-[1.55] max-w-[760px] mb-8">
            Fund. pctile and OI z measure each entry against that coin&rsquo;s own history (up to 7 days). They aren&rsquo;t used to
            pick entries yet; they&rsquo;re logged so we can test whether relative thresholds beat the fixed ones. Under {MIN_N} entries,
            treat any number as noise.
          </p>
        </>
      )}
    </>
  );
}

function Cell({ b }: { b?: Bucket }) {
  if (!b || b.n === 0) return <div className="text-right ds-num text-[12px] text-txt-muted">—</div>;
  const rate = b.ex_hit_rate;
  const edge = b.ex_edge_bps;
  return (
    <div className="text-right">
      <div className={cn("ds-num text-[15px] font-semibold", rate == null ? "text-txt-muted" : rate > 0.5 ? "text-positive" : rate < 0.5 ? "text-negative" : "text-txt-primary")}>
        {rate == null ? "—" : `${(rate * 100).toFixed(0)}%`}
      </div>
      <div className="ds-num text-[11.5px] text-txt-secondary">
        {edge == null ? "—" : `${edge >= 0 ? "+" : ""}${edge.toFixed(0)} bps`} · n {b.n}
      </div>
      {b.n < MIN_N && <div className="text-[10.5px] text-warning">thin sample</div>}
    </div>
  );
}

// Excess return in the screen's direction; green = went the way the screen said.
function Ex({ r, m, dir }: { r: number | null; m: number | null; dir: number }) {
  if (r == null || m == null) return <span className="ds-num text-[12px] text-right text-txt-muted">pending</span>;
  const v = (r - m) * dir * 100;
  return (
    <span className={cn("ds-num text-[12px] text-right", v >= 0 ? "text-positive" : "text-negative")}>
      {v >= 0 ? "+" : ""}{v.toFixed(2)}%
    </span>
  );
}
