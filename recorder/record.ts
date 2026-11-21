// ════════════════════════════════════════════════════════════════
// Mako flow recorder — runs on GitHub Actions, back to back, around the clock.
//
// Streams Hyperliquid trades + order book for a few coins, runs the EXACT
// engine and smoother the Terminal uses, and every minute writes to Supabase:
//   • flow_bias — raw + smoothed bias per horizon, with price (graded later)
//   • flow_bars — 1-minute aggressive buy/sell volume (history for re-tuning)
// Each flow_bias row also carries every signal's own score (`sig`) and the
// book mid, so we can measure which inputs actually predict price.
// Range regime (bias v2): one row per closed bar under horizon "rg1h"/"rg4h",
// t = bar close; raw = P(break)×100, score = vol percentile×100,
// direction = state, px = close, sig = {hi, lo, er: expected range %}.
//
// Continuity: RUN_MODE decides how a run starts.
//   • "handoff"  — dispatched by the previous run ~25 min before it ends. The
//                  runs overlap; this one holds back bias rows until the old
//                  one has finished (bars dedupe on (coin, t)).
//   • "schedule" — hourly backup. Exits at once if a recorder is already
//                  writing, so it only ever fills a real gap.
//   • "force"    — manual dispatch: always records.
// Usage:  TRACK_TOKEN=… npx tsx recorder/record.ts
// ════════════════════════════════════════════════════════════════

import {
  computeBias,
  H5,
  H15,
  H60,

  type BookSample,
  type Candle,
  type CtxSample,
  type Horizon,
  type Trade,
} from "../src/lib/bias/engine";
import { BiasSmoother, SMOOTH } from "../src/lib/bias/smooth";
import { barsNeeded, computeRegime, REGIMES } from "../src/lib/bias/regime";
import { supabaseRpc } from "../src/lib/track/supabase";
import type { CoinCohorts } from "../src/lib/cohorts/cohorts";

const HL_INFO = process.env.HL_INFO_URL ?? "https://api.hyperliquid.xyz/info";
const HL_WS = process.env.HL_WS_URL ?? "wss://api.hyperliquid.xyz/ws";
const DRY_RUN = process.env.FLOW_DRY_RUN === "1"; // log instead of writing (local testing)
const MAKO = process.env.MAKO_URL ?? "https://mako-seven.vercel.app";
const COINS = (process.env.COINS ?? "BTC,ETH,SOL,HYPE").split(",").map((s) => s.trim()).filter(Boolean);
const RUN_MS = Number(process.env.RUN_MINUTES ?? 340) * 60_000;
const TOKEN = process.env.TRACK_TOKEN ?? "";
const TAPE_KEEP = 65 * 60_000;
const RUN_MODE = (process.env.RUN_MODE ?? "force") as "handoff" | "schedule" | "force";
const HANDOFF_BEFORE_END_MS = 25 * 60_000;
// In a handoff, the previous run is still writing for up to 25 min. Hold back
// bias rows a little longer so the two runs' smoothers never interleave.
const HOLD_BIAS_MS = RUN_MODE === "handoff" ? 27 * 60_000 : 0;
const GH_TOKEN = process.env.GITHUB_TOKEN ?? "";
const GH_REPO = process.env.GITHUB_REPOSITORY ?? "";
const WORKFLOW_FILE = "flow-recorder.yml";
const SIG_KEYS: Record<string, string> = { delta: "d", absorption: "a", oi: "o", whales: "w", book: "b", crowding: "f", cohort: "c" };
const HORIZONS: Horizon[] = [H5, H15, H60];

if (!TOKEN) {
  // Exit cleanly (no failure emails) until the repo secret is added.
  console.warn("TRACK_TOKEN secret not set — add it under Settings → Secrets and variables → Actions. Skipping.");
  process.exit(0);
}

interface Bar { buy: number; sell: number; n: number; o: number; h: number; l: number; c: number }
interface CoinState {
  coin: string;
  trades: Trade[];
  book: BookSample[];
  lastImb: BookSample | null;
  ctx: CtxSample[];
  candles: Candle[];
  vol24h: number;
  cohort: CoinCohorts | null;
  cohortLoaded: boolean;
  sigFigs: number | null;
  smoothers: Record<string, BiasSmoother>;
  latest: Record<string, { raw: number; score: number; direction: string; coverage: number; warming: boolean; sig: Record<string, number | null> }>;
  regimeAsOf: Record<string, number>;
  mid: number | null;
  bars: Map<number, Bar>;
}

const S = new Map<string, CoinState>(
  COINS.map((c) => [c, {
    coin: c, trades: [], book: [], lastImb: null, ctx: [], candles: [], vol24h: 0, cohort: null, cohortLoaded: false, sigFigs: null,
    smoothers: Object.fromEntries(HORIZONS.map((h) => [h.id, new BiasSmoother(SMOOTH[h.id])])),
    latest: {}, regimeAsOf: {}, bars: new Map(), mid: null,
  }])
);

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function info<T>(body: object): Promise<T> {
  const r = await fetch(HL_INFO, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HL ${r.status}`);
  return r.json() as Promise<T>;
}

function pickSigFigs(price: number): number {
  const mag = Math.floor(Math.log10(price));
  for (const n of [5, 4, 3]) if ((20 * Math.pow(10, mag - n + 1)) / price >= 0.002) return n;
  return 3;
}

// ── WebSocket ────────────────────────────────────────────────────
let ws: WebSocket | null = null;
let wsOpen = false;
const send = (m: object) => { if (ws && wsOpen) try { ws.send(JSON.stringify(m)); } catch { /* ignore */ } };

function subscribeAll() {
  for (const st of S.values()) {
    send({ method: "subscribe", subscription: { type: "trades", coin: st.coin } });
    if (st.sigFigs !== null) send({ method: "subscribe", subscription: { type: "l2Book", coin: st.coin, nSigFigs: st.sigFigs } });
  }
}

function onTrades(data: { coin: string; side: string; px: string; sz: string; time: number }[]) {
  for (const raw of data) {
    const st = S.get(raw.coin);
    if (!st) continue;
    const px = +raw.px, sz = +raw.sz;
    if (!(px > 0) || !(sz > 0)) continue;
    const side: 1 | -1 = raw.side === "B" ? 1 : -1;
    const tr: Trade = { t: raw.time, px, sz, usd: px * sz, side };
    const last = st.trades[st.trades.length - 1];
    if (last && tr.t < last.t) {
      let i = st.trades.length - 1;
      while (i > 0 && st.trades[i - 1].t > tr.t) i--;
      st.trades.splice(i, 0, tr);
    } else st.trades.push(tr);
    // 1-minute bar
    const m = Math.floor(tr.t / 60_000) * 60_000;
    const b = st.bars.get(m) ?? { buy: 0, sell: 0, n: 0, o: px, h: px, l: px, c: px };
    if (side === 1) b.buy += tr.usd; else b.sell += tr.usd;
    b.n++; b.h = Math.max(b.h, px); b.l = Math.min(b.l, px); b.c = px;
    st.bars.set(m, b);
  }
}

function onBook(d: { coin: string; time?: number; levels: { px: string; sz: string }[][] }) {
  const st = S.get(d.coin);
  if (!st || !Array.isArray(d.levels) || d.levels.length < 2) return;
  const bids = d.levels[0].map((l) => ({ px: +l.px, usd: +l.px * +l.sz }));
  const asks = d.levels[1].map((l) => ({ px: +l.px, usd: +l.px * +l.sz }));
  if (!bids.length || !asks.length) return;
  const mid = (bids[0].px + asks[0].px) / 2;
  if (!(mid > 0)) return;
  st.mid = mid;
  // Same band logic as the Terminal: 0.5% or as deep as the 20 levels reach.
  const band = Math.min(0.005, (mid - bids[bids.length - 1].px) / mid, (asks[asks.length - 1].px - mid) / mid);
  const bidUsd = bids.filter((l) => (mid - l.px) / mid <= band).reduce((s, l) => s + l.usd, 0);
  const askUsd = asks.filter((l) => (l.px - mid) / mid <= band).reduce((s, l) => s + l.usd, 0);
  if (bidUsd + askUsd <= 0) return;
  st.lastImb = { t: d.time ?? Date.now(), imbalance: (bidUsd - askUsd) / (bidUsd + askUsd), bidUsd, askUsd };
}

function connect(attempt = 0) {
  ws = new WebSocket(HL_WS);
  ws.onopen = () => { wsOpen = true; log("ws open"); subscribeAll(); };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.channel === "trades") onTrades(msg.data);
      else if (msg.channel === "l2Book") onBook(msg.data);
    } catch { /* ignore */ }
  };
  ws.onclose = () => {
    wsOpen = false;
    const delay = Math.min(30_000, 1000 * 2 ** attempt);
    log(`ws closed, reconnecting in ${delay}ms`);
    setTimeout(() => connect(Math.min(attempt + 1, 6)), delay);
  };
  ws.onerror = () => { /* onclose handles it */ };
}

// ── REST pollers ─────────────────────────────────────────────────
async function pollCtx() {
  try {
    const [meta, ctxs] = await info<[{ universe: { name: string }[] }, { markPx: string; openInterest: string; funding: string; dayNtlVlm: string }[]]>({ type: "metaAndAssetCtxs" });
    const now = Date.now();
    meta.universe.forEach((a, i) => {
      const st = S.get(a.name);
      const c = ctxs[i];
      if (!st || !c) return;
      const markPx = +c.markPx;
      st.ctx.push({ t: now, markPx, oi: +c.openInterest, fundingHourly: +c.funding });
      while (st.ctx.length && st.ctx[0].t < now - 90 * 60_000) st.ctx.shift();
      st.vol24h = +c.dayNtlVlm;
      if (st.sigFigs === null && markPx > 0) {
        st.sigFigs = pickSigFigs(markPx);
        send({ method: "subscribe", subscription: { type: "l2Book", coin: st.coin, nSigFigs: st.sigFigs } });
      }
    });
  } catch (e) { log("ctx poll failed", String(e)); }
}

async function pollCandles() {
  const now = Date.now();
  for (const st of S.values()) {
    try {
      const raw = await info<{ t: number; o: string; h: string; l: string; c: string; v: string }[]>({
        type: "candleSnapshot", req: { coin: st.coin, interval: "1m", startTime: now - 70 * 60_000, endTime: now },
      });
      st.candles = raw.map((k) => ({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v })).slice(-60);
    } catch (e) { log("candles failed", st.coin, String(e)); }
  }
}

// ── Range regime (every 5 min, just after the bar close) ─────────
// Full history once per coin (spread out), then only the newest bars, so
// 20 coins stay well inside HL's request-weight limit.
const pendingRegime: object[] = [];
type RC = { t: number; o: number; h: number; l: number; c: number };
const regimeCandles = new Map<string, RC[]>();
let regimeBusy = false;
async function pollRegime() {
  if (regimeBusy) return;
  regimeBusy = true;
  try {
    for (const st of S.values()) {
      for (const cfg of REGIMES) {
        const key = `${st.coin}:${cfg.id}`;
        const have = regimeCandles.get(key) ?? [];
        const need = barsNeeded(cfg) + 20;
        const now = Date.now();
        const full = have.length < need - 25;
        try {
          const startTime = full ? now - need * cfg.barMs : have[have.length - 1].t;
          const raw = await info<{ t: number; o: string; h: string; l: string; c: string }[]>({
            type: "candleSnapshot", req: { coin: st.coin, interval: cfg.interval, startTime, endTime: now },
          });
          const fresh = raw.map((k) => ({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c }));
          const merged = full ? fresh : [...have.filter((k) => k.t < (fresh[0]?.t ?? Infinity)), ...fresh];
          const kept = merged.slice(-need);
          regimeCandles.set(key, kept);
          const rd = computeRegime(kept, cfg, Date.now());
          if (rd && !rd.thin && st.regimeAsOf[cfg.id] !== rd.asOf) {
            st.regimeAsOf[cfg.id] = rd.asOf;
            pendingRegime.push({
              t: new Date(rd.asOf).toISOString(), coin: st.coin, horizon: `rg${cfg.id}`,
              raw: Math.round(rd.pBreak * 100), score: Math.round(rd.pct * 100), direction: rd.state,
              coverage: 1, px: rd.lastClose, mid: null,
              sig: { hi: rd.rangeHi, lo: rd.rangeLo, er: Math.round(rd.expRangePct * 1000) / 1000 },
            });
          }
        } catch (e) { log("regime failed", key, String(e).slice(0, 80)); }
        await new Promise((r) => setTimeout(r, full ? 4_000 : 250));
      }
    }
  } finally { regimeBusy = false; }
}

async function pollCohorts() {
  for (const st of S.values()) {
    try {
      const r = await fetch(`${MAKO}/api/cohorts?coin=${st.coin}`);
      if (r.ok) {
        const j = (await r.json()) as { data: CoinCohorts | null };
        st.cohort = j.data;
        st.cohortLoaded = true;
      }
    } catch { /* keep last */ }
  }
}

// ── Engine tick (every 5s) ───────────────────────────────────────
function tick() {
  const now = Date.now();
  for (const st of S.values()) {
    while (st.trades.length && st.trades[0].t < now - TAPE_KEEP) st.trades.shift();
    if (st.lastImb && now - st.lastImb.t < 15_000) {
      st.book.push({ ...st.lastImb, t: now });
      while (st.book.length && st.book[0].t < now - 15 * 60_000) st.book.shift();
    }
    const input = { trades: st.trades, book: st.book, ctx: st.ctx, candles: st.candles, volume24hUsd: st.vol24h, now, cohort: st.cohort, cohortLoaded: st.cohortLoaded };
    for (const h of HORIZONS) {
      const b = computeBias(input, h);
      const sm = st.smoothers[h.id].update(b.score, now);
      // Per-signal scores, BEFORE the absorption discount (null = no data).
      const sig: Record<string, number | null> = {};
      for (const s of b.signals) sig[SIG_KEYS[s.id] ?? s.id] = s.available ? Math.round((s.pre ?? s.score) * 100) / 100 : null;
      st.latest[h.id] = { raw: b.score, score: sm.score, direction: sm.direction, coverage: b.coverage, warming: b.warmingUp, sig };
    }
  }
}

// ── Minute flush ─────────────────────────────────────────────────
let pendingBias: object[] = [];
let pendingBars: object[] = [];
let written = { bias: 0, bars: 0 };
// The minute recording started in is incomplete — never write its bar.
const START_MINUTE = Math.floor(Date.now() / 60_000) * 60_000;

const STARTED_AT = Date.now();

async function flush(minuteStart: number) {
  const iso = new Date(minuteStart).toISOString();
  const holdBias = Date.now() - STARTED_AT < HOLD_BIAS_MS;
  // Regime rows dedupe on (coin, horizon, t), so overlapping runs are harmless.
  if (pendingRegime.length) pendingBias.push(...pendingRegime.splice(0));
  for (const st of S.values()) {
    const px = st.trades[st.trades.length - 1]?.px;
    if (px && !holdBias) {
      for (const h of HORIZONS) {
        const l = st.latest[h.id];
        // Only grade warmed-up reads with at least half the signals present.
        if (!l || l.warming || l.coverage < 0.5) continue;
        pendingBias.push({ t: iso, coin: st.coin, horizon: h.id, raw: l.raw, score: l.score, direction: l.direction, coverage: Math.round(l.coverage * 100) / 100, px, mid: st.mid, sig: l.sig });
      }
    }
    // Completed bars only (minutes strictly before the current one).
    for (const [m, b] of st.bars) {
      if (m >= minuteStart + 60_000) continue;
      if (m <= START_MINUTE) { st.bars.delete(m); continue; }
      pendingBars.push({ t: new Date(m).toISOString(), coin: st.coin, buy: Math.round(b.buy), sell: Math.round(b.sell), n: b.n, o: b.o, h: b.h, l: b.l, c: b.c });
      st.bars.delete(m);
    }
  }
  if (!pendingBias.length && !pendingBars.length) return;
  try {
    const r = DRY_RUN
      ? (log("DRY", JSON.stringify(pendingBias.slice(0, 3)), `bias=${pendingBias.length} bars=${pendingBars.length}`), { bias: pendingBias.length, bars: pendingBars.length })
      : await supabaseRpc<{ bias: number; bars: number }>("flow_ingest", { p_token: TOKEN, p_bias: pendingBias, p_bars: pendingBars });
    written = { bias: written.bias + r.bias, bars: written.bars + r.bars };
    pendingBias = [];
    pendingBars = [];
  } catch (e) {
    log("flush failed (will retry)", String(e).slice(0, 160));
    // Bound memory if Supabase is down for a long time.
    if (pendingBias.length > 20_000) pendingBias = pendingBias.slice(-20_000);
    if (pendingBars.length > 20_000) pendingBars = pendingBars.slice(-20_000);
  }
}

// ── Continuity ───────────────────────────────────────────────────
/** Seconds since the newest recorded bar (any run), or null if unknown. */
async function heartbeatAge(): Promise<number | null> {
  try {
    const r = await supabaseRpc<{ age_s: number | null }>("flow_heartbeat", {});
    return r.age_s;
  } catch (e) {
    log("heartbeat check failed", String(e).slice(0, 120));
    return null;
  }
}

/** Start the next run (it overlaps this one, then takes over). Retries a few times. */
async function dispatchNext(): Promise<boolean> {
  if (!GH_TOKEN || !GH_REPO) { log("no GITHUB_TOKEN/REPOSITORY — can't hand off"); return false; }
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
        method: "POST",
        headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        body: JSON.stringify({ ref: process.env.GITHUB_REF_NAME ?? "main", inputs: { mode: "handoff" } }),
      });
      if (r.status === 204) { log("handoff: next run dispatched"); return true; }
      log(`handoff dispatch HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
    } catch (e) { log("handoff dispatch failed", String(e).slice(0, 120)); }
    await new Promise((res) => setTimeout(res, 15_000 * (i + 1)));
  }
  return false;
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  const start = Date.now();
  if (RUN_MODE === "schedule") {
    const age = await heartbeatAge();
    if (age !== null && age < 180) {
      log(`another recorder is live (last bar ${age}s ago) — backup run not needed, exiting`);
      process.exit(0);
    }
    log(`backup run taking over (last bar ${age ?? "unknown"}s ago)`);
  }
  log(`recording ${COINS.join(", ")} for ${RUN_MS / 60_000} min (mode=${RUN_MODE})`);
  await pollCtx();
  await pollCandles();
  await pollCohorts();
  void pollRegime();
  connect();
  const timers = [
    setInterval(pollCtx, 15_000),
    setInterval(pollCandles, 5 * 60_000),
    setInterval(pollCohorts, 3 * 60_000),
    setInterval(tick, 5_000),
    setInterval(() => send({ method: "ping" }), 30_000),
    setInterval(() => {
      const parts = [...S.values()].map((s) => `${s.coin}:${s.trades.length}t ${s.latest["15m"]?.direction ?? "-"}(${s.latest["15m"]?.score ?? "-"})`);
      log(`written bias=${written.bias} bars=${written.bars} | ${parts.join(" ")}`);
    }, 10 * 60_000),
  ];
  const scheduleRegime = () => {
    const wait = 300_000 - (Date.now() % 300_000) + 8_000;
    timers.push(setTimeout(() => { void pollRegime(); scheduleRegime(); }, wait) as unknown as ReturnType<typeof setInterval>);
  };
  scheduleRegime();
  let handedOff = false;
  let lastMinute = Math.floor(Date.now() / 60_000) * 60_000;
  const minuteTimer = setInterval(async () => {
    const m = Math.floor(Date.now() / 60_000) * 60_000;
    if (m !== lastMinute) {
      const done = lastMinute;
      lastMinute = m;
      await flush(done);
    }
    // Short test runs (RUN_MINUTES < 60) never hand off.
    if (!handedOff && RUN_MS >= 60 * 60_000 && Date.now() - start > RUN_MS - HANDOFF_BEFORE_END_MS) {
      handedOff = true;
      void dispatchNext();
    }
    if (Date.now() - start > RUN_MS) {
      log("run time reached — final flush and exit");
      clearInterval(minuteTimer);
      timers.forEach(clearInterval);
      // Flush only completed minutes; the in-progress one belongs to the next run.
      await flush(lastMinute - 60_000);
      try { ws?.close(); } catch { /* ignore */ }
      log(`done: bias=${written.bias} bars=${written.bars}`);
      process.exit(0);
    }
  }, 1000);
}

main().catch((e) => { console.error(e); process.exit(1); });
