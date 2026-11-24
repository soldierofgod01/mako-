// ═══════════════════════════════════════════════════════════════
// Shared server-side cohort cache. Used by /api/cohorts (one coin, Bias)
// and /api/bias-scan (every coin, Bias Scanner) so both share ONE refresh:
// leaderboard every 6h, 240 wallets' positions every 3 min.
// ═══════════════════════════════════════════════════════════════

import {
  buildCoinCohorts,
  selectCohorts,
  type CoinCohorts,
  type CohortWallet,
  type LeaderboardRow,
  type WalletPosition,
} from "@/lib/cohorts/cohorts";

const HL_API = "https://api.hyperliquid.xyz/info";
const LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
const LEADERBOARD_TTL = 6 * 60 * 60_000;
const POSITIONS_TTL = 3 * 60_000;
const CONCURRENCY = 20;

interface Cache {
  cohorts?: { at: number; sharps: CohortWallet[]; donors: CohortWallet[] };
  positions?: { at: number; byCoin: Record<string, CoinCohorts>; sharpsOk: number; donorsOk: number };
  inflight?: Promise<void>;
  retryAt?: number; // after a thin (rate-limited) refresh, wait before trying again
}
const g = globalThis as unknown as { __makoCohorts?: Cache };
const cache: Cache = (g.__makoCohorts ??= {});

async function loadCohorts() {
  if (cache.cohorts && Date.now() - cache.cohorts.at < LEADERBOARD_TTL) return cache.cohorts;
  const res = await fetch(LEADERBOARD_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`leaderboard ${res.status}`);
  const j = (await res.json()) as { leaderboardRows: LeaderboardRow[] };
  const { sharps, donors } = selectCohorts(j.leaderboardRows ?? []);
  cache.cohorts = { at: Date.now(), sharps, donors };
  return cache.cohorts;
}

interface ChState {
  assetPositions: { position: { coin: string; szi: string; positionValue: string; liquidationPx: string | null; entryPx: string | null } }[];
}

async function positionsOf(address: string): Promise<WalletPosition[] | null> {
  try {
    const res = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "clearinghouseState", user: address }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const s = (await res.json()) as ChState;
    return (s.assetPositions ?? []).map(({ position: p }) => {
      const value = Math.abs(parseFloat(p.positionValue));
      const liq = p.liquidationPx ? parseFloat(p.liquidationPx) : null;
      const entry = p.entryPx ? parseFloat(p.entryPx) : null;
      return { coin: p.coin, notionalUsd: parseFloat(p.szi) < 0 ? -value : value, liqPx: liq && liq > 0 ? liq : null, entryPx: entry && entry > 0 ? entry : null };
    });
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

async function refreshPositions(): Promise<void> {
  const { sharps, donors } = await loadCohorts();
  const [sp, dp] = await Promise.all([
    mapLimit(sharps, CONCURRENCY / 2, (w) => positionsOf(w.address)),
    mapLimit(donors, CONCURRENCY / 2, (w) => positionsOf(w.address)),
  ]);
  const sOk = sp.filter((x): x is WalletPosition[] => x !== null);
  const dOk = dp.filter((x): x is WalletPosition[] => x !== null);
  // If HL rate-limited most of the wallet reads (429s on Vercel's shared IPs),
  // keep the last good snapshot instead of replacing it with a thin one.
  const prev = cache.positions;
  const okNow = sOk.length + dOk.length;
  if (prev && okNow < 0.5 * (prev.sharpsOk + prev.donorsOk)) {
    console.warn(`cohorts: only ${okNow} wallets read (prev ${prev.sharpsOk + prev.donorsOk}), keeping last snapshot`);
    cache.retryAt = Date.now() + 30_000;
    return;
  }
  cache.positions = { at: Date.now(), byCoin: buildCoinCohorts(sOk, dOk), sharpsOk: sOk.length, donorsOk: dOk.length };
}


export interface CohortSnapshot {
  at: number;
  byCoin: Record<string, CoinCohorts>;
  sharpsOk: number;
  donorsOk: number;
}

export async function getCohortSnapshot(): Promise<CohortSnapshot> {
  const now = Date.now();
  const stale = !cache.positions || (now - cache.positions.at > POSITIONS_TTL && now >= (cache.retryAt ?? 0));
  if (stale) {
    cache.inflight ??= refreshPositions().finally(() => { cache.inflight = undefined; });
    try {
      await cache.inflight;
    } catch (e) {
      // Leaderboard or HL down: serve the last snapshot (or none) rather than failing callers.
      console.error("cohorts: refresh failed", String(e).slice(0, 160));
    }
  }
  return cache.positions ?? { at: 0, byCoin: {}, sharpsOk: 0, donorsOk: 0 };
}
