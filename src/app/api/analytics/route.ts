// /api/analytics?coin=BTC — everything the Analytics tab needs for one coin.
// HL: 1h candles (30d), 1d candles (90d), funding history (30d).
// Ours: OI history (5-min snapshots), sharps-vs-donors history (track log).
import { NextResponse } from "next/server";
import { supabaseRpc } from "@/lib/track/supabase";
import { returnByHour, returnByWeekday, sessionCumulative } from "@/lib/analytics/stats";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const HL_API = "https://api.hyperliquid.xyz/info";
const H = 3_600_000;
const D = 86_400_000;

async function hl<T>(body: object): Promise<T> {
  const r = await fetch(HL_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  if (!r.ok) throw new Error(`HL ${r.status}`);
  return r.json() as Promise<T>;
}

type RawC = { t: number; o: string; h: string; l: string; c: string; v: string };
const parse = (a: RawC[]) => (Array.isArray(a) ? a : []).map((k) => ({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }));

async function fundingHistory(coin: string, start: number) {
  // HL pages at 500 rows; 30 days of hourly funding needs two pages.
  const out: { time: number; fundingRate: string }[] = [];
  let from = start;
  for (let i = 0; i < 4; i++) {
    const page = await hl<{ time: number; fundingRate: string }[]>({ type: "fundingHistory", coin, startTime: from });
    if (!Array.isArray(page) || !page.length) break;
    out.push(...page);
    if (page.length < 500) break;
    from = page[page.length - 1].time + 1;
  }
  return out;
}

export async function GET(req: Request) {
  const coin = new URL(req.url).searchParams.get("coin");
  if (!coin || !/^[A-Za-z0-9]{1,20}$/.test(coin)) return NextResponse.json({ error: "Invalid coin" }, { status: 400 });
  try {
    const now = Date.now();
    const [h1, d1, funding, oiHist, cohort] = await Promise.all([
      hl<RawC[]>({ type: "candleSnapshot", req: { coin, interval: "1h", startTime: now - 30 * D, endTime: now } }).then(parse),
      hl<RawC[]>({ type: "candleSnapshot", req: { coin, interval: "1d", startTime: now - 90 * D, endTime: now } }).then(parse),
      fundingHistory(coin, now - 30 * D),
      supabaseRpc<{ t: string; px: number; oi: number }[]>("market_history", { p_coin: coin, p_bucket_minutes: 15 }).catch(() => []),
      supabaseRpc<{ t: string; divergence: number; relative: number | null; baseline: number | null }[]>("cohort_history", { p_coin: coin }).catch(() => []),
    ]);
    return NextResponse.json({
      coin,
      hourly: h1.map((c) => ({ t: c.t, c: c.c, v: c.v * c.c })),
      funding: funding.map((f) => ({ t: f.time, apr: parseFloat(f.fundingRate) * 24 * 365 * 100 })),
      oi: oiHist.map((x) => ({ t: Date.parse(x.t), oiUsd: x.oi * x.px })),
      cohort: cohort.map((x) => ({ t: Date.parse(x.t), divergence: x.divergence, relative: x.relative })),
      byHour: returnByHour(h1),
      byWeekday: returnByWeekday(d1),
      sessions: sessionCumulative(h1),
      hours: { candles1h: h1.length, days: d1.length, oiSpanH: oiHist.length ? (now - Date.parse(oiHist[0].t)) / H : 0 },
    });
  } catch (err) {
    console.error("analytics error:", err);
    return NextResponse.json({ error: "Failed to load analytics" }, { status: 502 });
  }
}
