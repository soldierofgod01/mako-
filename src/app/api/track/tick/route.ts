// ═══════════════════════════════════════════════════════════════
// /api/track/tick — called every 15 min by Supabase pg_cron.
// Snapshots the Bias Scanner and lets the database grade snapshots that
// have reached their 1h / 4h horizon. Protected by a shared token; the
// database function re-checks the same token before writing anything.
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { fetchHLPerpMarkets } from "@/lib/api/hl-perps";
import { getCohortSnapshot } from "@/lib/cohorts/server";
import { buildScan } from "@/lib/bias/scan";
import { supabaseRpc } from "@/lib/track/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const token = req.headers.get("x-track-token");
  if (!token || token.length < 32) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const [markets, snap] = await Promise.all([fetchHLPerpMarkets(), getCohortSnapshot()]);
    const { rows, market } = buildScan(markets, snap.byCoin);

    // Prices for every scanned coin (used to grade older snapshots).
    const prices: Record<string, number> = {};
    for (const r of rows) prices[r.coin] = r.markPrice;

    // Only store rows that say something.
    const snapshots = rows
      .filter((r) => Math.abs(r.positioning) >= 10 || r.relative !== null)
      .map((r) => ({
        coin: r.coin,
        positioning: r.positioning,
        divergence: r.divergence,
        relative: r.relative,
        funding8h: r.fundingRate8h,
        px: r.markPrice,
      }));

    const result = await supabaseRpc("track_ingest", {
      p_token: token,
      p_baseline: market.baseline,
      p_rows: snapshots,
      p_prices: prices,
    });
    return NextResponse.json({ ok: true, stored: snapshots.length, result });
  } catch (err) {
    console.error("track tick error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
