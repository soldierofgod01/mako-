// Pure maths for the Terminal chart. No React, unit-tested.
import type { Candle, Trade } from "@/lib/bias/engine";

/** Session VWAP that resets at each UTC day. Typical price × volume. */
export function vwapSeries(candles: Candle[]): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = [];
  let day = -1;
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const d = Math.floor(c.t / 86_400_000);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    const tp = (c.h + c.l + c.c) / 3;
    pv += tp * c.v;
    vol += c.v;
    if (vol > 0) out.push({ t: c.t, v: pv / vol });
  }
  return out;
}

export interface ProfileBin { lo: number; hi: number; vol: number }
export interface VolumeProfile { bins: ProfileBin[]; poc: number; vah: number; val: number; total: number }

/**
 * Volume profile from 1m candles: each candle's volume is spread evenly
 * across the price range it traded. An approximation (true profiles need
 * tick data), but standard for candle-based profiles. Value area = 70%.
 */
export function volumeProfile(candles: Candle[], nBins = 48): VolumeProfile | null {
  const cs = candles.filter((c) => c.v > 0 && c.h >= c.l && c.l > 0);
  if (cs.length < 5) return null;
  const lo = Math.min(...cs.map((c) => c.l));
  const hi = Math.max(...cs.map((c) => c.h));
  if (!(hi > lo)) return null;
  const step = (hi - lo) / nBins;
  const bins: ProfileBin[] = Array.from({ length: nBins }, (_, i) => ({ lo: lo + i * step, hi: lo + (i + 1) * step, vol: 0 }));
  for (const c of cs) {
    if (c.h === c.l) {
      bins[Math.min(nBins - 1, Math.floor((c.c - lo) / step))].vol += c.v;
      continue;
    }
    const a = Math.max(0, Math.floor((c.l - lo) / step));
    const b = Math.min(nBins - 1, Math.floor((c.h - lo) / step));
    for (let i = a; i <= b; i++) {
      const overlap = Math.min(c.h, bins[i].hi) - Math.max(c.l, bins[i].lo);
      if (overlap > 0) bins[i].vol += (c.v * overlap) / (c.h - c.l);
    }
  }
  const total = bins.reduce((s, b) => s + b.vol, 0);
  let pocI = 0;
  bins.forEach((b, i) => { if (b.vol > bins[pocI].vol) pocI = i; });
  // Value area: grow from POC toward the heavier neighbour until 70%.
  let up = pocI;
  let dn = pocI;
  let acc = bins[pocI].vol;
  while (acc < total * 0.7 && (up < nBins - 1 || dn > 0)) {
    const nu = up < nBins - 1 ? bins[up + 1].vol : -1;
    const nd = dn > 0 ? bins[dn - 1].vol : -1;
    if (nu >= nd) { up++; acc += nu; } else { dn--; acc += nd; }
  }
  return {
    bins,
    poc: (bins[pocI].lo + bins[pocI].hi) / 2,
    vah: bins[up].hi,
    val: bins[dn].lo,
    total,
  };
}

/** Net aggressive USD per candle bucket, from the live tape. */
export function candleDelta(trades: Trade[], intervalMs: number): Map<number, { net: number; buy: number; sell: number }> {
  const m = new Map<number, { net: number; buy: number; sell: number }>();
  for (const t of trades) {
    const k = Math.floor(t.t / intervalMs) * intervalMs;
    const e = m.get(k) ?? { net: 0, buy: 0, sell: 0 };
    if (t.side === 1) e.buy += t.usd; else e.sell += t.usd;
    e.net = e.buy - e.sell;
    m.set(k, e);
  }
  return m;
}
