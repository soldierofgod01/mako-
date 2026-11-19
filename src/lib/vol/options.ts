// ════════════════════════════════════════════════════════════════
// Options math for the Volatility tab. Everything is derived from one
// Deribit book-summary call per chain (mark IV + open interest per
// option) — Greeks are computed here with Black-Scholes (r = 0, priced
// off each expiry's forward), not fetched per instrument.
// ════════════════════════════════════════════════════════════════

export interface DeribitSummary {
  instrument_name: string;
  mark_iv: number | null;
  open_interest: number;
  underlying_price: number;
  volume_usd?: number;
}

export interface OptionRow {
  expiry: number; // ms, 08:00 UTC
  strike: number;
  type: "C" | "P";
  iv: number; // decimal (0.46)
  oi: number; // in underlying units
  fwd: number;
}

const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const YEAR_MS = 365 * 24 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** "BTC-20NOV26-64000-P" / "XRP_USDC-27NOV26-1d35-C" → parts. */
export function parseInstrument(name: string): { base: string; expiry: number; strike: number; type: "C" | "P" } | null {
  const m = /^([A-Z0-9_]+)-(\d{1,2})([A-Z]{3})(\d{2})-([\dd.]+)-([CP])$/.exec(name);
  if (!m) return null;
  const mon = MONTHS[m[3]];
  if (mon === undefined) return null;
  const strike = parseFloat(m[5].replace("d", "."));
  if (!(strike > 0)) return null;
  return { base: m[1], expiry: Date.UTC(2000 + +m[4], mon, +m[2], 8), strike, type: m[6] as "C" | "P" };
}

export function toRows(summaries: DeribitSummary[], base: string): OptionRow[] {
  const out: OptionRow[] = [];
  for (const s of summaries) {
    const p = parseInstrument(s.instrument_name);
    if (!p || p.base !== base) continue;
    if (!(s.mark_iv && s.mark_iv > 0) || !(s.underlying_price > 0)) continue;
    out.push({ expiry: p.expiry, strike: p.strike, type: p.type, iv: s.mark_iv / 100, oi: s.open_interest || 0, fwd: s.underlying_price });
  }
  return out;
}

// ─── Black-Scholes (r = 0) ──────────────────────────────────────

const SQRT2PI = Math.sqrt(2 * Math.PI);
const pdf = (x: number) => Math.exp(-0.5 * x * x) / SQRT2PI;
/** Abramowitz-Stegun normal CDF (|err| < 7.5e-8). */
function cdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
function d1(S: number, K: number, iv: number, T: number) {
  return (Math.log(S / K) + 0.5 * iv * iv * T) / (iv * Math.sqrt(T));
}
export function bsDelta(S: number, K: number, iv: number, T: number, type: "C" | "P") {
  const n = cdf(d1(S, K, iv, T));
  return type === "C" ? n : n - 1;
}
export function bsGamma(S: number, K: number, iv: number, T: number) {
  return pdf(d1(S, K, iv, T)) / (S * iv * Math.sqrt(T));
}

// ─── Surface ────────────────────────────────────────────────────

export interface ExpiryPoint {
  expiry: number;
  days: number;
  atmIv: number; // %
  oi: number;
}

export interface GexLevel {
  strike: number;
  gex: number; // $ per 1% move, signed by convention (+calls −puts) — NOT shown in the UI (Nov 2026)
  abs: number; // $ per 1% move, calls + puts — gamma concentration, no direction assumed
}

export interface VolSurface {
  spot: number;
  term: ExpiryPoint[];
  atm30: number | null; // %
  front: ExpiryPoint | null;
  back: ExpiryPoint | null; // ~90d
  skew25: number | null; // call25 IV − put25 IV, vol points (30d)
  putCallOi: number | null;
  gex: GexLevel[]; // per strike, all expiries
  totalGex: number;
  flip: number | null;
  maxPain: { expiry: number; strike: number } | null;
  totalOi: number;
}

const MIN_T = 1 / (365 * 24); // ignore options with < 1h left

/** ATM IV for one expiry: average C/P IV per strike, interpolated at the forward. */
function atmIvFor(rows: OptionRow[]): number | null {
  if (!rows.length) return null;
  const F = rows[0].fwd;
  const byK = new Map<number, number[]>();
  for (const r of rows) {
    const a = byK.get(r.strike) ?? [];
    a.push(r.iv);
    byK.set(r.strike, a);
  }
  const ks = [...byK.keys()].sort((a, b) => a - b);
  const ivAt = (k: number) => {
    const a = byK.get(k)!;
    return a.reduce((s, x) => s + x, 0) / a.length;
  };
  let lo = -1;
  for (let i = 0; i < ks.length; i++) if (ks[i] <= F) lo = i;
  if (lo === -1) return ivAt(ks[0]);
  if (lo === ks.length - 1) return ivAt(ks[lo]);
  const k0 = ks[lo], k1 = ks[lo + 1];
  const w = (F - k0) / (k1 - k0);
  return ivAt(k0) * (1 - w) + ivAt(k1) * w;
}

/** IV at a target delta (calls +0.25, puts −0.25) by interpolating along delta. */
function ivAtDelta(rows: OptionRow[], T: number, type: "C" | "P", target: number): number | null {
  const pts = rows
    .filter((r) => r.type === type)
    .map((r) => ({ d: bsDelta(r.fwd, r.strike, r.iv, T, type), iv: r.iv }))
    .sort((a, b) => a.d - b.d);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.d - target) * (b.d - target) <= 0 && b.d !== a.d) {
      const w = (target - a.d) / (b.d - a.d);
      return a.iv * (1 - w) + b.iv * w;
    }
  }
  return null;
}

/** Interpolate a per-expiry quantity at `days` (linear in time; total variance for IV). */
function interpAt<T extends { days: number }>(pts: T[], days: number, get: (p: T) => number | null, variance = false): number | null {
  const ok = pts.filter((p) => get(p) != null);
  if (!ok.length) return null;
  if (days <= ok[0].days) return get(ok[0]);
  if (days >= ok[ok.length - 1].days) return get(ok[ok.length - 1]);
  for (let i = 1; i < ok.length; i++) {
    const a = ok[i - 1], b = ok[i];
    if (b.days >= days) {
      const w = (days - a.days) / (b.days - a.days);
      const va = get(a)!, vb = get(b)!;
      if (!variance) return va * (1 - w) + vb * w;
      const tv = va * va * a.days * (1 - w) + vb * vb * b.days * w;
      return Math.sqrt(tv / days);
    }
  }
  return null;
}

function gexAt(rows: OptionRow[], S: number, now: number) {
  let total = 0;
  for (const r of rows) {
    const T = (r.expiry - now) / YEAR_MS;
    if (T < MIN_T || r.oi <= 0) continue;
    const g = bsGamma(S, r.strike, r.iv, T) * r.oi * S * S * 0.01;
    total += r.type === "C" ? g : -g;
  }
  return total;
}

export function buildSurface(rows: OptionRow[], spotIn: number | null, now = Date.now()): VolSurface | null {
  const live = rows.filter((r) => (r.expiry - now) / YEAR_MS >= MIN_T);
  if (live.length < 8) return null;
  const byExp = new Map<number, OptionRow[]>();
  for (const r of live) {
    const a = byExp.get(r.expiry) ?? [];
    a.push(r);
    byExp.set(r.expiry, a);
  }
  const exps = [...byExp.keys()].sort((a, b) => a - b);
  const spot = spotIn && spotIn > 0 ? spotIn : byExp.get(exps[0])![0].fwd;

  // Term structure (skip expiries under 12h — their IV is mostly noise).
  const term: (ExpiryPoint & { rr: number | null })[] = [];
  for (const e of exps) {
    const rs = byExp.get(e)!;
    const days = (e - now) / DAY_MS;
    if (days < 0.5) continue;
    const atm = atmIvFor(rs);
    if (atm == null) continue;
    const T = days / 365;
    const c25 = ivAtDelta(rs, T, "C", 0.25);
    const p25 = ivAtDelta(rs, T, "P", -0.25);
    term.push({
      expiry: e,
      days,
      atmIv: atm * 100,
      oi: rs.reduce((s, r) => s + r.oi, 0),
      rr: c25 != null && p25 != null ? (c25 - p25) * 100 : null,
    });
  }
  const atm30 = interpAt(term, 30, (p) => p.atmIv / 100, true);
  const skew25 = interpAt(term, 30, (p) => p.rr);
  const front = term.find((p) => p.days >= 2) ?? term[0] ?? null;
  let back: ExpiryPoint | null = null;
  for (const p of term) if (!back || Math.abs(p.days - 90) < Math.abs(back.days - 90)) back = p;

  // Open interest
  let callOi = 0, putOi = 0;
  for (const r of live) (r.type === "C" ? (callOi += r.oi) : (putOi += r.oi));

  // GEX per strike at today's spot
  const byStrike = new Map<number, { gex: number; abs: number }>();
  for (const r of live) {
    const T = (r.expiry - now) / YEAR_MS;
    if (r.oi <= 0) continue;
    const g = bsGamma(spot, r.strike, r.iv, T) * r.oi * spot * spot * 0.01;
    const cur = byStrike.get(r.strike) ?? { gex: 0, abs: 0 };
    cur.gex += r.type === "C" ? g : -g;
    cur.abs += g;
    byStrike.set(r.strike, cur);
  }
  const gex = [...byStrike.entries()].map(([strike, v]) => ({ strike, ...v })).sort((a, b) => a.strike - b.strike);
  const totalGex = gex.reduce((s, x) => s + x.gex, 0);

  // Gamma flip: where total dealer gamma changes sign as spot moves (±15%).
  let flip: number | null = null;
  {
    const steps = 120;
    let prevS = spot * 0.85;
    let prevG = gexAt(live, prevS, now);
    let best = Infinity;
    for (let i = 1; i <= steps; i++) {
      const S = spot * (0.85 + (0.3 * i) / steps);
      const G = gexAt(live, S, now);
      if (prevG === 0 || prevG * G < 0) {
        const x = prevS + ((S - prevS) * Math.abs(prevG)) / (Math.abs(prevG) + Math.abs(G));
        if (Math.abs(x - spot) < best) { best = Math.abs(x - spot); flip = x; }
      }
      prevS = S;
      prevG = G;
    }
  }

  // Max pain for the nearest expiry (strike that minimises holders' payout).
  let maxPain: VolSurface["maxPain"] = null;
  {
    const e = exps[0];
    const rs = byExp.get(e)!;
    const ks = [...new Set(rs.map((r) => r.strike))].sort((a, b) => a - b);
    let bestK = 0, bestPay = Infinity;
    for (const k of ks) {
      let pay = 0;
      for (const r of rs) pay += r.oi * (r.type === "C" ? Math.max(0, k - r.strike) : Math.max(0, r.strike - k));
      if (pay < bestPay) { bestPay = pay; bestK = k; }
    }
    if (bestK > 0) maxPain = { expiry: e, strike: bestK };
  }

  return {
    spot,
    term: term.map(({ rr: _rr, ...p }) => p),
    atm30: atm30 != null ? atm30 * 100 : null,
    front,
    back,
    skew25,
    putCallOi: callOi > 0 ? putOi / callOi : null,
    gex,
    totalGex,
    flip,
    maxPain,
    totalOi: callOi + putOi,
  };
}

// ─── Realized volatility ────────────────────────────────────────

/** Annualised close-to-close RV (%) of the last `n` returns. */
export function realizedVol(closes: number[], n: number, periodsPerYear: number): number | null {
  if (closes.length < n + 1) return null;
  const c = closes.slice(-(n + 1));
  const r: number[] = [];
  for (let i = 1; i < c.length; i++) if (c[i] > 0 && c[i - 1] > 0) r.push(Math.log(c[i] / c[i - 1]));
  if (r.length < 2) return null;
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  const v = r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v * periodsPerYear) * 100;
}

/** Rolling RV series aligned to candle times (first `n` points empty). */
export function rollingRv(candles: { t: number; c: number }[], n: number, periodsPerYear: number): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = [];
  const rets: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const a = candles[i - 1].c, b = candles[i].c;
    rets.push(a > 0 && b > 0 ? Math.log(b / a) : 0);
    if (rets.length >= n) {
      const w = rets.slice(-n);
      const mean = w.reduce((s, x) => s + x, 0) / n;
      const v = w.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
      out.push({ t: candles[i].t, v: Math.sqrt(v * periodsPerYear) * 100 });
    }
  }
  return out;
}
