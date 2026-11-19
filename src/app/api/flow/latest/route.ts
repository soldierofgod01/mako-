// /api/flow/latest?coin=BTC — the 24/7 recorder's most recent bias per
// horizon (≤5 min old). Same engine, full tape — lets the Terminal show a
// read the moment it opens instead of waiting for its own tape to warm up.
// Coins the recorder doesn't cover return {}.
import { NextResponse } from "next/server";
import { supabaseSelect } from "@/lib/track/supabase";
import type { RecorderRead } from "@/lib/bias/recorder-seed";

export const dynamic = "force-dynamic";

interface Row { horizon: string; t: string; score: number; raw: number; direction: string; coverage: number; sig: Record<string, number | null> | null }

export async function GET(req: Request) {
  const coin = new URL(req.url).searchParams.get("coin") ?? "";
  if (!/^[A-Za-z0-9:]{1,20}$/.test(coin)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  try {
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const rows = await supabaseSelect<Row[]>(
      "flow_bias",
      `select=horizon,t,score,raw,direction,coverage,sig&coin=eq.${encodeURIComponent(coin)}&t=gt.${encodeURIComponent(since)}&order=t.desc&limit=12`
    );
    const out: Record<string, RecorderRead> = {};
    for (const r of rows) {
      if (out[r.horizon]) continue; // newest first
      out[r.horizon] = { t: Date.parse(r.t), score: r.score, direction: r.direction as RecorderRead["direction"], coverage: r.coverage, sig: r.sig ?? {} };
    }
    return NextResponse.json({ coin, reads: out });
  } catch (err) {
    console.error("flow latest error:", err);
    return NextResponse.json({ coin, reads: {} });
  }
}
