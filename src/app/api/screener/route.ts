// /api/screener — every liquid HL perp with multi-timeframe change, OI change
// (from our 5-min snapshots), positioning and nearest liquidation cluster.
import { NextResponse } from "next/server";
import { fetchHLPerpMarkets } from "@/lib/api/hl-perps";
import { getCohortSnapshot } from "@/lib/cohorts/server";
import { buildScan } from "@/lib/bias/scan";
import { supabaseRpc } from "@/lib/track/supabase";
import { buildScreener, MIN_VOLUME, type MarketChange } from "@/lib/screener/build";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const [markets, snap, changes] = await Promise.all([
      fetchHLPerpMarkets(),
      getCohortSnapshot(),
      supabaseRpc<MarketChange[]>("market_changes", {}).catch(() => [] as MarketChange[]),
    ]);
    const liquid = markets.filter((m) => m.volume24hUsd >= MIN_VOLUME);
    const { rows: scan, market } = buildScan(liquid, snap.byCoin);
    const liqs: Record<string, NonNullable<(typeof snap.byCoin)[string]>["liqLevels"]> = {};
    for (const [coin, c] of Object.entries(snap.byCoin)) liqs[coin] = c.liqLevels;
    const rows = buildScreener(liquid, changes, scan, liqs);
    const historyMinutes = Math.max(0, ...changes.map((c) => c.history_minutes ?? 0));
    return NextResponse.json({ rows, historyMinutes, market, fetchedAt: Date.now() });
  } catch (err) {
    console.error("screener error:", err);
    return NextResponse.json({ error: "Failed to build screener", rows: [] }, { status: 502 });
  }
}
