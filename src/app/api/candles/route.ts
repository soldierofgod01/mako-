// /api/candles?coin=BTC&interval=15m — HL candle history for the Terminal
// chart. Always reaches back to the UTC day start so daily VWAP and the
// session volume profile are complete. Live candles then stream over WS.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HL_API = "https://api.hyperliquid.xyz/info";
const INTERVALS: Record<string, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000 };
const BARS = 400;

interface RawCandle { t: number; o: string; h: string; l: string; c: string; v: string }

async function snapshot(coin: string, interval: string, startTime: number, endTime: number) {
  const res = await fetch(HL_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval, startTime, endTime } }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HL ${res.status}`);
  const raw = (await res.json()) as RawCandle[];
  return (Array.isArray(raw) ? raw : []).map((k) => ({
    t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v,
  }));
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const coin = sp.get("coin");
  const interval = sp.get("interval") ?? "15m";
  if (!coin || !/^[A-Za-z0-9]{1,20}$/.test(coin) || !INTERVALS[interval]) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }
  try {
    const now = Date.now();
    const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
    const start = Math.min(dayStart, now - BARS * INTERVALS[interval]);
    // Chart candles + 1m candles since the UTC day start (for the volume profile).
    const [candles, profile] = await Promise.all([
      snapshot(coin, interval, start, now),
      snapshot(coin, "1m", dayStart, now),
    ]);
    return NextResponse.json({ coin, interval, candles, profile, dayStart });
  } catch (err) {
    console.error("candles error:", err);
    return NextResponse.json({ error: "Failed to load candles" }, { status: 502 });
  }
}
