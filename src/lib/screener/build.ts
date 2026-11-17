// ════════════════════════════════════════════════════════════════
// Screener rows — pure, unit-tested. Combines:
//   • live HL market data (price, 24h change, volume, OI, funding)
//   • our 5-min snapshot history (multi-timeframe price & OI change)
//   • wallet-cohort positioning + liquidation clusters
// Missing history → null (UI shows "—" and how much history exists).
// ════════════════════════════════════════════════════════════════

import type { HLPerpMarket } from "@/lib/api/hl-perps";
import type { ScanRow } from "@/lib/bias/scan";
import type { LiqLevel } from "@/lib/cohorts/cohorts";

export interface MarketChange {
  coin: string;
  px_15m: number | null;
  px_1h: number | null;
  px_4h: number | null;
  oi_1h: number | null;
  oi_4h: number | null;
  oi_24h: number | null;
  vol_avg: number | null;
  history_minutes: number | null;
}

export interface ScreenerHistory {
  coin: string;
  spark: number[] | null;  // last price per 30-min bucket, oldest → newest (≤24h)
  vol_1h: number | null;   // stdev of 5-min log returns over the last hour, scaled to 1h, %
}

export interface ScreenerRow {
  coin: string;
  symbol: string;
  price: number;
  maxLeverage: number;
  chg15m: number | null;
  chg1h: number | null;
  chg4h: number | null;
  chg24h: number;
  volume24h: number;
  relVol: number | null;   // 24h volume ÷ its own average over our history
  oiUsd: number;
  oiChg1h: number | null;  // % change in contracts (positions), not USD
  oiChg4h: number | null;
  oiChg24h: number | null;
  funding8h: number;       // %
  fundingApr: number;      // %
  // positioning
  sharpsNet: number | null;
  sharpsN: number;
  donorsNet: number | null;
  donorsN: number;
  divergence: number | null;
  relative: number | null;
  positioning: number;
  liqDistPct: number | null; // nearest tracked liquidation cluster, % from price
  liqUsd: number | null;
  liqSide: "long" | "short" | null;
  spark: number[];          // 24h price path (30-min buckets) + live price
  vol1h: number | null;     // realised 1h volatility, %
  oiVolRatio: number | null; // OI ÷ 24h volume — high = positions sticky, low = churn
}

const pct = (now: number, then: number | null | undefined) =>
  then != null && then > 0 && now > 0 ? (now / then - 1) * 100 : null;

export function buildScreener(
  markets: HLPerpMarket[],
  changes: MarketChange[],
  scan: ScanRow[],
  liqs: Record<string, LiqLevel[]>,
  history: ScreenerHistory[] = []
): ScreenerRow[] {
  const ch = new Map(changes.map((c) => [c.coin, c]));
  const hi = new Map(history.map((h) => [h.coin, h]));
  const sc = new Map(scan.map((r) => [r.coin, r]));
  return markets.map((m) => {
    const c = ch.get(m.coin);
    const h = hi.get(m.coin);
    const spark = (h?.spark ?? []).filter((x) => x > 0 && isFinite(x));
    if (spark.length && m.markPrice > 0) spark.push(m.markPrice);
    const s = sc.get(m.coin);
    const oiCoins = m.markPrice > 0 ? m.openInterestUsd / m.markPrice : 0;
    // Nearest liquidation cluster within 25%.
    let liq: LiqLevel | null = null;
    for (const l of liqs[m.coin] ?? []) {
      const d = Math.abs(l.px - m.markPrice) / m.markPrice;
      if (d > 0.25) continue;
      if (!liq || d < Math.abs(liq.px - m.markPrice) / m.markPrice) liq = l;
    }
    return {
      coin: m.coin,
      symbol: m.symbol,
      price: m.markPrice,
      maxLeverage: m.maxLeverage,
      chg15m: pct(m.markPrice, c?.px_15m),
      chg1h: pct(m.markPrice, c?.px_1h),
      chg4h: pct(m.markPrice, c?.px_4h),
      chg24h: m.priceChange24hPct,
      volume24h: m.volume24hUsd,
      relVol: c?.vol_avg && c.vol_avg > 0 && (c.history_minutes ?? 0) >= 60 ? m.volume24hUsd / c.vol_avg : null,
      oiUsd: m.openInterestUsd,
      oiChg1h: pct(oiCoins, c?.oi_1h),
      oiChg4h: pct(oiCoins, c?.oi_4h),
      oiChg24h: pct(oiCoins, c?.oi_24h),
      funding8h: m.fundingRate8h,
      fundingApr: m.fundingRateAnnualPct,
      sharpsNet: s?.sharps?.net ?? null,
      sharpsN: s?.sharps?.n ?? 0,
      donorsNet: s?.donors?.net ?? null,
      donorsN: s?.donors?.n ?? 0,
      divergence: s?.divergence ?? null,
      relative: s?.relative ?? null,
      positioning: s?.positioning ?? 0,
      liqDistPct: liq ? ((liq.px - m.markPrice) / m.markPrice) * 100 : null,
      liqUsd: liq ? liq.longUsd + liq.shortUsd : null,
      liqSide: liq ? (liq.longUsd >= liq.shortUsd ? "long" : "short") : null,
      spark,
      vol1h: h?.vol_1h != null && isFinite(h.vol_1h) ? h.vol_1h : null,
      oiVolRatio: m.volume24hUsd > 0 ? m.openInterestUsd / m.volume24hUsd : null,
    };
  });
}

// ─── Preset screens ─────────────────────────────────────────────
export type PresetId = "all" | "gainers" | "losers" | "oi_building" | "squeeze" | "crowded_longs" | "vol_spike" | "sharps_break";

export const PRESETS: { id: PresetId; label: string; hint: string; match: (r: ScreenerRow) => boolean; sort?: { key: keyof ScreenerRow; dir: 1 | -1 } }[] = [
  { id: "all", label: "All", hint: "Every liquid market", match: () => true },
  { id: "gainers", label: "Gainers", hint: "Top 24h movers up", match: (r) => r.chg24h > 0, sort: { key: "chg24h", dir: -1 } },
  { id: "losers", label: "Losers", hint: "Top 24h movers down", match: (r) => r.chg24h < 0, sort: { key: "chg24h", dir: 1 } },
  { id: "oi_building", label: "OI building", hint: "Open interest up >3% in 4h — new positions opening", match: (r) => (r.oiChg4h ?? 0) > 3, sort: { key: "oiChg4h", dir: -1 } },
  {
    id: "squeeze", label: "Squeeze setup", hint: "OI rising, price falling, shorts paying funding",
    match: (r) => (r.oiChg4h ?? r.oiChg1h ?? 0) > 1 && (r.chg4h ?? r.chg24h) < 0 && r.funding8h < 0,
    sort: { key: "oiChg4h", dir: -1 },
  },
  { id: "crowded_longs", label: "Crowded longs", hint: "Funding hot and OI still growing", match: (r) => r.funding8h > 0.03 && (r.oiChg4h ?? 0) >= 0, sort: { key: "funding8h", dir: -1 } },
  { id: "vol_spike", label: "Volume spike", hint: "24h volume 2× its average or more", match: (r) => (r.relVol ?? 0) >= 2, sort: { key: "relVol", dir: -1 } },
  { id: "sharps_break", label: "Sharps break", hint: "Sharps far from their own market-wide stance", match: (r) => Math.abs(r.relative ?? 0) >= 40, sort: { key: "relative", dir: -1 } },
];

export const MIN_VOLUME = 500_000;

export function sortRows(rows: ScreenerRow[], key: keyof ScreenerRow, dir: 1 | -1): ScreenerRow[] {
  return [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    // Nulls always sink to the bottom, whatever the direction.
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * dir;
    return ((va as number) - (vb as number)) * dir;
  });
}
