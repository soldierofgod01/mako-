// ════════════════════════════════════════════════════════════════
// Market Pulse — Glassnode-style regime read for one coin.
// Every metric: current value, change vs ~7 days ago, and where it sits in
// its OWN history (percentile → low band / range / high band), plus one
// plain-English line. Descriptive, not a trade call.
// ════════════════════════════════════════════════════════════════

export type Band = "low" | "lower" | "mid" | "upper" | "high";

export interface PulseMetric {
  id: string;
  group: PulseGroupId;
  label: string;
  value: number | null;
  display: string;
  change: string | null; // vs ~7d ago, already formatted
  changeSign: -1 | 0 | 1;
  pct: number | null; // percentile of current vs history (0–100)
  band: Band | null;
  window: string | null; // e.g. "vs 90d", "vs 6d (history building)"
  read: string;
  /** History for the tile chart (oldest first) and the 20th–80th percentile "normal range" of the comparison window. */
  series?: { t: number; v: number }[];
  range?: { lo: number; hi: number };
  bars?: boolean;
}

export type PulseGroupId = "price" | "perps" | "options" | "liquidity";

export const GROUPS: { id: PulseGroupId; label: string }[] = [
  { id: "price", label: "Price & volume" },
  { id: "perps", label: "Perpetuals" },
  { id: "options", label: "Options" },
  { id: "liquidity", label: "Liquidity" },
];

/** Percentile of x within history (share of history strictly below x, ties half). */
export function percentile(x: number, hist: number[]): number | null {
  const h = hist.filter((v) => Number.isFinite(v));
  if (h.length < 10 || !Number.isFinite(x)) return null;
  let below = 0, eq = 0;
  for (const v of h) { if (v < x) below++; else if (v === x) eq++; }
  return ((below + eq / 2) / h.length) * 100;
}

export function bandOf(p: number | null): Band | null {
  if (p == null) return null;
  if (p < 20) return "low";
  if (p < 40) return "lower";
  if (p <= 60) return "mid";
  if (p <= 80) return "upper";
  return "high";
}

export const BAND_LABEL: Record<Band, string> = {
  low: "Below low band",
  lower: "Lower part of range",
  mid: "Middle of range",
  upper: "Upper part of range",
  high: "Above high band",
};

/** 20th/80th percentiles — the band edges used for low/high. */
export function rangeOf(hist: number[]): { lo: number; hi: number } | undefined {
  const h = hist.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (h.length < 10) return undefined;
  const q = (p: number) => h[Math.min(h.length - 1, Math.max(0, Math.round(p * (h.length - 1))))];
  return { lo: q(0.2), hi: q(0.8) };
}

// ─── series helpers ─────────────────────────────────────────────

export function rsi(closes: number[], n = 14): number[] {
  const out: number[] = [];
  let g = 0, l = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const up = Math.max(0, d), dn = Math.max(0, -d);
    if (i <= n) {
      g += up / n; l += dn / n;
      if (i === n) out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
    } else {
      g = (g * (n - 1) + up) / n;
      l = (l * (n - 1) + dn) / n;
      out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
    }
  }
  return out;
}

/** Rolling annualised close-to-close vol (%) over `n` daily returns. */
export function rollingVol(closes: number[], n: number): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  const out: number[] = [];
  for (let i = n; i <= r.length; i++) {
    const w = r.slice(i - n, i);
    const m = w.reduce((s, x) => s + x, 0) / n;
    const v = w.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1);
    out.push(Math.sqrt(v * 365) * 100);
  }
  return out;
}

export function rollingMean(xs: number[], n: number): number[] {
  const out: number[] = [];
  for (let i = n; i <= xs.length; i++) out.push(xs.slice(i - n, i).reduce((s, x) => s + x, 0) / n);
  return out;
}

// ─── formatting ─────────────────────────────────────────────────

export function usdShort(v: number) {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}
const signed = (v: number, digits: number, suffix = "") => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}${suffix}`;
const sgn = (v: number | null): -1 | 0 | 1 => (v == null || v === 0 ? 0 : v > 0 ? 1 : -1);

// ─── inputs → metrics ───────────────────────────────────────────

export interface PulseInputs {
  daily: { t: number; c: number; v: number }[]; // HL 1d candles, oldest first (v in coin)
  funding: { t: number; rate: number }[]; // hourly
  oi: { t: number; oi: number; px: number }[]; // oi in coins, 5-min snapshots (≤7d)
  cvdDaily: { t: number; net: number }[] | null; // recorder (top 20), oldest first
  dvolDaily: { t: number; v: number }[] | null; // BTC/ETH
  atmIv30: number | null; // non-DVOL coins with options
  skew25: number | null;
  depth1pct: number | null; // live book, USD both sides within ±1%
  oiNow: number | null;
}

export function buildPulse(x: PulseInputs): PulseMetric[] {
  const out: PulseMetric[] = [];
  const closes = x.daily.map((d) => d.c);
  const push = (m: Omit<PulseMetric, "band">) => out.push({ ...m, band: bandOf(m.pct) });

  // Price momentum — RSI(14) on daily closes, vs 180d of RSI.
  const r = rsi(closes);
  if (r.length >= 2) {
    const now = r[r.length - 1];
    const prev = r[r.length - 8] ?? null;
    const pct = percentile(now, r.slice(-181, -1));
    push({
      id: "momentum", group: "price", label: "Price momentum", value: now, display: now.toFixed(1),
      change: prev != null ? signed(now - prev, 1) : null, changeSign: sgn(prev != null ? now - prev : null),
      pct, window: "RSI 14d vs 180d",
      series: r.slice(-90).map((v, i, a) => ({ t: x.daily[x.daily.length - a.length + i].t, v })),
      range: rangeOf(r.slice(-181, -1)),
      read: now < 30 ? "Deeply oversold — sellers have pressed hard." : now > 70 ? "Stretched upside — buyers have pressed hard." : pct != null && pct < 20 ? "Weak momentum for this coin's range." : pct != null && pct > 80 ? "Strong momentum for this coin's range." : "Neutral momentum.",
    });
  }

  // Volume — daily USD turnover vs 90d.
  const vol = x.daily.map((d) => d.v * d.c);
  if (vol.length >= 2) {
    // Today is partial — compare the last COMPLETE day.
    const last = vol[vol.length - 2];
    const prev = vol[vol.length - 9] ?? null;
    const pct = percentile(last, vol.slice(-92, -2));
    push({
      id: "volume", group: "price", label: "Volume (last full day)", value: last, display: usdShort(last),
      change: prev ? signed(((last - prev) / prev) * 100, 0, "%") : null, changeSign: sgn(prev ? last - prev : null),
      pct, window: "vs 90d",
      series: vol.slice(-91, -1).map((v, i, a) => ({ t: x.daily[x.daily.length - 1 - a.length + i].t, v })),
      range: rangeOf(vol.slice(-92, -2)), bars: true,
      read: pct == null ? "Turnover history building." : pct > 80 ? "Heavy participation — one of the busiest days in 3 months." : pct < 20 ? "Thin participation — moves are less trustworthy." : "Normal turnover.",
    });
  }

  // Realised volatility — 7d, vs 90d.
  const rv7 = rollingVol(closes, 7);
  if (rv7.length >= 2) {
    const now = rv7[rv7.length - 1];
    const prev = rv7[rv7.length - 8] ?? null;
    const pct = percentile(now, rv7.slice(-91, -1));
    push({
      id: "rv7", group: "price", label: "Realised vol (7d)", value: now, display: `${now.toFixed(1)}%`,
      change: prev != null ? signed(now - prev, 1, " pts") : null, changeSign: sgn(prev != null ? now - prev : null),
      pct, window: "vs 90d",
      series: rv7.slice(-90).map((v, i, a) => ({ t: x.daily[x.daily.length - a.length + i].t, v })),
      range: rangeOf(rv7.slice(-91, -1)),
      read: pct == null ? "History building." : pct > 80 ? "Volatile — ranges are wide; size down." : pct < 20 ? "Compressed — the tape is unusually quiet." : "Normal volatility.",
    });
  }

  // Open interest — vs the snapshots we have (≤7d).
  if (x.oi.length >= 12) {
    // Compare in coins (history is coin-denominated, so price moves don't fake a leverage change);
    // display in USD.
    const last = x.oi[x.oi.length - 1];
    const now = last.oi;
    const nowUsd = x.oiNow ?? last.oi * last.px;
    const first = x.oi[0];
    const target = Date.now() - 7 * 86_400_000;
    const ref = x.oi.find((p) => p.t >= target) ?? first;
    const days = Math.max(1, Math.round((Date.now() - ref.t) / 86_400_000));
    const hourly = x.oi.filter((_, i) => i % 12 === 0).map((p) => p.oi);
    const pct = percentile(now, hourly);
    const spanDays = Math.round((Date.now() - first.t) / 86_400_000);
    push({
      id: "oi", group: "perps", label: "Open interest", value: nowUsd, display: usdShort(nowUsd),
      change: `${signed(((now - ref.oi) / ref.oi) * 100, 1, "%")}${days < 7 ? ` (${days}d)` : ""}`, changeSign: sgn(now - ref.oi),
      pct, window: `vs ${spanDays}d${spanDays < 7 ? " (history building)" : ""}`,
      series: x.oi.filter((_, i) => i % 12 === 0).map((q) => ({ t: q.t, v: q.oi * q.px })),
      range: rangeOf(x.oi.filter((_, i) => i % 12 === 0).map((q) => q.oi * q.px)),
      read: pct == null ? "History building." : pct > 80 ? "Leverage building — positioning is crowded." : pct < 20 ? "Leverage flushed — fewer positions left to force out." : "Normal leverage.",
    });
  }

  // Funding — 7d average, annualised, vs 90d of 7d averages.
  if (x.funding.length >= 24 * 14) {
    const byDay = new Map<number, number[]>();
    for (const f of x.funding) {
      const d = Math.floor(f.t / 86_400_000);
      (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(f.rate);
    }
    const dayKeys = [...byDay.keys()].sort((a, b) => a - b);
    const daily = dayKeys.map((k) => byDay.get(k)!).map((v) => v.reduce((s, q) => s + q, 0) / v.length);
    const avg7 = rollingMean(daily, 7).map((h) => h * 24 * 365 * 100);
    const now = avg7[avg7.length - 1];
    const prev = avg7[avg7.length - 8] ?? null;
    const pct = percentile(now, avg7.slice(-91, -1));
    push({
      id: "funding", group: "perps", label: "Funding (7d avg, APR)", value: now, display: signed(now, 1, "%"),
      change: prev != null ? signed(now - prev, 1, " pts") : null, changeSign: sgn(prev != null ? now - prev : null),
      pct, window: `vs ${Math.min(90, avg7.length)}d`,
      series: avg7.slice(-90).map((v, i, a) => ({ t: dayKeys[dayKeys.length - a.length + i] * 86_400_000, v })),
      range: rangeOf(avg7.slice(-91, -1)),
      // Sign decides who pays; the band says whether that's unusual for this coin.
      read: now < 0
        ? now < -5 ? "Shorts paying — the short side is crowded; squeeze fuel." : "Slightly negative — shorts paying a little."
        : now > 15 || (pct != null && pct > 80) ? "Longs paying up — the long side is crowded."
        : pct != null && pct < 20 ? "Longs still pay, but far less than usual — long appetite has cooled."
        : "Funding normal — no crowding.",
    });
  }

  // Perp CVD — last full day's net aggressive flow (recorder, top 20 coins).
  if (x.cvdDaily && x.cvdDaily.length >= 2) {
    const full = x.cvdDaily.slice(0, -1); // drop today (partial)
    const last = full[full.length - 1];
    const prev = full[full.length - 8] ?? null;
    const pct = percentile(last.net, full.slice(0, -1).map((d) => d.net));
    push({
      id: "cvd", group: "perps", label: "Perp CVD (last full day)", value: last.net, display: usdShort(last.net),
      change: prev ? `${usdShort(last.net - prev.net)} vs 7d ago` : null, changeSign: sgn(prev ? last.net - prev.net : null),
      pct, window: `vs ${full.length - 1}d${full.length < 15 ? " (history building)" : ""}`,
      series: full.map((d) => ({ t: d.t, v: d.net })), bars: true,
      range: rangeOf(full.slice(0, -1).map((d) => d.net)),
      read: last.net < 0 ? (pct != null && pct < 20 ? "Heavy aggressive selling — takers are hitting bids." : "Net aggressive selling.") : pct != null && pct > 80 ? "Heavy aggressive buying — takers are lifting offers." : "Net aggressive buying.",
    });
  }

  // IV − RV — options vs realised (DVOL coins get a band; others current only).
  const rv30 = rollingVol(closes, 30);
  if (rv30.length) {
    const rvNow = rv30[rv30.length - 1];
    if (x.dvolDaily && x.dvolDaily.length > 30) {
      const ivByDay = new Map(x.dvolDaily.map((d) => [Math.floor(d.t / 86_400_000), d.v]));
      const dayIdx = x.daily.slice(-rv30.length).map((d) => Math.floor(d.t / 86_400_000));
      const spreadPts = dayIdx.map((d, i) => ({ t: d * 86_400_000, v: ivByDay.has(d) ? ivByDay.get(d)! - rv30[i] : NaN })).filter((q) => Number.isFinite(q.v));
      const spreads = spreadPts.map((q) => q.v);
      const ivNow = x.dvolDaily[x.dvolDaily.length - 1].v;
      const now = ivNow - rvNow;
      const prev = spreads[spreads.length - 8] ?? null;
      const pct = percentile(now, spreads.slice(-91, -1));
      push({
        id: "ivrv", group: "options", label: "Volatility spread (DVOL − RV30)", value: now, display: signed(now, 1, " pts"),
        change: prev != null ? signed(now - prev, 1, " pts") : null, changeSign: sgn(prev != null ? now - prev : null),
        pct, window: "vs 90d",
        series: spreadPts.slice(-90), range: rangeOf(spreads.slice(-91, -1)),
        read: pct != null && pct > 80 ? "Options rich vs realised — the market is paying for movement or protection." : pct != null && pct < 20 ? "Options cheap vs realised — movement is under-priced." : "Implied roughly in line with realised.",
      });
    } else if (x.atmIv30 != null) {
      const now = x.atmIv30 - rvNow;
      push({
        id: "ivrv", group: "options", label: "Volatility spread (ATM IV − RV30)", value: now, display: signed(now, 1, " pts"),
        change: null, changeSign: 0, pct: null, window: "current only",
        read: now > 5 ? "Options rich vs realised." : now < -5 ? "Options cheap vs realised." : "Implied roughly in line with realised.",
      });
    }
  }
  if (x.skew25 != null) {
    push({
      id: "skew", group: "options", label: "25Δ skew (30d)", value: x.skew25, display: signed(x.skew25, 1, " pts"),
      change: null, changeSign: 0, pct: null, window: "fixed thresholds",
      read: x.skew25 < -3 ? "Puts bid over calls — downside hedging demand." : x.skew25 > 3 ? "Calls bid over puts — upside demand." : "Balanced — no strong hedging lean.",
    });
  }

  // Liquidity — live book depth within ±1%, and as a share of OI.
  if (x.depth1pct != null) {
    const ratio = x.oiNow ? (x.depth1pct / x.oiNow) * 100 : null;
    push({
      id: "depth", group: "liquidity", label: "Book depth ±1%", value: x.depth1pct, display: usdShort(x.depth1pct),
      change: null, changeSign: 0, pct: null, window: "live",
      read: ratio == null ? "Resting bids + asks within 1% of price." : `${ratio.toFixed(2)}% of open interest could be absorbed within 1% — ${ratio < 1 ? "thin vs positioning; forced flows move price easily." : ratio < 3 ? "moderate cushion." : "deep cushion vs positioning."}`,
    });
  }
  return out;
}

/** Group rating: average percentile of banded metrics → Low / Moderate / High, trend from 7d changes. */
export function groupSummary(ms: PulseMetric[]) {
  const ps = ms.map((m) => m.pct).filter((p): p is number => p != null);
  const avg = ps.length ? ps.reduce((s, p) => s + p, 0) / ps.length : null;
  const level = avg == null ? null : avg < 35 ? "Low" : avg > 65 ? "High" : "Moderate";
  const tr = ms.reduce((s, m) => s + m.changeSign, 0);
  const trend = ms.some((m) => m.changeSign !== 0) ? (tr > 0 ? "rising" : tr < 0 ? "declining" : "mixed") : null;
  return { level, trend };
}
