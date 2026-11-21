// ════════════════════════════════════════════════════════════════
// Range regime — the Terminal's headline read (bias v2, Nov 2026).
//
// Answers ONE question with a measured edge: will the recent range break,
// or hold? It does NOT say which way. Direction tested at coin-flip on every
// input and timeframe we have (see project doc "terminal-accuracy-findings").
//
// Method (identical to the research, no lookahead):
//   rv    = sqrt(Σ r²) over the last N closed bars (log returns)
//   lrv   = mean of rv over the last 7N bars
//   comp  = ln(rv / lrv)              → < 0 means compressed / quiet
//   pct   = share of the trailing ~10 days of comp values below today's
//   P(break) = calibrated from pct (table below)
//   "break" = the next N bars trade more than 10% of the range beyond the
//             last N bars' high or low.
// Only CLOSED bars are used, so the read only changes when a bar closes.
//
// Calibration: HL candles, 20 coins, trailing-10d percentiles.
//   1h window (5m bars): 8–20 Nov 2026, n=5,760, base 73%.
//   4h window (15m bars): 6 Oct–20 Nov 2026, n=5,480, base 72%.
//   Same shape in both halves of the sample and on majors vs alts.
//   7-month 1h-bar test (fixed quintiles) showed the same effect.
// Part of the effect is mechanical (a narrow range is easier to exceed).
// ════════════════════════════════════════════════════════════════

export interface RCandle { t: number; o: number; h: number; l: number; c: number }

export type RegimeId = "1h" | "4h";
export type RegimeState = "breakout" | "normal" | "lean-hold" | "hold";

export interface RegimeConfig {
  id: RegimeId;
  interval: "5m" | "15m";
  barMs: number;
  n: number;              // bars per window
  lookbackBars: number;   // trailing percentile window (~10 days)
  /** ln(next window high-low / price) = b0 + b1·ln(rv) + b2·ln(lrv) */
  beta: [number, number, number];
  /** [percentile bin centre, P(break)] — isotonic (non-increasing). */
  table: [number, number][];
  base: number;
}

export const REGIME_1H: RegimeConfig = {
  id: "1h", interval: "5m", barMs: 300_000, n: 12, lookbackBars: 12 * 24 * 10,
  beta: [-0.6919, 0.495, 0.2679],
  table: [[0.05, 0.88], [0.15, 0.82], [0.25, 0.82], [0.4, 0.78], [0.6, 0.72], [0.75, 0.645], [0.85, 0.645], [0.95, 0.55]],
  base: 0.73,
};

export const REGIME_4H: RegimeConfig = {
  id: "4h", interval: "15m", barMs: 900_000, n: 16, lookbackBars: 4 * 24 * 10,
  beta: [-0.0879, 0.3556, 0.5176],
  table: [[0.05, 0.87], [0.15, 0.83], [0.25, 0.81], [0.4, 0.78], [0.6, 0.72], [0.75, 0.64], [0.85, 0.54], [0.95, 0.41]],
  base: 0.72,
};

export const REGIMES = [REGIME_1H, REGIME_4H] as const;

/** Bars needed for a full read (percentile history + lrv + window). */
export const barsNeeded = (cfg: RegimeConfig) => cfg.lookbackBars + cfg.n * 8 + 2;

export interface RegimeRead {
  id: RegimeId;
  state: RegimeState;
  pBreak: number;          // 0..1
  base: number;
  pct: number;             // 0..1, trailing percentile of comp
  comp: number;
  rangeHi: number;
  rangeLo: number;
  pos: number;             // where last close sits in the range, 0..1
  expRangePct: number;     // typical next-window high-low, % of price
  lastClose: number;
  asOf: number;            // close time of the last closed bar
  nextAt: number;          // when the read can next change
  historyBars: number;     // percentile sample size actually used
  thin: boolean;           // < half the lookback available → less reliable
}

export function interp(table: [number, number][], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    const [x0, y0] = table[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return table[table.length - 1][1];
}

export function stateFor(p: number): RegimeState {
  if (p >= 0.8) return "breakout";
  if (p <= 0.5) return "hold";
  if (p <= 0.6) return "lean-hold";
  return "normal";
}

export const STATE_COPY: Record<RegimeState, { title: string; line: string }> = {
  breakout: { title: "Breakout likely", line: "Don't fade the range edges." },
  normal: { title: "Normal", line: "No edge vs usual: most ranges break." },
  "lean-hold": { title: "Range may hold", line: "Better odds than usual for fading edges." },
  hold: { title: "Range likely holds", line: "Edges are fadeable." },
};

/**
 * Compute the regime from candles (ascending by t, bar open times).
 * A bar counts only once it has closed by `now`.
 */
export function computeRegime(candles: RCandle[], cfg: RegimeConfig, now: number): RegimeRead | null {
  const closed = candles.filter((k) => k.t + cfg.barMs <= now && k.c > 0 && k.h > 0 && k.l > 0);
  const N = cfg.n;
  if (closed.length < N * 8 + 2) return null;

  // log returns, r[i] = ln(c[i]/c[i-1]) for i ≥ 1
  const len = closed.length;
  const r = new Float64Array(len);
  for (let i = 1; i < len; i++) r[i] = Math.log(closed[i].c / closed[i - 1].c);

  // rolling rv over N returns ending at i (needs i ≥ N)
  const rv = new Float64Array(len).fill(NaN);
  let ss = 0;
  for (let i = 1; i < len; i++) {
    ss += r[i] * r[i];
    if (i > N) ss -= r[i - N] * r[i - N];
    if (i >= N) rv[i] = Math.sqrt(Math.max(ss, 0));
  }
  // lrv = mean of rv over last 7N values ending at i
  const W = 7 * N;
  const lrv = new Float64Array(len).fill(NaN);
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < len; i++) {
    if (!Number.isNaN(rv[i])) { sum += rv[i]; cnt++; }
    if (i - W >= 0 && !Number.isNaN(rv[i - W])) { sum -= rv[i - W]; cnt--; }
    if (cnt === W) lrv[i] = sum / W;
  }
  const comp = new Float64Array(len).fill(NaN);
  for (let i = 0; i < len; i++) if (rv[i] > 0 && lrv[i] > 0) comp[i] = Math.log(rv[i] / lrv[i]);

  const last = len - 1;
  const cNow = comp[last];
  if (!Number.isFinite(cNow)) return null;
  // trailing percentile over the previous (lookbackBars − 1) comp values
  let below = 0;
  let total = 0;
  for (let i = Math.max(0, last - cfg.lookbackBars + 1); i < last; i++) {
    const v = comp[i];
    if (!Number.isFinite(v)) continue;
    total++;
    if (v < cNow) below++;
  }
  if (total < 50) return null;
  const pct = below / total;
  const pBreak = interp(cfg.table, pct);

  let hi = -Infinity;
  let lo = Infinity;
  for (let i = len - N; i < len; i++) { hi = Math.max(hi, closed[i].h); lo = Math.min(lo, closed[i].l); }
  const lastClose = closed[last].c;
  const [b0, b1, b2] = cfg.beta;
  const expRange = Math.exp(b0 + b1 * Math.log(rv[last]) + b2 * Math.log(lrv[last]));
  const asOf = closed[last].t + cfg.barMs;

  return {
    id: cfg.id,
    state: stateFor(pBreak),
    pBreak,
    base: cfg.base,
    pct,
    comp: cNow,
    rangeHi: hi,
    rangeLo: lo,
    pos: hi > lo ? (lastClose - lo) / (hi - lo) : 0.5,
    expRangePct: expRange * 100,
    lastClose,
    asOf,
    nextAt: asOf + cfg.barMs,
    historyBars: total,
    thin: total < (cfg.lookbackBars - 1) / 2,
  };
}
