// ═══════════════════════════════════════════════════════════════
// /api/cohorts?coin=BTC — Sharps vs Donors for one coin (Terminal tab).
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { getCohortSnapshot } from "@/lib/cohorts/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const coin = new URL(req.url).searchParams.get("coin");
  if (!coin || !/^[A-Za-z0-9]{1,20}$/.test(coin)) {
    return NextResponse.json({ error: "Invalid coin" }, { status: 400 });
  }
  try {
    const p = await getCohortSnapshot();
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
