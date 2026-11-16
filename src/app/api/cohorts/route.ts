// ═══════════════════════════════════════════════════════════════
// /api/cohorts?coin=BTC
// Sharps vs Donors positioning for one coin (see lib/cohorts).
//
// Cost control: the leaderboard (~48k wallets, ~20MB) is re-pulled every 6h;
// the 240 wallets' positions every 3 min. Both are cached in module memory,
// so all coins and all visitors share one refresh per warm instance.
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import {
  buildCoinCohorts,
  selectCohorts,
  type CoinCohorts,
  type CohortWallet,
  type LeaderboardRow,
  type WalletPosition,
} from "@/lib/cohorts/cohorts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HL_API = "https://api.hyperliquid.xyz/info";
const LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
const LEADERBOARD_TTL = 6 * 60 * 60_000;
const POSITIONS_TTL = 3 * 60_000;
const CONCURRENCY = 20;

interface Cache {
  cohorts?: { at: number; sharps: CohortWallet[]; donors: CohortWallet[] };
  positions?: { at: number; byCoin: Record<string, CoinCohorts>; sharpsOk: number; donorsOk: number };
  inflight?: Promise<void>;
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
  assetPositions: { position: { coin: string; szi: string; positionValue: string } }[];
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
      return { coin: p.coin, notionalUsd: parseFloat(p.szi) < 0 ? -value : value };
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

async function refreshPositions() {
  const { sharps, donors } = await loadCohorts();
  const [sp, dp] = await Promise.all([
    mapLimit(sharps, CONCURRENCY / 2, (w) => positionsOf(w.address)),
    mapLimit(donors, CONCURRENCY / 2, (w) => positionsOf(w.address)),
  ]);
  const sOk = sp.filter((x): x is WalletPosition[] => x !== null);
  const dOk = dp.filter((x): x is WalletPosition[] => x !== null);
  cache.positions = { at: Date.now(), byCoin: buildCoinCohorts(sOk, dOk), sharpsOk: sOk.length, donorsOk: dOk.length };
}

export async function GET(req: Request) {
  const coin = new URL(req.url).searchParams.get("coin");
  if (!coin || !/^[A-Za-z0-9]{1,20}$/.test(coin)) {
    return NextResponse.json({ error: "Invalid coin" }, { status: 400 });
  }
  try {
    const stale = !cache.positions || Date.now() - cache.positions.at > POSITIONS_TTL;
    if (stale) {
      cache.inflight ??= refreshPositions().finally(() => { cache.inflight = undefined; });
      await cache.inflight;
    }
    const p = cache.positions!;
    return NextResponse.json({
      coin,
      updatedAt: p.at,
      tracked: { sharps: p.sharpsOk, donors: p.donorsOk },
      data: p.byCoin[coin] ?? null,
    });
  } catch (err) {
    console.error("Cohorts API error:", err);
    return NextResponse.json({ error: "Failed to load wallet cohorts" }, { status: 502 });
  }
}
