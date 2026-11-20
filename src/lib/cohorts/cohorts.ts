// ════════════════════════════════════════════════════════════════
// Wallet cohorts — what the best Hyperliquid traders are doing vs what
// the worst ones are doing, per coin.
//
//   Sharps  — profitable all-time, active in the last 30 days, real size.
//   Donors  — biggest all-time losers that are still active.
//
// Source: Hyperliquid's public leaderboard (every wallet, all-time PnL,
// 30d volume, account value) + `clearinghouseState` for live positions.
//
// HONEST LIMITS:
//   • This is a sample of tracked wallets, not the whole market.
//   • All-time PnL ≠ future skill. Past winners can be lucky, and big
//     accounts can be funds hedging elsewhere.
//   • Market makers / HFT are excluded by turnover: their positions are
//     inventory, not a directional view.
// Pure functions here; the network lives in the API route.
// ════════════════════════════════════════════════════════════════

export interface LeaderboardRow {
  ethAddress: string;
  accountValue: string;
  windowPerformances: [string, { pnl: string; roi: string; vlm: string }][];
}

export interface CohortWallet {
  address: string;
  accountValue: number;
  allTimePnl: number;
  monthVlm: number;
}

export const COHORT_SIZE = 120;
// Monthly volume ÷ account value. Above this the wallet is turning its whole
// account over ~10× a day — a market maker or HFT bot, not a directional view.
export const MAX_MONTHLY_TURNOVER = 300;
export const MIN_SHARP_ACCOUNT = 50_000;
export const MIN_DONOR_ACCOUNT = 10_000;

function perf(row: LeaderboardRow, window: string) {
  const w = row.windowPerformances.find(([k]) => k === window)?.[1];
  return { pnl: w ? parseFloat(w.pnl) : 0, vlm: w ? parseFloat(w.vlm) : 0 };
}

export function selectCohorts(rows: LeaderboardRow[], size = COHORT_SIZE) {
  const wallets: CohortWallet[] = [];
  for (const r of rows) {
    const accountValue = parseFloat(r.accountValue);
    const all = perf(r, "allTime");
    const month = perf(r, "month");
    if (!isFinite(accountValue) || !isFinite(all.pnl)) continue;
    if (month.vlm <= 0) continue; // not active in 30 days
    if (accountValue > 0 && month.vlm / accountValue > MAX_MONTHLY_TURNOVER) continue;
    wallets.push({ address: r.ethAddress.toLowerCase(), accountValue, allTimePnl: all.pnl, monthVlm: month.vlm });
  }
  const sharps = wallets
    .filter((w) => w.allTimePnl > 0 && w.accountValue >= MIN_SHARP_ACCOUNT)
    .sort((a, b) => b.allTimePnl - a.allTimePnl)
    .slice(0, size);
  const donors = wallets
    .filter((w) => w.allTimePnl < 0 && w.accountValue >= MIN_DONOR_ACCOUNT)
    .sort((a, b) => a.allTimePnl - b.allTimePnl)
    .slice(0, size);
  return { sharps, donors };
}

export interface WalletPosition {
  coin: string;
  notionalUsd: number; // signed: + long, − short
  liqPx?: number | null;
  entryPx?: number | null;
}

/** One tracked position's cost basis: [entry price, signed notional USD, 0 = sharp | 1 = donor]. */
export type CostEntry = [number, number, 0 | 1];

/** A price where tracked wallets get liquidated (clustered within 0.3%). */
export interface LiqLevel {
  px: number;
  longUsd: number;   // longs liquidated here (forced sells — below price)
  shortUsd: number;  // shorts liquidated here (forced buys — above price)
  sharpsUsd: number;
  donorsUsd: number;
  wallets: number;
}

export interface CohortSide {
  longUsd: number;
  shortUsd: number;
  longWallets: number;
  shortWallets: number;
  net: number;          // (L − S) / (L + S), [-1, 1]
  topShare: number;     // largest single wallet's share of gross notional
}

export interface CoinCohorts {
  sharps: CohortSide;
  donors: CohortSide;
  divergence: number;   // [-100, 100]  + = sharps longer than donors
  liqLevels: LiqLevel[];
  /** Entry prices of every tracked position in this coin (for the cost-basis view). */
  entries?: CostEntry[];
}

const LIQ_CLUSTER = 0.003;
// Keep many: the client picks the biggest ones NEAR price. Keeping only the
// biggest overall dropped every nearby level (they're smaller, but they matter).
const MAX_LIQ_LEVELS = 60;

export function clusterLiqs(
  raw: { px: number; usd: number; long: boolean; sharp: boolean }[]
): LiqLevel[] {
  const pts = raw.filter((r) => r.px > 0 && r.usd > 0).sort((a, b) => a.px - b.px);
  const levels: (LiqLevel & { wpx: number })[] = [];
  for (const p of pts) {
    const last = levels[levels.length - 1];
    if (last && (p.px - last.px) / last.px <= LIQ_CLUSTER) {
      last.wpx += p.px * p.usd;
      if (p.long) last.longUsd += p.usd; else last.shortUsd += p.usd;
      if (p.sharp) last.sharpsUsd += p.usd; else last.donorsUsd += p.usd;
      last.wallets++;
      last.px = last.wpx / (last.longUsd + last.shortUsd); // usd-weighted centre
    } else {
      levels.push({
        px: p.px, wpx: p.px * p.usd,
        longUsd: p.long ? p.usd : 0, shortUsd: p.long ? 0 : p.usd,
        sharpsUsd: p.sharp ? p.usd : 0, donorsUsd: p.sharp ? 0 : p.usd,
        wallets: 1,
      });
    }
  }
  return levels
    .sort((a, b) => b.longUsd + b.shortUsd - (a.longUsd + a.shortUsd))
    .slice(0, MAX_LIQ_LEVELS)
    .map(({ wpx: _w, ...l }) => l)
    .sort((a, b) => b.px - a.px);
}

function emptySide(): CohortSide {
  return { longUsd: 0, shortUsd: 0, longWallets: 0, shortWallets: 0, net: 0, topShare: 0 };
}

function aggregateSide(positionsByWallet: WalletPosition[][]): Map<string, CohortSide> {
  const out = new Map<string, CohortSide>();
  const largest = new Map<string, number>();
  for (const positions of positionsByWallet) {
    for (const p of positions) {
      if (!p.notionalUsd) continue;
      const s = out.get(p.coin) ?? emptySide();
      if (p.notionalUsd > 0) { s.longUsd += p.notionalUsd; s.longWallets++; }
      else { s.shortUsd += -p.notionalUsd; s.shortWallets++; }
      out.set(p.coin, s);
      largest.set(p.coin, Math.max(largest.get(p.coin) ?? 0, Math.abs(p.notionalUsd)));
    }
  }
  for (const [coin, s] of out) {
    const gross = s.longUsd + s.shortUsd;
    s.net = gross > 0 ? (s.longUsd - s.shortUsd) / gross : 0;
    s.topShare = gross > 0 ? (largest.get(coin) ?? 0) / gross : 0;
  }
  return out;
}

export function buildCoinCohorts(sharpPositions: WalletPosition[][], donorPositions: WalletPosition[][]) {
  const sharps = aggregateSide(sharpPositions);
  const donors = aggregateSide(donorPositions);
  const coins = new Set([...sharps.keys(), ...donors.keys()]);

  const liqRaw = new Map<string, { px: number; usd: number; long: boolean; sharp: boolean }[]>();
  const addLiqs = (list: WalletPosition[][], sharp: boolean) => {
    for (const positions of list) for (const p of positions) {
      if (!p.liqPx || !p.notionalUsd) continue;
      const arr = liqRaw.get(p.coin) ?? [];
      arr.push({ px: p.liqPx, usd: Math.abs(p.notionalUsd), long: p.notionalUsd > 0, sharp });
      liqRaw.set(p.coin, arr);
    }
  };
  addLiqs(sharpPositions, true);
  addLiqs(donorPositions, false);

  const entries = new Map<string, CostEntry[]>();
  const addEntries = (list: WalletPosition[][], cohort: 0 | 1) => {
    for (const positions of list) for (const p of positions) {
      if (!p.entryPx || !p.notionalUsd) continue;
      const arr = entries.get(p.coin) ?? [];
      arr.push([p.entryPx, Math.round(p.notionalUsd), cohort]);
      entries.set(p.coin, arr);
    }
  };
  addEntries(sharpPositions, 0);
  addEntries(donorPositions, 1);

  const result: Record<string, CoinCohorts> = {};
  for (const coin of coins) {
    const s = sharps.get(coin) ?? emptySide();
    const d = donors.get(coin) ?? emptySide();
    result[coin] = {
      sharps: s,
      donors: d,
      divergence: Math.round(((s.net - d.net) / 2) * 100),
      liqLevels: clusterLiqs(liqRaw.get(coin) ?? []),
      entries: entries.get(coin) ?? [],
    };
  }
  return result;
}
