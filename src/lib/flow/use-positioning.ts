"use client";
import { useQuery } from "@tanstack/react-query";

// ════════════════════════════════════════════════════════════════
// Positioning history for the chart's order-flow panes:
//   • Open interest: 5-min snapshots (7 days) from Mako's own DB, all coins.
//   • Funding: hourly history straight from Hyperliquid (30 days).
// ════════════════════════════════════════════════════════════════

export interface OiPoint { t: number; oi: number; px: number }
export interface FundingPoint { t: number; rate: number } // hourly rate, decimal

export function useOiHistory(coin: string, enabled: boolean) {
  return useQuery({
    queryKey: ["oi-history", coin],
    enabled,
    queryFn: async (): Promise<OiPoint[]> => {
      const r = await fetch(`/api/oi?coin=${encodeURIComponent(coin)}`);
      if (!r.ok) throw new Error("oi history failed");
      const j = (await r.json()) as { rows: [number, number, number][] };
      return j.rows.map(([t, oi, px]) => ({ t, oi, px }));
    },
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useFundingHistory(coin: string, enabled: boolean) {
  return useQuery({
    queryKey: ["funding-history", coin],
    enabled,
    queryFn: async (): Promise<FundingPoint[]> => {
      const out: FundingPoint[] = [];
      let start = Date.now() - 30 * 86_400_000;
      // HL returns at most 500 rows per call.
      for (let i = 0; i < 4; i++) {
        const r = await fetch("https://api.hyperliquid.xyz/info", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "fundingHistory", coin, startTime: start }),
        });
        if (!r.ok) throw new Error("funding history failed");
        const rows = (await r.json()) as { time: number; fundingRate: string }[];
        for (const x of rows) out.push({ t: x.time, rate: +x.fundingRate });
        if (rows.length < 500) break;
        start = rows[rows.length - 1].time + 1;
      }
      return out;
    },
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export type OiRegime = "long-build" | "short-build" | "short-cover" | "long-unwind" | "flat";

/** Price direction × OI direction for one bar. Tiny OI moves (< minPct) read as flat. */
export function oiRegime(priceChg: number, oiChgPct: number, minPct = 0.05): OiRegime {
  if (Math.abs(oiChgPct) < minPct || priceChg === 0) return "flat";
  if (oiChgPct > 0) return priceChg > 0 ? "long-build" : "short-build";
  return priceChg > 0 ? "short-cover" : "long-unwind";
}

export const REGIME_STYLE: Record<OiRegime, { color: string; label: string }> = {
  "long-build": { color: "rgba(31,184,128,0.85)", label: "Longs opening" },
  "short-build": { color: "rgba(239,68,68,0.85)", label: "Shorts opening" },
  "short-cover": { color: "rgba(56,189,248,0.8)", label: "Shorts closing" },
  "long-unwind": { color: "rgba(245,158,11,0.8)", label: "Longs closing" },
  flat: { color: "rgba(155,155,160,0.55)", label: "OI flat" },
};
