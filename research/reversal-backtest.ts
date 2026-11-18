// ════════════════════════════════════════════════════════════════
// Research: after a sharp move, does price revert or continue?
//
// Why: on 18 Nov the Terminal's 15m bias was anti-predictive — it mostly
// echoed the last 15 min of price, and price mean-reverted. One day isn't
// enough to rebuild on. This tests the same question on months of free
// Hyperliquid candles across the recorder's 20 coins.
//
// Tests (all non-overlapping windows; "z" uses only trailing data):
//   A. corr(past h-bar return, next h-bar return) per coin + pooled
//   B. sharp-move buckets by z → mean fwd return, reversal rate
//   C. sharp moves split by volume (effort vs result): high-volume vs
//      low-volume moves — which one continues?
//   D. stability: the same 15m correlation week by week
//   E. a naive "fade |z|>2" rule, gross bps per trade vs HL taker fees
//
// Run:  npx tsx research/reversal-backtest.ts   (needs api.hyperliquid.xyz)
// Writes research-out/summary.md and research-out/results.json.
// ════════════════════════════════════════════════════════════════
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";

const HL = "https://api.hyperliquid.xyz/info";
const COINS = (process.env.COINS ?? "BTC,ETH,HYPE,SOL,ZEC,XRP,DOGE,LIT,NEAR,XMR,PUMP,VVV,kPEPE,AAVE,UNI,ZRO,XPL,ENA,WLD,ASTER").split(",");
const IV_MS: Record<string, number> = { "5m": 3e5, "15m": 9e5, "1h": 3.6e6 };
// interval → horizons in bars (label)
const TESTS: { iv: string; hs: [number, string][] }[] = [
  { iv: "5m", hs: [[1, "5m"], [3, "15m"]] },
  { iv: "15m", hs: [[1, "15m"], [4, "1h"], [16, "4h"]] },
  { iv: "1h", hs: [[1, "1h"], [4, "4h"]] },
];
const TAKER_BPS_ROUNDTRIP = 9; // ~0.045% per side at HL's base taker tier

interface Bar { t: number; c: number; v: number }

async function candles(coin: string, iv: string): Promise<Bar[]> {
  const end = Date.now();
  const start = end - 5000 * IV_MS[iv]; // HL keeps the most recent 5000 candles
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval: iv, startTime: start, endTime: end } }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const raw = (await r.json()) as { t: number; c: string; v: string }[];
      return raw.map((k) => ({ t: k.t, c: +k.c, v: +k.v })).filter((b) => b.c > 0);
    } catch (e) {
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
      if (i === 3) throw e;
    }
  }
  return [];
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
function corr(x: number[], y: number[]) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}
const median = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "—");

interface Sample { t: number; past: number; fwd: number; z: number; volRatio: number }

/** Non-overlapping samples: each window = h bars past, h bars forward. */
function samples(bars: Bar[], h: number, ivMs: number): Sample[] {
  const lr = bars.map((b, i) => (i ? Math.log(b.c / bars[i - 1].c) : 0));
  const out: Sample[] = [];
  const look = Math.round((7 * 864e5) / ivMs); // ~7 days of bars for the z baseline
  for (let i = look + h; i + h < bars.length; i += h) {
    // skip windows with a gap in the data
    if (bars[i + h].t - bars[i - h].t !== 2 * h * ivMs) continue;
    let past = 0, fwd = 0, vPast = 0;
    for (let k = i - h + 1; k <= i; k++) { past += lr[k]; vPast += bars[k].v; }
    for (let k = i + 1; k <= i + h; k++) fwd += lr[k];
    // trailing baseline: h-bar returns and h-bar volume over the previous ~7 days
    const hist: number[] = [], vols: number[] = [];
    for (let j = i - h - look; j + h <= i - h; j += h) {
      if (j < 1) continue;
      let s = 0, v = 0;
      for (let k = j + 1; k <= j + h; k++) { s += lr[k]; v += bars[k].v * bars[k].c; }
      hist.push(s); vols.push(v);
    }
    if (hist.length < 30) continue;
    const sig = sd(hist);
    let vPastUsd = 0; for (let k = i - h + 1; k <= i; k++) vPastUsd += bars[k].v * bars[k].c;
    out.push({ t: bars[i].t, past, fwd, z: sig > 0 ? past / sig : 0, volRatio: vPastUsd / (median(vols) || 1) });
    void vPast;
  }
  return out;
}

async function main() {
  mkdirSync("research-out", { recursive: true });
  const results: Record<string, unknown> = {};
  let md = `# Reversal vs continuation — Hyperliquid, ${COINS.length} coins\n\nGenerated ${new Date().toISOString()}. Non-overlapping windows; z uses trailing ~7d only. Positive corr = moves continue, negative = moves revert.\n\n`;

  const weekly15: Map<number, { x: number[]; y: number[] }> = new Map();

  for (const { iv, hs } of TESTS) {
    const data: Record<string, Bar[]> = {};
    for (const c of COINS) {
      try { data[c] = await candles(c, iv); } catch (e) { console.error(`${c} ${iv} failed: ${e}`); data[c] = []; }
      await new Promise((r) => setTimeout(r, 250));
    }
    const span = Object.values(data).filter((b) => b.length).map((b) => (b[b.length - 1].t - b[0].t) / 864e5);
    md += `## ${iv} candles (~${Math.round(median(span))} days of history)\n\n`;

    for (const [h, label] of hs) {
      const perCoin: { coin: string; n: number; r: number }[] = [];
      const pool: Sample[] = [];
      for (const c of COINS) {
        const s = samples(data[c], h, IV_MS[iv]);
        if (s.length < 50) continue;
        perCoin.push({ coin: c, n: s.length, r: corr(s.map((x) => x.past), s.map((x) => x.fwd)) });
        // pool on z-scored returns so big-vol coins don't dominate
        pool.push(...s);
        if (iv === "15m" && h === 1) {
          for (const x of s) {
            const wk = Math.floor(x.t / (7 * 864e5));
            const w = weekly15.get(wk) ?? { x: [], y: [] };
            const sg = x.z !== 0 ? x.past / x.z : 1; // per-coin sigma
            w.x.push(x.z); w.y.push(x.fwd / (sg || 1));
            weekly15.set(wk, w);
          }
        }
      }
      const zs = pool.map((x) => x.z);
      const fz = pool.map((x) => (x.z !== 0 ? x.fwd / (x.past / x.z) : 0)); // fwd in sigma units
      const pooledR = corr(zs, fz);
      const neg = perCoin.filter((p) => p.r < 0).length;
      const avgR = mean(perCoin.map((p) => p.r));
      const se = 1 / Math.sqrt(pool.length / Math.max(1, COINS.length / 4)); // rough: coins are correlated, ~4 effective per independent draw
      md += `### Horizon ${label} (past ${label} → next ${label})\n\n`;
      md += `- Pooled corr (z-scored): **${f(pooledR)}** · mean per-coin corr ${f(avgR)} · ${neg}/${perCoin.length} coins negative · n=${pool.length} (rough SE ±${f(se)})\n`;

      // B. buckets
      const B: [string, (z: number) => boolean][] = [["z < −2", (z) => z < -2], ["−2 … −1", (z) => z >= -2 && z < -1], ["−1 … 1", (z) => z >= -1 && z <= 1], ["1 … 2", (z) => z > 1 && z <= 2], ["z > 2", (z) => z > 2]];
      md += `\n| Past move | n | Mean next move (bps) | Reversal rate |\n|---|---|---|---|\n`;
      const buckets: Record<string, unknown> = {};
      for (const [name, fn] of B) {
        const s = pool.filter((x) => fn(x.z));
        const fwdBps = mean(s.map((x) => x.fwd * 1e4));
        const rev = s.filter((x) => Math.sign(x.fwd) === -Math.sign(x.past) && x.fwd !== 0).length / Math.max(1, s.filter((x) => x.fwd !== 0).length);
        md += `| ${name} | ${s.length} | ${f(fwdBps, 1)} | ${f(rev * 100, 1)}% |\n`;
        buckets[name] = { n: s.length, fwdBps, rev };
      }

      // C. effort vs result: sharp moves split by volume
      const sharp = pool.filter((x) => Math.abs(x.z) > 1.5);
      const cont = (s: Sample[]) => mean(s.map((x) => Math.sign(x.past) * x.fwd * 1e4));
      const hiV = sharp.filter((x) => x.volRatio >= 1.5), loV = sharp.filter((x) => x.volRatio < 0.8), midV = sharp.filter((x) => x.volRatio >= 0.8 && x.volRatio < 1.5);
      md += `\nSharp moves (|z|>1.5) by volume — **continuation** in bps (positive = kept going, negative = reverted):\n`;
      md += `- High volume (≥1.5× normal): ${f(cont(hiV), 1)} bps, n=${hiV.length}\n- Normal volume: ${f(cont(midV), 1)} bps, n=${midV.length}\n- Low volume (<0.8×): ${f(cont(loV), 1)} bps, n=${loV.length}\n`;

      // E. naive fade rule
      const big = pool.filter((x) => Math.abs(x.z) > 2);
      const fadeBps = mean(big.map((x) => -Math.sign(x.past) * x.fwd * 1e4));
      md += `\nNaive fade of |z|>2 moves: **${f(fadeBps, 1)} bps/trade gross** vs ~${TAKER_BPS_ROUNDTRIP} bps taker round-trip (n=${big.length}).\n`;

      md += `\n<details><summary>Per coin</summary>\n\n| Coin | n | corr |\n|---|---|---|\n${perCoin.sort((a, b) => a.r - b.r).map((p) => `| ${p.coin} | ${p.n} | ${f(p.r)} |`).join("\n")}\n\n</details>\n\n`;
      results[`${iv}:${label}`] = { pooledR, avgR, neg, coins: perCoin.length, n: pool.length, buckets, volume: { hi: cont(hiV), mid: cont(midV), lo: cont(loV), nHi: hiV.length, nMid: midV.length, nLo: loV.length }, fadeBps, nBig: big.length, perCoin };
    }
  }

  // D. stability
  md += `## Stability — 15m→15m corr, week by week (all coins pooled, z-scored)\n\n| Week starting | n | corr |\n|---|---|---|\n`;
  const weeks = [...weekly15.entries()].sort((a, b) => a[0] - b[0]);
  const wk: { week: string; n: number; r: number }[] = [];
  for (const [w, { x, y }] of weeks) {
    if (x.length < 200) continue;
    const r = corr(x, y);
    const d = new Date(w * 7 * 864e5).toISOString().slice(0, 10);
    wk.push({ week: d, n: x.length, r });
    md += `| ${d} | ${x.length} | ${f(r)} |\n`;
  }
  md += `\nWeeks negative: ${wk.filter((w) => w.r < 0).length}/${wk.length}\n`;
  results.weekly15 = wk;

  writeFileSync("research-out/summary.md", md);
  writeFileSync("research-out/results.json", JSON.stringify(results, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);
}

main().catch((e) => { console.error(e); process.exit(1); });
