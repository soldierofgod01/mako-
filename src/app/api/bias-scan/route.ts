// ═══════════════════════════════════════════════════════════════
// /api/bias-scan — every liquid HL perp ranked by positioning
// (sharps vs donors + funding crowding). See lib/bias/scan.ts.
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { fetchHLPerpMarkets } from "@/lib/api/hl-perps";
import { getCohortSnapshot } from "@/lib/cohorts/server";
import { buildScan } from "@/lib/bias/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const [markets, snap] = await Promise.all([fetchHLPerpMarkets(), getCohortSnapshot()]);
    const { rows, market } = buildScan(markets, snap.byCoin);
    return NextResponse.json({
      rows,
      market,
      updatedAt: snap.at,
      tracked: { sharps: snap.sharpsOk, donors: snap.donorsOk },
    });
  } catch (err) {
    console.error("Bias scan error:", err);
    return NextResponse.json({ error: "Failed to build scan", rows: [] }, { status: 502 });
  }
}
