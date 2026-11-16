// /api/track/stats — public track record (aggregates computed in Postgres).
import { NextResponse } from "next/server";
import { supabaseRpc } from "@/lib/track/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await supabaseRpc("track_stats", {});
    return NextResponse.json(stats);
  } catch (err) {
    console.error("track stats error:", err);
    return NextResponse.json({ error: "Track record unavailable" }, { status: 502 });
  }
}
