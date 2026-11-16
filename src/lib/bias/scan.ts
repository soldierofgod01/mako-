// ════════════════════════════════════════════════════════════════
// Bias Scanner — ranks every Hyperliquid perp by POSITIONING signals that
// can be computed for all coins at once on the server:
//   • Sharps vs donors (wallet cohorts)
//   • Funding crowding
// Live order flow (delta, absorption, prints, book) needs a per-coin tape,
// so it can't be scanned across 177 coins — the scanner shortlists, the
// Bias tab confirms with live flow. Reuses the Bias engine's own signal
// functions so the two tabs can never disagree on the same inputs.
// ════════════════════════════════════════════════════════════════

import { cohortSignal, crowdingSignal, WEIGHTS } from "@/lib/bias/engine";
import type { CoinCohorts } from "@/lib/cohorts/cohorts";

export interface ScanMarket {
  coin: string;
  symbol: string;
  markPrice: number;
  priceChange24hPct: number;
  volume24hUsd: number;
  openInterestUsd: number;
  fundingRate8h: number; // % per 8h
}

export type ScanTag = "sharps-long" | "sharps-short" | "crowded-long" | "crowded-short" | "aligned" | "thin";

export interface ScanRow extends ScanMarket {
  sharps: { net: number; n: number } | null;
  donors: { net: number; n: number } | null;
  divergence: number | null;
  positioning: number; // [-100, 100]
  tag: ScanTag;
  read: string;
}

export const MIN_SCAN_VOLUME = 500_000;

export function scanRow(m: ScanMarket, c: CoinCohorts | null | undefined): ScanRow {
  const cohort = cohortSignal(c ?? null, true);
  const crowd = crowdingSignal([{ t: 0, markPx: m.markPrice, oi: 0, fundingHourly: m.fundingRate8h / 8 / 100 }]);

  const parts = [cohort, crowd].filter((s) => s.available);
  const w = parts.reduce((s, x) => s + x.weight, 0);
  // Normalise over the two scannable signals' combined weight.
  const raw = w > 0 ? parts.reduce((s, x) => s + x.weight * x.score, 0) / (WEIGHTS.cohort + WEIGHTS.crowding) : 0;
  const positioning = Math.round(Math.max(-1, Math.min(1, raw)) * 100);

  const nS = c ? c.sharps.longWallets + c.sharps.shortWallets : 0;
  const nD = c ? c.donors.longWallets + c.donors.shortWallets : 0;
  const f = m.fundingRate8h;

  const hot = f > 0.03;   // longs paying well above HL's 0.01% baseline
  const neg = f < -0.01;  // shorts paying

  const phrases: string[] = [];
  let tag: ScanTag;
  if (cohort.available && c && c.divergence >= 25) {
    tag = "sharps-long";
    phrases.push("Sharps longer than donors");
  } else if (cohort.available && c && c.divergence <= -25) {
    tag = "sharps-short";
    phrases.push("Sharps shorter than donors");
  } else if (hot) {
    tag = "crowded-long";
  } else if (neg) {
    tag = "crowded-short";
  } else {
    tag = cohort.available ? "aligned" : "thin";
  }
  if (cohort.available && tag !== "sharps-long" && tag !== "sharps-short") phrases.push("Cohorts aligned");
  if (hot) phrases.push("longs paying up");
  if (neg) phrases.push("shorts paying");
  if (!phrases.length) phrases.push("Too few tracked wallets");
  const read = phrases.join(" · ").replace(/^./, (ch) => ch.toUpperCase());

  return {
    ...m,
    sharps: c && nS > 0 ? { net: c.sharps.net, n: nS } : null,
    donors: c && nD > 0 ? { net: c.donors.net, n: nD } : null,
    divergence: c && nS >= 3 ? c.divergence : null,
    positioning,
    tag,
    read,
  };
}

export function buildScan(markets: ScanMarket[], byCoin: Record<string, CoinCohorts>): ScanRow[] {
  return markets
    .filter((m) => m.volume24hUsd >= MIN_SCAN_VOLUME)
    .map((m) => scanRow(m, byCoin[m.coin]))
    .sort((a, b) => Math.abs(b.positioning) - Math.abs(a.positioning) || b.volume24hUsd - a.volume24hUsd);
}
