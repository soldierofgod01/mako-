"use client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildSurface, realizedVol, toRows, type DeribitSummary, type VolSurface } from "./options";

// ════════════════════════════════════════════════════════════════
// useVol(coin) — volatility context for one coin.
//   • Options (IV, skew, term structure, GEX, max pain): Deribit public API,
//     fetched from the browser (free, no key). BTC/ETH use the main inverse
//     chains; SOL/XRP/HYPE/AVAX/TRX use Deribit's thinner USDC chains.
//   • DVOL: Deribit's 30-day implied vol index — BTC and ETH only.
//   • RV: realised vol from Hyperliquid 1h candles — every coin.
// ════════════════════════════════════════════════════════════════

const DERIBIT = "https://www.deribit.com/api/v2/public";
const HL_INFO = "https://api.hyperliquid.xyz/info";

export type VolCoverage = "full" | "thin" | "none";

interface ChainSource { currency: string; base: string; coverage: VolCoverage }

const USDC_CHAINS = new Set(["SOL", "XRP", "HYPE", "AVAX", "TRX"]);
const DVOL_COINS = new Set(["BTC", "ETH"]);

export function chainFor(coin: string): ChainSource | null {
  if (coin === "BTC" || coin === "ETH") return { currency: coin, base: coin, coverage: "full" };
  if (USDC_CHAINS.has(coin)) return { currency: "USDC", base: `${coin}_USDC`, coverage: "thin" };
  return null;
}

export interface VolState {
  coin: string;
  coverage: VolCoverage;
  surface: VolSurface | null;
  dvol: { t: number; v: number }[] | null;
  dvolNow: number | null;
  rv: { d1: number | null; d7: number | null; d30: number | null } | null;
  loading: boolean;
  error: boolean;
  updatedAt: number | null;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

/** DVOL resolution follows the chart: minute data for intraday charts, hourly otherwise. */
function dvolWindow(intervalMs: number) {
  return intervalMs <= 300_000 ? { res: "60", spanMs: 16 * 3600_000 } : { res: "3600", spanMs: 30 * 24 * 3600_000 };
}

export function useVol(coin: string, spot: number | null, chartIntervalMs: number): VolState {
  const src = chainFor(coin);
  const hasDvol = DVOL_COINS.has(coin);
  const dw = dvolWindow(chartIntervalMs);

  const chainQ = useQuery({
    queryKey: ["deribit-chain", src?.currency],
    enabled: !!src,
    queryFn: () =>
      getJson<{ result: DeribitSummary[] }>(`${DERIBIT}/get_book_summary_by_currency?currency=${src!.currency}&kind=option`).then((j) => ({
        t: Date.now(),
        rows: j.result,
      })),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const dvolQ = useQuery({
    queryKey: ["deribit-dvol", coin, dw.res],
    enabled: hasDvol,
    queryFn: async () => {
      const now = Date.now();
      const j = await getJson<{ result: { data: [number, number, number, number, number][] } }>(
        `${DERIBIT}/get_volatility_index_data?currency=${coin}&start_timestamp=${now - dw.spanMs}&end_timestamp=${now}&resolution=${dw.res}`
      );
      return j.result.data.map(([t, , , , c]) => ({ t, v: c })).sort((a, b) => a.t - b.t);
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const rvQ = useQuery({
    queryKey: ["hl-1h-rv", coin],
    queryFn: async () => {
      const now = Date.now();
      const raw = await getJson<{ t: number; c: string }[]>(HL_INFO, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval: "1h", startTime: now - 31 * 24 * 3600_000, endTime: now } }),
      });
      const closes = raw.map((k) => +k.c);
      const PPY = 24 * 365;
      return { d1: realizedVol(closes, 24, PPY), d7: realizedVol(closes, 24 * 7, PPY), d30: realizedVol(closes, 24 * 30, PPY) };
    },
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const surface = useMemo(() => {
    if (!src || !chainQ.data) return null;
    return buildSurface(toRows(chainQ.data.rows, src.base), spot, chainQ.data.t);
    // Spot only moves the GEX grid a little; rebuild per chain refresh, not per tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainQ.data, src?.base, spot != null]);

  const dvol = hasDvol ? dvolQ.data ?? null : null;
  return {
    coin,
    coverage: src?.coverage ?? "none",
    surface,
    dvol,
    dvolNow: dvol?.length ? dvol[dvol.length - 1].v : null,
    rv: rvQ.data ?? null,
    loading: (!!src && chainQ.isLoading) || rvQ.isLoading,
    error: (!!src && chainQ.isError) || rvQ.isError,
    updatedAt: chainQ.data?.t ?? null,
  };
}
