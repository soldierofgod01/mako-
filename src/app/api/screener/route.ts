// /api/screener — every liquid HL perp with multi-timeframe change, OI change
// (from our 5-min snapshots), positioning and nearest liquidation cluster.
//
// GET  — the server fetches Hyperliquid's market list itself.
// POST — the browser sends Hyperliquid's raw `metaAndAssetCtxs` response it
//        fetched itself. Used as a fallback when HL rate-limits Vercel's shared
//        server IPs (429), so the Screener never goes blank because of that.
import { NextResponse } from "next/server";
import { fetchHLPerpMarkets, parseHLPerpMarkets, type HLPerpMarket } from "@/lib/api/hl-perps";
import { getCohortSnapshot } from "@/lib/cohorts/server";
import { buildScan } from "@/lib/bias/scan";
import { supabaseRpc } from "@/lib/track/supabase";
import { buildScreener, MIN_VOLUME, type MarketChange, type ScreenerHistory } from "@/lib/screener/build";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The history RPCs can time out on a cold start (~1–2s each normally). Retry
// once, and fall back to the last good result this instance saw, so a slow
// call never blanks the timeframe / OI-change / sparkline columns.
let lastChanges: MarketChange[] = [];
let lastHistory: ScreenerHistory[] = [];
// Last good HL market list (≤ 2 min old) — served if HL refuses this instance.
let lastMarkets: { at: number; markets: HLPerpMarket[] } | null = null;
const MARKETS_MAX_AGE = 2 * 60_000;

async function rpcRetry<T>(fn: string): Promise<T> {
  try { return await supabaseRpc<T>(fn, {}); }
  catch (e) {
    console.warn(`screener: ${fn} failed, retrying`, String(e).slice(0, 160));
    return supabaseRpc<T>(fn, {});
  }
}

async function serverMarkets(): Promise<HLPerpMarket[]> {
  try {
    const markets = await fetchHLPerpMarkets();
    lastMarkets = { at: Date.now(), markets };
    return markets;
  } catch (e) {
    if (lastMarkets && Date.now() - lastMarkets.at < MARKETS_MAX_AGE) {
      console.warn("screener: HL markets failed, serving last good", String(e).slice(0, 160));
      return lastMarkets.markets;
    }
    throw e;
  }
}

async function build(marketsP: Promise<HLPerpMarket[]>) {
  const [markets, snap, changes, history] = await Promise.all([
    marketsP,
    getCohortSnapshot(),
    rpcRetry<MarketChange[]>("market_changes").then((r) => (r.length ? (lastChanges = r) : lastChanges)).catch((e) => {
      console.error("screener: market_changes failed", String(e).slice(0, 160));
      return lastChanges;
    }),
    rpcRetry<ScreenerHistory[]>("screener_history").then((r) => (r.length ? (lastHistory = r) : lastHistory)).catch((e) => {
      console.error("screener: screener_history failed", String(e).slice(0, 160));
      return lastHistory;
    }),
  ]);
  const liquid = markets.filter((m) => m.volume24hUsd >= MIN_VOLUME);
  const { rows: scan, market } = buildScan(liquid, snap.byCoin);
  const liqs: Record<string, NonNullable<(typeof snap.byCoin)[string]>["liqLevels"]> = {};
  for (const [coin, c] of Object.entries(snap.byCoin)) liqs[coin] = c.liqLevels;
  const rows = buildScreener(liquid, changes, scan, liqs, history);
  const historyMinutes = Math.max(0, ...changes.map((c) => c.history_minutes ?? 0));
  return NextResponse.json({ rows, historyMinutes, market, fetchedAt: Date.now() });
}

export async function GET() {
  try {
    return await build(serverMarkets());
  } catch (err) {
    console.error("screener error:", err);
    return NextResponse.json({ error: "Failed to build screener", rows: [] }, { status: 502 });
  }
}

export async function POST(req: Request) {
  try {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > 2_000_000) return NextResponse.json({ error: "too large", rows: [] }, { status: 413 });
    const markets = parseHLPerpMarkets(await req.json());
    return await build(Promise.resolve(markets));
  } catch (err) {
    console.error("screener (browser markets) error:", err);
    return NextResponse.json({ error: "Failed to build screener", rows: [] }, { status: 502 });
  }
}
