// /api/track/signals — grades of the Screener's preset screens (Squeeze setup,
// Crowded longs, Long squeeze). Logged in Postgres on every 5-min market tick.
import { NextResponse } from "next/server";
import { supabaseRpc } from "@/lib/track/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await supabaseRpc("signal_stats", {}));
  } catch (err) {
    console.error("signal stats error:", err);
    return NextResponse.json({ error: "Signal track record unavailable" }, { status: 502 });
  }
}
