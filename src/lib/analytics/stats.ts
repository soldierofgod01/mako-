// Pure statistics for the Analytics tab (unit-tested).
import type { Candle } from "@/lib/bias/engine";

/** Average 1-candle return (%) grouped by UTC hour, from 1h candles. */
export function returnByHour(candles: Candle[]): { hour: number; avg: number; n: number }[] {
  const sum = new Array(24).fill(0);
  const n = new Array(24).fill(0);
  for (const c of candles) {
    if (!(c.o > 0)) continue;
    const h = new Date(c.t).getUTCHours();
    sum[h] += (c.c / c.o - 1) * 100;
    n[h]++;
  }
  return sum.map((s, h) => ({ hour: h, avg: n[h] ? s / n[h] : 0, n: n[h] }));
}

/** Average daily return (%) by UTC weekday (Mon first), plus weekday/weekend means. */
export function returnByWeekday(daily: Candle[]) {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const sum = new Array(7).fill(0);
  const n = new Array(7).fill(0);
  for (const c of daily) {
    if (!(c.o > 0)) continue;
    const d = (new Date(c.t).getUTCDay() + 6) % 7; // Mon = 0
    sum[d] += (c.c / c.o - 1) * 100;
    n[d]++;
  }
  const rows = names.map((name, i) => ({ label: name, avg: n[i] ? sum[i] / n[i] : 0, n: n[i] }));
  const mean = (idx: number[]) => {
    const tot = idx.reduce((s, i) => s + sum[i], 0);
    const cnt = idx.reduce((s, i) => s + n[i], 0);
    return { avg: cnt ? tot / cnt : 0, n: cnt };
  };
  return [...rows, { label: "W/d", ...mean([0, 1, 2, 3, 4]) }, { label: "W/e", ...mean([5, 6]) }];
}

export const SESSIONS = [
  { id: "asia", label: "Asia", hours: [0, 1, 2, 3, 4, 5, 6, 7] },
  { id: "eu", label: "Europe", hours: [8, 9, 10, 11, 12, 13] },
  { id: "us", label: "US", hours: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23] },
] as const;

/**
 * Cumulative return (%) earned only during each session's UTC hours,
 * compounded day by day. Shows which session has been doing the work.
 */
export function sessionCumulative(hourly: Candle[]) {
  const out: Record<string, { t: number; v: number }[]> = { asia: [], eu: [], us: [] };
  const acc: Record<string, number> = { asia: 1, eu: 1, us: 1 };
  for (const c of hourly) {
    if (!(c.o > 0)) continue;
    const h = new Date(c.t).getUTCHours();
    const s = SESSIONS.find((x) => (x.hours as readonly number[]).includes(h));
    if (!s) continue;
    acc[s.id] *= c.c / c.o;
    out[s.id].push({ t: c.t, v: (acc[s.id] - 1) * 100 });
  }
  return out;
}
