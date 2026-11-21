"use client";
import { useQuery } from "@tanstack/react-query";
import { barsNeeded, computeRegime, REGIME_1H, REGIME_4H, type RCandle, type RegimeConfig, type RegimeRead } from "./regime";

// useRegime(coin) — range-regime reads (1h + 4h) from HL candles, fetched
// from the browser. Refetches just after each 5m close, which is the only
// time either read can change.

const HL_INFO = "https://api.hyperliquid.xyz/info";

async function candles(coin: string, cfg: RegimeConfig): Promise<RCandle[]> {
  const now = Date.now();
  const startTime = now - (barsNeeded(cfg) + 20) * cfg.barMs;
  const r = await fetch(HL_INFO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval: cfg.interval, startTime, endTime: now } }),
  });
  if (!r.ok) throw new Error(`HL ${r.status}`);
  const raw = (await r.json()) as { t: number; o: string; h: string; l: string; c: string }[];
  return raw.map((k) => ({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c }));
}

export interface RegimeState {
  h1: RegimeRead | null;
  h4: RegimeRead | null;
  loading: boolean;
  error: boolean;
}

const msToNext5m = () => 300_000 - (Date.now() % 300_000) + 4_000;

export function useRegime(coin: string): RegimeState {
  const q = useQuery({
    queryKey: ["regime-v1", coin],
    queryFn: async () => {
      const [k5, k15] = await Promise.all([candles(coin, REGIME_1H), candles(coin, REGIME_4H)]);
      const now = Date.now();
      return { h1: computeRegime(k5, REGIME_1H, now), h4: computeRegime(k15, REGIME_4H, now) };
    },
    refetchInterval: msToNext5m,
    staleTime: 60_000,
    retry: 2,
  });
  return { h1: q.data?.h1 ?? null, h4: q.data?.h4 ?? null, loading: q.isLoading, error: q.isError };
}
