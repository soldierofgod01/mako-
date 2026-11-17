// /api/track/flow — grades of the Terminal's order-flow bias, recorded 24/7.
import { NextResponse } from "next/server";
import { supabaseRpc } from "@/lib/track/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await supabaseRpc("flow_stats", {}));
  } catch (err) {
    console.error("flow stats error:", err);
    return NextResponse.json({ error: "Flow track record unavailable" }, { status: 502 });
  }
}
