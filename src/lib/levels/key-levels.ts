// ════════════════════════════════════════════════════════════════
// Key levels — one ranked list from four independent sources:
//   • gamma strikes        (Deribit options, $ gamma per 1% by strike)
//   • cost-basis clusters  (where tracked HL wallets entered)
//   • liquidation clusters (where tracked HL wallets get force-closed)
//   • swing highs / lows   (4h pivots on HL candles, last ~14 days)
// Candidates within a small band merge into one level. A level ranks by
// how many DIFFERENT sources agree (confluence), then by how big each one
// is. This is a scoring rule for "where things pile up", not a forecast.
// ════════════════════════════════════════════════════════════════

export type LevelSource = "gamma" | "basis" | "liq" | "swing";

export interface LevelPart {
  source: LevelSource;
  px: number;
  /** 0–1 size relative to the biggest of its own source near price. */
  weight: number;
  /** Plain-English detail, e.g. "Short entries $14.2M". */
  label: string;
}

export interface KeyLevel {
  px: number;
  distPct: number;           // + above price, − below
  parts: LevelPart[];
  sources: LevelSource[];    // distinct, ordered
  score: number;             // 0–~5
  strength: "Strong" | "Medium" | "Weak";
}

export interface LevelInputs {
  px: number;
  gex?: { strike: number; abs: number }[] | null;
  entries?: [number, number, 0 | 1][] | null;          // [entry px, signed USD, cohort]
  liqs?: { px: number; longUsd: number; shortUsd: number }[] | null;
  candles?: { t: number; h: number; l: number; c: number }[] | null; // 1h, oldest first
}

const RANGE = 0.15;            // only look within ±15% of price
const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`);
const near = (px: number, p: number) => Math.abs(p / px - 1) <= RANGE;

/** Keep the n biggest by weight, weights rescaled to the biggest = 1. */
function topN(parts: LevelPart[], n: number): LevelPart[] {
  const s = [...parts].sort((a, b) => b.weight - a.weight).slice(0, n);
  const max = s[0]?.weight || 1;
  return s.map((p) => ({ ...p, weight: p.weight / max }));
}

function gammaParts(px: number, gex: LevelInputs["gex"]): LevelPart[] {
  if (!gex?.length) return [];
  return topN(
    gex.filter((g) => near(px, g.strike) && g.abs > 0).map((g) => ({ source: "gamma" as const, px: g.strike, weight: g.abs, label: `Gamma strike · ${usd(g.abs)} per 1%` })),
    6,
  );
}

function basisParts(px: number, entries: LevelInputs["entries"]): LevelPart[] {
  if (!entries?.length) return [];
  const step = px * 0.005;
  const bins = new Map<number, { long: number; short: number; wsum: number; w: number }>();
  for (const [e, u] of entries) {
    if (!near(px, e)) continue;
    const k = Math.round(e / step);
    const b = bins.get(k) ?? { long: 0, short: 0, wsum: 0, w: 0 };
    if (u > 0) b.long += u; else b.short += -u;
    b.wsum += e * Math.abs(u); b.w += Math.abs(u);
    bins.set(k, b);
  }
  const parts: LevelPart[] = [];
  for (const b of bins.values()) {
    const tot = b.long + b.short;
    if (!tot) continue;
    const side = b.long >= b.short ? `Long entries ${usd(b.long)}` : `Short entries ${usd(b.short)}`;
    parts.push({ source: "basis", px: b.wsum / b.w, weight: tot, label: side });
  }
  return topN(parts, 6);
}

function liqParts(px: number, liqs: LevelInputs["liqs"]): LevelPart[] {
  if (!liqs?.length) return [];
  return topN(
    liqs
      .filter((l) => near(px, l.px) && l.longUsd + l.shortUsd > 0)
      .map((l) => ({
        source: "liq" as const,
        px: l.px,
        weight: l.longUsd + l.shortUsd,
        label: l.longUsd >= l.shortUsd ? `Long liquidations ${usd(l.longUsd)}` : `Short liquidations ${usd(l.shortUsd)}`,
      })),
    6,
  );
}

/** 4h pivots: a bar whose high (low) is the extreme of the 3 bars either side. */
function swingParts(px: number, candles: LevelInputs["candles"]): LevelPart[] {
  if (!candles || candles.length < 40) return [];
  const H4 = 4 * 3600_000;
  const bars: { t: number; h: number; l: number }[] = [];
  for (const k of candles) {
    const t = Math.floor(k.t / H4) * H4;
    const last = bars[bars.length - 1];
    if (last && last.t === t) { last.h = Math.max(last.h, k.h); last.l = Math.min(last.l, k.l); }
    else bars.push({ t, h: k.h, l: k.l });
  }
  const recent = bars.slice(-84); // ~14 days
  const N = 3, parts: LevelPart[] = [];
  for (let i = N; i < recent.length - N; i++) {
    const win = recent.slice(i - N, i + N + 1);
    const b = recent[i];
    const age = (recent.length - 1 - i) / recent.length; // 0 newest → 1 oldest
    const w = 1 - 0.6 * age;                               // newer pivots count more
    const when = new Date(b.t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    if (b.h === Math.max(...win.map((x) => x.h)) && near(px, b.h)) parts.push({ source: "swing", px: b.h, weight: w, label: `4h swing high · ${when}` });
    if (b.l === Math.min(...win.map((x) => x.l)) && near(px, b.l)) parts.push({ source: "swing", px: b.l, weight: w, label: `4h swing low · ${when}` });
  }
  return topN(parts, 8);
}

const ORDER: LevelSource[] = ["gamma", "basis", "liq", "swing"];

export function buildKeyLevels(inp: LevelInputs, max = 12): KeyLevel[] {
  const { px } = inp;
  if (!px) return [];
  const all = [
    ...gammaParts(px, inp.gex),
    ...basisParts(px, inp.entries),
    ...liqParts(px, inp.liqs),
    ...swingParts(px, inp.candles),
  ].sort((a, b) => a.px - b.px);
  if (!all.length) return [];

  // Merge candidates that sit within 0.5% of the running cluster's price.
  const tol = px * 0.005;
  const clusters: LevelPart[][] = [];
  for (const p of all) {
    const c = clusters[clusters.length - 1];
    if (c) {
      const cpx = c.reduce((s, q) => s + q.px * (q.weight + 0.1), 0) / c.reduce((s, q) => s + q.weight + 0.1, 0);
      if (Math.abs(p.px - cpx) <= tol) { c.push(p); continue; }
    }
    clusters.push([p]);
  }

  const levels: KeyLevel[] = clusters.map((parts) => {
    const sources = ORDER.filter((s) => parts.some((p) => p.source === s));
    // Each source contributes its strongest piece (0–1); each extra source adds a confluence bonus.
    const best = sources.map((s) => Math.max(...parts.filter((p) => p.source === s).map((p) => p.weight)));
    const score = best.reduce((s, w) => s + w, 0) + 0.75 * (sources.length - 1);
    const lpx = parts.reduce((s, q) => s + q.px * (q.weight + 0.1), 0) / parts.reduce((s, q) => s + q.weight + 0.1, 0);
    return {
      px: lpx,
      distPct: (lpx / px - 1) * 100,
      parts: [...parts].sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source) || b.weight - a.weight),
      sources,
      score,
      strength: sources.length >= 3 || score >= 2.6 ? "Strong" : sources.length === 2 || score >= 1.4 ? "Medium" : "Weak",
    };
  });

  return levels.sort((a, b) => b.score - a.score).slice(0, max);
}

export const SOURCE_LABEL: Record<LevelSource, string> = {
  gamma: "Gamma",
  basis: "Cost basis",
  liq: "Liquidations",
  swing: "Swing",
};
