// Pure footprint / heatmap helpers (unit-tested). No React, no canvas.
import type { Trade } from "@/lib/bias/engine";

/** A "nice" step (1, 2, 2.5, 5 × 10^k) at or above `raw`. */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const k = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * k >= raw * 0.999) return m * k;
  return 10 * k;
}

export interface FootprintCell {
  px: number;   // row floor price
  buy: number;  // aggressive buy USD
  sell: number; // aggressive sell USD
}

export interface FootprintBar {
  t: number;              // candle open (ms)
  rows: FootprintCell[];  // ascending by price
  buy: number;
  sell: number;
  pocPx: number;          // row with the most total volume
}

/** Bucket the tape into candles × price rows. */
export function buildFootprint(trades: Trade[], intervalMs: number, row: number, since = 0): Map<number, FootprintBar> {
  const bars = new Map<number, Map<number, FootprintCell>>();
  for (const t of trades) {
    if (t.t < since) continue;
    const bt = Math.floor(t.t / intervalMs) * intervalMs;
    const rp = Math.floor(t.px / row) * row;
    let m = bars.get(bt);
    if (!m) { m = new Map(); bars.set(bt, m); }
    const c = m.get(rp) ?? { px: rp, buy: 0, sell: 0 };
    if (t.side === 1) c.buy += t.usd; else c.sell += t.usd;
    m.set(rp, c);
  }
  const out = new Map<number, FootprintBar>();
  for (const [bt, m] of bars) {
    const rows = [...m.values()].sort((a, b) => a.px - b.px);
    let poc = rows[0];
    let buy = 0;
    let sell = 0;
    for (const r of rows) {
      buy += r.buy;
      sell += r.sell;
      if (r.buy + r.sell > poc.buy + poc.sell) poc = r;
    }
    out.set(bt, { t: bt, rows, buy, sell, pocPx: poc.px });
  }
  return out;
}

/**
 * Diagonal imbalance (the standard footprint read): compare buys at a row
 * against sells one row BELOW (and sells against buys one row above).
 * Returns +1 buy imbalance, −1 sell imbalance, 0 none.
 */
export function imbalanceAt(rows: FootprintCell[], i: number, ratio = 3, minUsd = 0): -1 | 0 | 1 {
  const r = rows[i];
  const below = rows[i - 1];
  const above = rows[i + 1];
  // Buyers lifting at this row overwhelmed sellers hitting the row below.
  if (below && r.buy > 0 && r.buy >= minUsd && r.buy >= ratio * below.sell) return 1;
  // Sellers hitting at this row overwhelmed buyers lifting the row above.
  if (above && r.sell > 0 && r.sell >= minUsd && r.sell >= ratio * above.buy) return -1;
  return 0;
}

export interface HeatFrame {
  t: number;      // ms
  tick: number;   // price step of this book aggregation
  levels: [number, number][]; // [price, usd] bids and asks together
}

/** Robust scale for heat intensity: the 95th percentile of cell sizes. */
export function heatScale(frames: HeatFrame[]): number {
  const vals: number[] = [];
  for (const f of frames) for (const [, u] of f.levels) vals.push(u);
  if (!vals.length) return 1;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.95)] || vals[vals.length - 1] || 1;
}

/** Heat colour: deep blue → cyan → yellow → white (Bookmap-style), alpha grows with size. */
export function heatColor(x: number): string {
  const v = Math.max(0, Math.min(1, x));
  const stops: [number, number, number, number][] = [
    [0, 20, 40, 90],
    [0.35, 0, 140, 200],
    [0.65, 40, 220, 200],
    [0.85, 250, 220, 60],
    [1, 255, 255, 235],
  ];
  let i = 0;
  while (i < stops.length - 2 && v > stops[i + 1][0]) i++;
  const [a, ar, ag, ab] = stops[i];
  const [b, br, bg, bb] = stops[i + 1];
  const f = (v - a) / (b - a || 1);
  const r = Math.round(ar + (br - ar) * f);
  const g = Math.round(ag + (bg - ag) * f);
  const bl = Math.round(ab + (bb - ab) * f);
  const alpha = 0.18 + 0.72 * Math.sqrt(v);
  return `rgba(${r},${g},${bl},${alpha.toFixed(3)})`;
}
