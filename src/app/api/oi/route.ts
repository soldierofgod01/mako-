// /api/oi?coin=BTC — open interest history (5-min snapshots, up to 7 days) from
// market_snapshots (public-read). Returns [t, oiUsd, px] rows, oldest first.
import { NextResponse } from "next/server";
import { supabaseSelect } from "@/lib/track/supabase";

export const dynamic = "force-dynamic";

interface Row { t: string; oi: number | null; px: number | null }

export async function GET(req: Request) {
  const coin = new URL(req.url).searchParams.get("coin") ?? "";
  if (!/^[A-Za-z0-9:]{1,20}$/.test(coin)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  try {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const out: [number, number, number][] = [];
    // PostgREST caps responses at 1000 rows — page through.
    for (let offset = 0; offset < 5000; offset += 1000) {
      const rows = await supabaseSelect<Row[]>(
        "market_snapshots",
        `select=t,oi,px&coin=eq.${encodeURIComponent(coin)}&t=gte.${encodeURIComponent(since)}&order=t.asc&limit=1000&offset=${offset}`
      );
      for (const r of rows) if (r.oi && r.px) out.push([Date.parse(r.t), r.oi * r.px, r.px]);
      if (rows.length < 1000) break;
    }
    return NextResponse.json({ coin, rows: out }, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } });
  } catch (err) {
    console.error("oi history error:", err);
    return NextResponse.json({ coin, rows: [] });
  }
}
