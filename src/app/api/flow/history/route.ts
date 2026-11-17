// /api/flow/history?coin=BTC&interval=15m — stored aggressive buy/sell volume
// per candle, from the 24/7 flow recorder (1-min bars, kept 30 days). Lets the
// Terminal's Delta and CVD show history instead of starting when the tab opens.
// Coins the recorder doesn't cover return recorded:false and an empty list.
import { NextResponse } from "next/server";
import { supabaseRpc } from "@/lib/track/supabase";

export const dynamic = "force-dynamic";

const INTERVALS: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400 };
const BARS = 400;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const coin = sp.get("coin") ?? "";
  const bucket = INTERVALS[sp.get("interval") ?? ""];
  if (!/^[A-Za-z0-9:]{1,20}$/.test(coin) || !bucket) return NextResponse.json({ error: "bad request" }, { status: 400 });
  try {
    const since = new Date(Date.now() - BARS * bucket * 1000).toISOString();
    const data = await supabaseRpc<{ recorded: boolean; since: string | null; bars: [number, number, number][] }>(
      "flow_history",
      { p_coin: coin, p_bucket_s: bucket, p_since: since }
    );
    return NextResponse.json({ coin, interval: sp.get("interval"), ...data });
  } catch (err) {
    console.error("flow history error:", err);
    return NextResponse.json({ coin, interval: sp.get("interval"), recorded: false, since: null, bars: [] });
  }
}
