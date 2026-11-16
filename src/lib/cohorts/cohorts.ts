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
  const result: Record<string, CoinCohorts> = {};
  for (const coin of coins) {
    const s = sharps.get(coin) ?? emptySide();
    const d = donors.get(coin) ?? emptySide();
    result[coin] = { sharps: s, donors: d, divergence: Math.round(((s.net - d.net) / 2) * 100) };
  }
  return result;
}
