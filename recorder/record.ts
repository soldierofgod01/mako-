// ════════════════════════════════════════════════════════════════
// Mako flow recorder — runs on GitHub Actions, back to back, around the clock.
//
// Streams Hyperliquid trades + order book for a few coins, runs the EXACT
// engine and smoother the Terminal uses, and every minute writes to Supabase:
//   • flow_bias — raw + smoothed bias per horizon, with price (graded later)
//   • flow_bars — 1-minute aggressive buy/sell volume (history for re-tuning)
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
  latest: Record<string, { raw: number; score: number; direction: string; coverage: number; warming: boolean }>;
  bars: Map<number, Bar>;
}

const S = new Map<string, CoinState>(
  COINS.map((c) => [c, {
    coin: c, trades: [], book: [], lastImb: null, ctx: [], candles: [], vol24h: 0, cohort: null, cohortLoaded: false, sigFigs: null,
    smoothers: Object.fromEntries(HORIZONS.map((h) => [h.id, new BiasSmoother(SMOOTH[h.id])])),
    latest: {}, bars: new Map(),
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
      st.latest[h.id] = { raw: b.score, score: sm.score, direction: sm.direction, coverage: b.coverage, warming: b.warmingUp };
    }
  }
}

// ── Minute flush ─────────────────────────────────────────────────
let pendingBias: object[] = [];
let pendingBars: object[] = [];
let written = { bias: 0, bars: 0 };
// The minute recording started in is incomplete — never write its bar.
const START_MINUTE = Math.floor(Date.now() / 60_000) * 60_000;

async function flush(minuteStart: number) {
  const iso = new Date(minuteStart).toISOString();
  for (const st of S.values()) {
    const px = st.trades[st.trades.length - 1]?.px;
    if (px) {
      for (const h of HORIZONS) {
        const l = st.latest[h.id];
        // Only grade warmed-up reads with at least half the signals present.
        if (!l || l.warming || l.coverage < 0.5) continue;
        pendingBias.push({ t: iso, coin: st.coin, horizon: h.id, raw: l.raw, score: l.score, direction: l.direction, coverage: Math.round(l.coverage * 100) / 100, px });
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

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  const start = Date.now();
  log(`recording ${COINS.join(", ")} for ${RUN_MS / 60_000} min`);
  await pollCtx();
  await pollCandles();
  await pollCohorts();
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
  let lastMinute = Math.floor(Date.now() / 60_000) * 60_000;
  const minuteTimer = setInterval(async () => {
    const m = Math.floor(Date.now() / 60_000) * 60_000;
    if (m !== lastMinute) {
      const done = lastMinute;
      lastMinute = m;
      await flush(done);
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
