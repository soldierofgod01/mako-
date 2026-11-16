// ═══════════════════════════════════════════════════════════════
// /api/track/market — called every 5 min by Supabase pg_cron.
// Snapshots price / OI / funding / premium / volume for every HL perp.
// Hyperliquid has no OI history endpoint, so this table IS our OI history
// (screener OI-change columns, Analytics OI panel).
// Token is forwarded to Postgres, which rejects anything that doesn't match.
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { supabaseRpc } from "@/lib/track/supabase";

export const dynamic = "force-dynamic";

const HL_API = "https://api.hyperliquid.xyz/info";

interface Ctx { funding: string; openInterest: string; dayNtlVlm: string; premium: string | null; markPx: string }

export async function GET(req: Request) {
  const token = req.headers.get("x-track-token");
  if (!token || token.length < 32) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const res = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HL ${res.status}`);
    const [meta, ctxs] = (await res.json()) as [{ universe: { name: string; isDelisted?: boolean }[] }, Ctx[]];
    const rows = meta.universe
      .map((a, i) => ({ a, c: ctxs[i] }))
      .filter(({ a, c }) => c && !a.isDelisted && parseFloat(c.markPx) > 0)
      .map(({ a, c }) => ({
        coin: a.name,
        px: parseFloat(c.markPx),
        oi: parseFloat(c.openInterest),
        funding: parseFloat(c.funding),
        premium: c.premium ? parseFloat(c.premium) : null,
        vol: parseFloat(c.dayNtlVlm),
      }));
    const result = await supabaseRpc("market_ingest", { p_token: token, p_rows: rows });
    return NextResponse.json({ ok: true, coins: rows.length, result });
  } catch (err) {
    console.error("market tick error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
