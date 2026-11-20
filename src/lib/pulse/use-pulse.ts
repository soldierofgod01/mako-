"use client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOiHistory } from "@/lib/flow/use-positioning";
import type { VolState } from "@/lib/vol/use-vol";
import { buildPulse, type PulseMetric } from "./pulse";

// Data for the Market Pulse. Long histories come straight from public APIs in
// the browser (HL daily candles + funding, Deribit DVOL); OI and perp CVD from
// Mako's own DB (OI snapshots for every coin, recorder flow for the top 20).

const HL = "https://api.hyperliquid.xyz/info";
const hl = async <T,>(body: unknown): Promise<T> => {
  const r = await fetch(HL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HL ${r.status}`);
  return r.json() as Promise<T>;
};

export function usePulse(coin: string, vol: VolState, oiNow: number | null, depth1pct: number | null) {
  const daily = useQuery({
    queryKey: ["pulse-daily", coin],
    queryFn: async () => {
      const now = Date.now();
      const raw = await hl<{ t: number; c: string; v: string }[]>({ type: "candleSnapshot", req: { coin, interval: "1d", startTime: now - 220 * 86_400_000, endTime: now } });
      return raw.map((k) => ({ t: k.t, c: +k.c, v: +k.v }));
    },
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
    refetchOnWindowFocus: false,
  });
  const funding = useQuery({
    queryKey: ["pulse-funding", coin],
    queryFn: async () => {
      const out: { t: number; rate: number }[] = [];
      let start = Date.now() - 100 * 86_400_000;
      for (let i = 0; i < 6; i++) {
        const rows = await hl<{ time: number; fundingRate: string }[]>({ type: "fundingHistory", coin, startTime: start });
        for (const x of rows) out.push({ t: x.time, rate: +x.fundingRate });
        if (rows.length < 500) break;
        start = rows[rows.length - 1].time + 1;
      }
      return out;
    },
    staleTime: 30 * 60_000,
    refetchInterval: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
  const oi = useOiHistory(coin, true);
  const cvd = useQuery({
    queryKey: ["pulse-cvd", coin],
    queryFn: async () => {
      const r = await fetch(`/api/flow/history?coin=${encodeURIComponent(coin)}&interval=1d`);
      const j = (await r.json()) as { recorded: boolean; bars: [number, number, number][] };
      return j.recorded ? j.bars.map(([t, b, s]) => ({ t, net: b - s })).sort((a, b) => a.t - b.t) : null;
    },
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const hasDvol = coin === "BTC" || coin === "ETH";
  const dvol = useQuery({
    queryKey: ["pulse-dvol", coin],
    enabled: hasDvol,
    queryFn: async () => {
      const now = Date.now();
      const r = await fetch(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${coin}&start_timestamp=${now - 130 * 86_400_000}&end_timestamp=${now}&resolution=1D`);
      const j = (await r.json()) as { result: { data: [number, number, number, number, number][] } };
      return j.result.data.map(([t, , , , c]) => ({ t, v: c })).sort((a, b) => a.t - b.t);
    },
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const metrics: PulseMetric[] = useMemo(() => {
    if (!daily.data?.length) return [];
    return buildPulse({
      daily: daily.data,
      funding: funding.data ?? [],
      oi: oi.data ?? [],
      cvdDaily: cvd.data ?? null,
      dvolDaily: hasDvol ? dvol.data ?? null : null,
      atmIv30: vol.coverage !== "none" ? vol.surface?.atm30 ?? null : null,
      skew25: vol.surface?.skew25 ?? null,
      depth1pct,
      oiNow,
    });
  }, [daily.data, funding.data, oi.data, cvd.data, dvol.data, hasDvol, vol.coverage, vol.surface, depth1pct, oiNow]);

  return { metrics, loading: daily.isLoading, error: daily.isError, updatedAt: daily.dataUpdatedAt || null };
}
