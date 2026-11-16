// ════════════════════════════════════════════════════════════════
// Tape persistence — kills the cold start.
//
// Two layers:
//   • memory: a module-level map, so switching coins (or tabs) and coming
//     back resumes instantly with everything collected so far.
//   • localStorage: the current coin's tape survives a page reload.
// The gap while you were away is reported, never papered over.
// ════════════════════════════════════════════════════════════════

import type { BookSample, CtxSample, Trade } from "@/lib/bias/engine";

export interface CvdPoint {
  time: number; // seconds
  cvd: number;
  px: number;
}

export interface TapeState {
  coin: string;
  trades: Trade[];
  book: BookSample[];
  ctx: CtxSample[];
  cvd: CvdPoint[];
  cvdTotal: number;
  savedAt: number;
}

const KEY = (coin: string) => `mako:tape:v1:${coin}`;
const INDEX_KEY = "mako:tape:v1:index";
const MAX_STORED_COINS = 3;
const MAX_TRADES = 25_000;
export const MAX_RESTORE_AGE_MS = 45 * 60_000;

const memory = new Map<string, TapeState>();

export function saveMemory(s: TapeState) {
  memory.set(s.coin, s);
}

export function loadMemory(coin: string): TapeState | null {
  return memory.get(coin) ?? null;
}

type Compact = {
  v: 1;
  coin: string;
  savedAt: number;
  cvdTotal: number;
  t: [number, number, number, 1 | -1][]; // t, px, sz, side
  b: [number, number][];                 // t, imbalance
  c: [number, number, number, number][]; // t, markPx, oi, fundingHourly
  d: [number, number, number][];         // time, cvd, px
};

export function saveStorage(s: TapeState) {
  try {
    const trades = s.trades.slice(-MAX_TRADES);
    const data: Compact = {
      v: 1,
      coin: s.coin,
      savedAt: s.savedAt,
      cvdTotal: s.cvdTotal,
      t: trades.map((x) => [x.t, x.px, x.sz, x.side]),
      b: s.book.map((x) => [x.t, Math.round(x.imbalance * 1e4) / 1e4]),
      c: s.ctx.map((x) => [x.t, x.markPx, x.oi, x.fundingHourly]),
      d: s.cvd.map((x) => [x.time, Math.round(x.cvd), x.px]),
    };
    localStorage.setItem(KEY(s.coin), JSON.stringify(data));
    // Keep only the most recent few coins on disk.
    let idx: string[] = [];
    try { idx = JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]"); } catch { /* ignore */ }
    idx = [s.coin, ...idx.filter((c) => c !== s.coin)];
    for (const old of idx.slice(MAX_STORED_COINS)) localStorage.removeItem(KEY(old));
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx.slice(0, MAX_STORED_COINS)));
  } catch {
    /* quota / private mode — persistence is best-effort */
  }
}

export function loadStorage(coin: string): TapeState | null {
  try {
    const raw = localStorage.getItem(KEY(coin));
    if (!raw) return null;
    const d = JSON.parse(raw) as Compact;
    if (d.v !== 1 || d.coin !== coin) return null;
    return {
      coin,
      savedAt: d.savedAt,
      cvdTotal: d.cvdTotal,
      trades: d.t.map(([t, px, sz, side]) => ({ t, px, sz, usd: px * sz, side })),
      book: d.b.map(([t, imbalance]) => ({ t, imbalance, bidUsd: 0, askUsd: 0 })),
      ctx: d.c.map(([t, markPx, oi, fundingHourly]) => ({ t, markPx, oi, fundingHourly })),
      cvd: d.d.map(([time, cvd, px]) => ({ time, cvd, px })),
    };
  } catch {
    return null;
  }
}

/** Best available saved tape for a coin, or null if none / too old. */
export function restore(coin: string, now: number): TapeState | null {
  const m = loadMemory(coin);
  const s = loadStorage(coin);
  const best = m && (!s || m.savedAt >= s.savedAt) ? m : s;
  if (!best || now - best.savedAt > MAX_RESTORE_AGE_MS) return null;
  return best;
}
