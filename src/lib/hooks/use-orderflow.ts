"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  H5,
  H15,
  H60,
  computeBias,
  type BiasResult,
  type BookSample,
  type Candle,
  type CtxSample,
  type Trade,
  whaleThreshold,
} from "@/lib/bias/engine";
import type { CoinCohorts } from "@/lib/cohorts/cohorts";
import { restore, saveMemory, saveStorage, type CvdPoint, type TapeState } from "@/lib/bias/persist";
import { candleDelta } from "@/lib/bias/chart-math";
import { BiasSmoother, SMOOTH, applySmoothing } from "@/lib/bias/smooth";
import type { HeatFrame } from "@/lib/bias/footprint";
import { LiveFeed, type LiveTrade } from "@/lib/bias/live-feed";
import { fromRecorder, RECORDER_MAX_AGE_MS, type RecorderRead } from "@/lib/bias/recorder-seed";

const HEAT_KEEP_MS = 45 * 60_000;

export type { CvdPoint };
/** Every candle interval Hyperliquid serves, in order. Keys are HL's own names
 *  ("1M" = month). Month and week lengths are nominal — anything that needs a
 *  bar's real end uses barEnd(). */
export const CHART_INTERVALS = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "8h": 28_800_000, "12h": 43_200_000,
  "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000, "1M": 2_592_000_000,
} as const;
export type ChartInterval = keyof typeof CHART_INTERVALS;
/** Display label: minutes/hours as-is, days/weeks/months upper-case like TradingView. */
export const INTERVAL_LABEL: Record<ChartInterval, string> = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "2h": "2h", "4h": "4h",
  "8h": "8h", "12h": "12h", "1d": "1D", "3d": "3D", "1w": "1W", "1M": "1M",
};
/** End (exclusive, epoch ms) of the bar that starts at t. Months vary in length. */
export function barEnd(t: number, iv: ChartInterval): number {
  if (iv === "1M") {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return t + CHART_INTERVALS[iv];
}
/** Which bias horizon matches a chart timeframe: ≤5m → 5m, 15m/30m → 15m, 1h and up → 1h. */
export function horizonForInterval(iv: ChartInterval): "5m" | "15m" | "1h" {
  return iv === "1m" || iv === "3m" || iv === "5m" ? "5m" : iv === "15m" || iv === "30m" ? "15m" : "1h";
}

export interface CohortsResponse {
  coin: string;
  updatedAt: number;
  tracked: { sharps: number; donors: number };
  data: CoinCohorts | null;
}

// ════════════════════════════════════════════════════════════════
// useOrderflow(coin) — live order flow for one Hyperliquid perp.
//
// One WebSocket, two subscriptions (trades + l2Book) for the chosen coin,
// plus /api/bias polled every 15s for OI / funding / candles. Buffers live
// in refs; the engine runs once a second and pushes one render.
//
// CRASH SAFETY: same contract as usePriceStream — any socket failure ends
// in a status flag, never a thrown error.
// ════════════════════════════════════════════════════════════════

const HL_WS_URL = "wss://api.hyperliquid.xyz/ws";
const TAPE_KEEP_MS = 65 * 60_000; // 1h horizon needs a full hour
const BOOK_KEEP_MS = 15 * 60_000;
const CTX_KEEP_MS = 90 * 60_000;
const CVD_BUCKET_MS = 5_000;
/** The order book column shows HL's finest aggregation (5 significant figures). */
const DISPLAY_SIG = 5;

/** HL aggregation tick for one level at `sig` significant figures. */
function levelTick(px: number, sig: number) {
  return Math.pow(10, Math.floor(Math.log10(px)) - sig + 1);
}
function onGrid(px: number, sig: number) {
  const r = px / levelTick(px, sig);
  return Math.abs(r - Math.round(r)) < 1e-6;
}

export interface BiasCtx {
  markPx: number;
  oraclePx: number;
  oi: number;
  oiUsd: number;
  fundingHourly: number;
  premium: number;
  volume24hUsd: number;
  change24hPct: number;
  maxLeverage: number;
}

interface BiasApiResponse {
  coin: string;
  t: number;
  ctx: BiasCtx;
  candles: Candle[];
}



export interface BookLevel {
  px: number;
  usd: number;
}

export interface OrderflowState {
  status: "connecting" | "live" | "error";
  bias: BiasResult | null;
  ctx: BiasCtx | null;
  lastPx: number | null;
  cvd: CvdPoint[];
  bigPrints: Trade[];
  allPrints: Trade[];
  whaleMin: number;
  book: { bids: BookLevel[]; asks: BookLevel[]; bandPct: number } | null;
  tradeCount: number;
  ctxError: boolean;
  cohorts: CohortsResponse | null;
  mtf: { "5m": BiasResult; "15m": BiasResult; "1h": BiasResult } | null;
  restored: { minutes: number; gapSec: number } | null;
  layers: { heat: HeatFrame[]; tape: Trade[]; tick: number } | null;
  chart: {
    /** Coin these candles belong to — guards against a stale coin after a switch. */
    coin: string;
    interval: ChartInterval;
    candles: Candle[];
    profile: Candle[];
    delta: { t: number; net: number; buy: number; sell: number }[];
    /** "recorded" = history from the 24/7 recorder + live tape; "live" = this tab's tape only. */
    deltaSource: "recorded" | "live";
  } | null;
}

async function fetchBiasCtx(coin: string): Promise<BiasApiResponse> {
  const res = await fetch(`/api/bias?coin=${encodeURIComponent(coin)}`);
  if (!res.ok) throw new Error("bias ctx failed");
  return res.json();
}

/** Pick the finest aggregation whose 20 levels still cover ≥ 0.2% of price. */
export function pickSigFigs(price: number): number {
  if (!(price > 0)) return 4;
  const mag = Math.floor(Math.log10(price));
  for (const n of [5, 4, 3]) {
    const tick = Math.pow(10, mag - n + 1);
    if ((20 * tick) / price >= 0.002) return n;
  }
  return 3;
}

const EMPTY: OrderflowState = {
  status: "connecting",
  bias: null,
  ctx: null,
  lastPx: null,
  cvd: [],
  bigPrints: [],
  allPrints: [],
  whaleMin: 25_000,
  book: null,
  tradeCount: 0,
  ctxError: false,
  cohorts: null,
  mtf: null,
  restored: null,
  layers: null,
  chart: null,
};

export function useOrderflow(coin: string, chartInterval: ChartInterval = "15m"): OrderflowState & { live: LiveFeed; loadOlder: () => void } {
  const [state, setState] = useState<OrderflowState>(EMPTY);
  const liveRef = useRef<LiveFeed | null>(null);
  if (!liveRef.current) liveRef.current = new LiveFeed();
  const live = liveRef.current;
  const lastDisplayBookRef = useRef(0);

  const tradesRef = useRef<Trade[]>([]);
  const bookRef = useRef<BookSample[]>([]);
  const lastBookRef = useRef<OrderflowState["book"]>(null);
  const lastImbRef = useRef<BookSample | null>(null);
  const ctxRef = useRef<CtxSample[]>([]);
  const candlesRef = useRef<Candle[]>([]);
  const cvdRef = useRef<CvdPoint[]>([]);
  const cvdTotalRef = useRef(0);
  const statusRef = useRef<OrderflowState["status"]>("connecting");
  const coinRef = useRef(coin);
  const sigFigsRef = useRef<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const restoredRef = useRef<OrderflowState["restored"]>(null);
  const dedupeRef = useRef<Set<string>>(new Set());
  const intervalRef = useRef<ChartInterval>(chartInterval);
  const chartCandlesRef = useRef<Candle[]>([]);
  const profileRef = useRef<Candle[]>([]);
  const heatRef = useRef<HeatFrame[]>([]);
  const flowHistRef = useRef<{ coin: string; interval: string; recorded: boolean; bars: Map<number, { buy: number; sell: number }> } | null>(null);
  const tickRef = useRef(0);
  const smoothersRef = useRef({ "5m": new BiasSmoother(SMOOTH["5m"]), "15m": new BiasSmoother(SMOOTH["15m"]), "1h": new BiasSmoother(SMOOTH["1h"]) });

  function snapshotTape(): TapeState {
    return {
      coin: coinRef.current,
      trades: tradesRef.current,
      book: bookRef.current,
      ctx: ctxRef.current,
      cvd: cvdRef.current,
      cvdTotal: cvdTotalRef.current,
      savedAt: Date.now(),
      heat: heatRef.current,
    };
  }

  // ── Slow context: OI / funding / candles ─────────────────────────
  const ctxQuery = useQuery({
    queryKey: ["bias-ctx", coin],
    queryFn: () => fetchBiasCtx(coin),
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const d = ctxQuery.data;
    if (!d || d.coin !== coinRef.current) return;
    const arr = ctxRef.current;
    if (!arr.length || arr[arr.length - 1].t !== d.t) {
      arr.push({ t: d.t, markPx: d.ctx.markPx, oi: d.ctx.oi, fundingHourly: d.ctx.fundingHourly });
      const cut = Date.now() - CTX_KEEP_MS;
      while (arr.length && arr[0].t < cut) arr.shift();
    }
    if (d.candles.length) candlesRef.current = d.candles.slice(-60);

    // First price for this coin → now we know how to aggregate the book.
    if (sigFigsRef.current === null && d.ctx.markPx > 0) {
      sigFigsRef.current = pickSigFigs(d.ctx.markPx);
      subscribeBook();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxQuery.data]);

  function send(msg: object) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
    }
  }

  // Coarser aggregation (10× wider ticks) for the heatmap: same 20 levels
  // per side, but they reach ~10× further from price.
  const heatSig = (fine: number) => Math.max(2, fine - 1);

  function subscribeBook() {
    if (sigFigsRef.current === null) return;
    send({
      method: "subscribe",
      subscription: { type: "l2Book", coin: coinRef.current, nSigFigs: sigFigsRef.current },
    });
    send({
      method: "subscribe",
      subscription: { type: "l2Book", coin: coinRef.current, nSigFigs: heatSig(sigFigsRef.current) },
    });
    if (sigFigsRef.current < DISPLAY_SIG) {
      send({ method: "subscribe", subscription: { type: "l2Book", coin: coinRef.current, nSigFigs: DISPLAY_SIG } });
    }
  }

  // ── Display book: REST poll every 300ms while visible ──────────
  // Measured Nov 2026: HL's WS l2Book pushes a snapshot only every ~10s,
  // while REST returns a fresh book on every call. Weight 2 per call →
  // ≤400/min of HL's 1200/min per-IP budget (fetch latency included), only while shown.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ctrl = new AbortController();
    const poll = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch("https://api.hyperliquid.xyz/info", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "l2Book", coin, nSigFigs: DISPLAY_SIG }),
            signal: ctrl.signal,
          });
          if (res.ok) {
            const d = (await res.json()) as { coin?: string; time?: number; levels?: { px: string; sz: string }[][] };
            if (!stop && d?.coin === coin && Array.isArray(d.levels) && d.levels[0]?.length && d.levels[1]?.length) {
              const toLive = (l: { px: string; sz: string }) => ({ px: parseFloat(l.px), sz: parseFloat(l.sz) });
              lastDisplayBookRef.current = Date.now();
              live.setBook({ t: d.time ?? Date.now(), bids: d.levels[0].map(toLive), asks: d.levels[1].map(toLive), sigFigs: DISPLAY_SIG });
            }
          }
        } catch { /* network blip or abort — WS book is the fallback */ }
      }
      if (!stop) timer = setTimeout(poll, 300);
    };
    poll();
    return () => {
      stop = true;
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [coin, live]);

  // ── Recorder seed: the 24/7 recorder's latest read (top 20 coins) ──
  // Shown while this tab's own tape warms up, so the bias is there instantly.
  const recQuery = useQuery({
    queryKey: ["flow-latest", coin],
    queryFn: async (): Promise<{ coin: string; reads: Partial<Record<"5m" | "15m" | "1h", RecorderRead>> }> => {
      const res = await fetch(`/api/flow/latest?coin=${encodeURIComponent(coin)}`);
      if (!res.ok) throw new Error("flow latest failed");
      return res.json();
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const recRef = useRef<typeof recQuery.data | null>(null);
  recRef.current = recQuery.data && recQuery.data.coin === coin ? recQuery.data : null;

  // ── Wallet cohorts: slow (server refreshes every 3 min) ──────────
  const cohortQuery = useQuery({
    queryKey: ["bias-cohorts", coin],
    queryFn: async (): Promise<CohortsResponse> => {
      const res = await fetch(`/api/cohorts?coin=${encodeURIComponent(coin)}`);
      if (!res.ok) throw new Error("cohorts failed");
      return res.json();
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const cohortRef = useRef<CohortsResponse | null>(null);
  cohortRef.current = cohortQuery.data && cohortQuery.data.coin === coin ? cohortQuery.data : null;

  // ── Reset buffers + (re)subscribe when the coin changes ──────────
  useEffect(() => {
    const prev = coinRef.current;
    const prevSig = sigFigsRef.current;
    if (prev !== coin) {
      send({ method: "unsubscribe", subscription: { type: "trades", coin: prev } });
      if (prevSig !== null) {
        send({ method: "unsubscribe", subscription: { type: "l2Book", coin: prev, nSigFigs: prevSig } });
        send({ method: "unsubscribe", subscription: { type: "l2Book", coin: prev, nSigFigs: heatSig(prevSig) } });
        if (prevSig < DISPLAY_SIG) send({ method: "unsubscribe", subscription: { type: "l2Book", coin: prev, nSigFigs: DISPLAY_SIG } });
      }
    }
    if (prev !== coin && tradesRef.current.length) {
      const snap = snapshotTape();
      saveMemory(snap);
      saveStorage(snap);
    }
    coinRef.current = coin;
    sigFigsRef.current = null;
    for (const sm of Object.values(smoothersRef.current)) sm.reset();
    lastBookRef.current = null;
    lastImbRef.current = null;
    lastDisplayBookRef.current = 0;
    live.reset();
    candlesRef.current = [];
    chartCandlesRef.current = [];
    profileRef.current = [];

    // Resume from saved tape if we have a recent one for this coin.
    const now = Date.now();
    const saved = restore(coin, now);
    if (saved) {
      const cut = now - TAPE_KEEP_MS;
      tradesRef.current = saved.trades.filter((t) => t.t >= cut);
      bookRef.current = saved.book.filter((b) => b.t >= now - BOOK_KEEP_MS);
      ctxRef.current = saved.ctx.filter((c) => c.t >= now - CTX_KEEP_MS);
      cvdRef.current = saved.cvd.filter((c) => c.time * 1000 >= cut);
      cvdTotalRef.current = saved.cvdTotal;
      heatRef.current = (saved.heat ?? []).filter((f) => f.t >= now - HEAT_KEEP_MS);
      const last = tradesRef.current[tradesRef.current.length - 1];
      const first = tradesRef.current[0];
      restoredRef.current = first && last
        ? { minutes: Math.round((last.t - first.t) / 60_000), gapSec: Math.round((now - last.t) / 1000) }
        : null;
      // HL replays recent trades on subscribe — don't double count them.
      dedupeRef.current = new Set(tradesRef.current.filter((t) => t.t >= now - 10 * 60_000).map((t) => `${t.t}|${t.px}|${t.sz}`));
    } else {
      tradesRef.current = [];
      bookRef.current = [];
      ctxRef.current = [];
      cvdRef.current = [];
      cvdTotalRef.current = 0;
      heatRef.current = [];
      restoredRef.current = null;
      dedupeRef.current = new Set();
    }
    setState({ ...EMPTY, status: statusRef.current });
    send({ method: "subscribe", subscription: { type: "trades", coin } });
    if (prev !== coin) send({ method: "unsubscribe", subscription: { type: "candle", coin: prev, interval: intervalRef.current } });
    send({ method: "subscribe", subscription: { type: "candle", coin, interval: intervalRef.current } });
    // Book subscribes once /api/bias tells us the price (see effect above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin]);

  // ── WebSocket lifecycle (once per mount) ─────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || typeof WebSocket === "undefined") {
      statusRef.current = "error";
      return;
    }
    let cancelled = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    function onTrades(data: unknown) {
      if (!Array.isArray(data)) return;
      const buf = tradesRef.current;
      const liveBatch: LiveTrade[] = [];
      for (const raw of data as { coin: string; side: string; px: string; sz: string; time: number }[]) {
        if (raw?.coin !== coinRef.current) continue;
        const px = parseFloat(raw.px);
        const sz = parseFloat(raw.sz);
        if (!(px > 0) || !(sz > 0)) continue;
        const side: 1 | -1 = raw.side === "B" ? 1 : -1;
        // The tape shows HL's replay of recent trades too, so it's full from the first second.
        liveBatch.push({ key: `${raw.time}|${px}|${sz}|${raw.side}`, t: raw.time, px, sz, usd: px * sz, side });
        const dk = dedupeRef.current;
        if (dk.size) {
          const k = `${raw.time}|${px}|${sz}`;
          if (dk.has(k)) continue;
        }
        const tr: Trade = { t: raw.time, px, sz, usd: px * sz, side };
        // Keep the tape time-ordered even if a batch arrives late.
        if (buf.length && tr.t < buf[buf.length - 1].t) {
          let i = buf.length - 1;
          while (i > 0 && buf[i - 1].t > tr.t) i--;
          buf.splice(i, 0, tr);
        } else {
          buf.push(tr);
        }
        cvdTotalRef.current += side * tr.usd;

        const bucketT = Math.floor(tr.t / CVD_BUCKET_MS) * CVD_BUCKET_MS;
        const cvd = cvdRef.current;
        const last = cvd[cvd.length - 1];
        const time = bucketT / 1000;
        if (last && last.time === time) {
          last.cvd = cvdTotalRef.current;
          last.px = px;
        } else if (!last || time > last.time) {
          cvd.push({ time, cvd: cvdTotalRef.current, px });
        }
      }
      if (liveBatch.length) live.pushTrades(liveBatch);
      const cut = Date.now() - TAPE_KEEP_MS;
      while (buf.length && buf[0].t < cut) buf.shift();
      const cvd = cvdRef.current;
      while (cvd.length && cvd[0].time * 1000 < cut) cvd.shift();
    }

    function onBook(data: unknown) {
      const d = data as { coin?: string; time?: number; levels?: { px: string; sz: string }[][] };
      if (!d || d.coin !== coinRef.current || !Array.isArray(d.levels) || d.levels.length < 2) return;
      const bidsRaw = d.levels[0] ?? [];
      const asksRaw = d.levels[1] ?? [];
      if (!bidsRaw.length || !asksRaw.length) return;
      const bestBid = parseFloat(bidsRaw[0].px);
      const bestAsk = parseFloat(asksRaw[0].px);
      const mid = (bestBid + bestAsk) / 2;
      if (!(mid > 0)) return;

      const fine = sigFigsRef.current;
      const toLive = (l: { px: string; sz: string }) => ({ px: parseFloat(l.px), sz: parseFloat(l.sz) });

      // Display book (5 sig figs) — the only subscription with levels off the
      // engine's grid. It feeds the order book column and nothing else.
      if (fine !== null && fine < DISPLAY_SIG) {
        const sample = [...bidsRaw.slice(0, 10), ...asksRaw.slice(0, 10)];
        if (sample.some((l) => !onGrid(parseFloat(l.px), fine))) {
          lastDisplayBookRef.current = Date.now();
          live.setBook({ t: d.time ?? Date.now(), bids: bidsRaw.map(toLive), asks: asksRaw.map(toLive), sigFigs: DISPLAY_SIG });
          return;
        }
      }

      // Two engine subscriptions share this channel; tell them apart by level spacing.
      if (fine !== null && bidsRaw.length > 1) {
        // Min gap between adjacent levels = the aggregation tick (gaps only make spacing bigger).
        let spacing = Infinity;
        for (let i = 1; i < bidsRaw.length; i++) {
          const g = Math.abs(parseFloat(bidsRaw[i - 1].px) - parseFloat(bidsRaw[i].px));
          if (g > 0) spacing = Math.min(spacing, g);
        }
        const fineTick = Math.pow(10, Math.floor(Math.log10(mid)) - fine + 1);
        if (spacing > fineTick * 3) {
          const t = d.time ?? Date.now();
          const frames = heatRef.current;
          if (!frames.length || t - frames[frames.length - 1].t >= 1000) {
            const lv: [number, number][] = [];
            for (const l of [...bidsRaw, ...asksRaw]) {
              const px = parseFloat(l.px);
              const usd = px * parseFloat(l.sz);
              if (px > 0 && usd > 0) lv.push([px, usd]);
            }
            frames.push({ t, tick: fineTick * 10, levels: lv, coarse: true });
            const cut = Date.now() - HEAT_KEEP_MS;
            while (frames.length && frames[0].t < cut) frames.shift();
          }
          return; // coarse book feeds the heatmap only
        }
      }

      // Engine book doubles as the display book until (or unless) the finer one arrives.
      if (fine !== null && Date.now() - lastDisplayBookRef.current > 3000) {
        live.setBook({ t: d.time ?? Date.now(), bids: bidsRaw.map(toLive), asks: asksRaw.map(toLive), sigFigs: fine });
      }

      const toLv = (l: { px: string; sz: string }) => {
        const px = parseFloat(l.px);
        return { px, usd: px * parseFloat(l.sz) };
      };
      const bids = bidsRaw.map(toLv);
      const asks = asksRaw.map(toLv);
      // Band = 0.5% or as deep as the 20 visible levels reach, whichever is tighter.
      const reachBid = (mid - bids[bids.length - 1].px) / mid;
      const reachAsk = (asks[asks.length - 1].px - mid) / mid;
      const band = Math.min(0.005, reachBid, reachAsk);
      const bidUsd = bids.filter((l) => (mid - l.px) / mid <= band).reduce((s, l) => s + l.usd, 0);
      const askUsd = asks.filter((l) => (l.px - mid) / mid <= band).reduce((s, l) => s + l.usd, 0);
      const tot = bidUsd + askUsd;
      lastBookRef.current = { bids: bids.slice(0, 12), asks: asks.slice(0, 12), bandPct: band * 100 };

      // Fine book also feeds the heatmap at full resolution near price.
      {
        const t = d.time ?? Date.now();
        const frames = heatRef.current;
        let lastFine = -Infinity;
        for (let i = frames.length - 1; i >= 0 && i >= frames.length - 6; i--) if (!frames[i].coarse) { lastFine = frames[i].t; break; }
        if (t - lastFine >= 1000 && fine !== null) {
          const lv: [number, number][] = [...bids, ...asks].filter((l) => l.usd > 0).map((l) => [l.px, l.usd]);
          frames.push({ t, tick: Math.pow(10, Math.floor(Math.log10(mid)) - fine + 1), levels: lv });
          const cut = Date.now() - HEAT_KEEP_MS;
          while (frames.length && frames[0].t < cut) frames.shift();
        }
      }
      if (tot <= 0) return;

      // Store the latest reading; the 1s engine tick samples it. HL pushes the
      // aggregated book only every few seconds, so sampling per-message would
      // under-count — time-based sampling gives a true time-weighted average.
      lastImbRef.current = { t: d.time ?? Date.now(), imbalance: (bidUsd - askUsd) / tot, bidUsd, askUsd };
    }

    function onCandle(d: { t: number; s: string; i: string; o: string; h: string; l: string; c: string; v: string }) {
      if (!d || d.s !== coinRef.current || d.i !== intervalRef.current) return;
      const k: Candle = { t: d.t, o: +d.o, h: +d.h, l: +d.l, c: +d.c, v: +d.v };
      const arr = chartCandlesRef.current;
      if (!arr.length) return; // wait for history first
      const last = arr[arr.length - 1];
      if (last.t === k.t) arr[arr.length - 1] = k;
      else if (k.t > last.t) arr.push(k);
    }

    function connect() {
      if (cancelled) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(HL_WS_URL);
      } catch {
        statusRef.current = "error";
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) { try { ws.close(); } catch { /* ignore */ } return; }
        attempt = 0;
        statusRef.current = "live";
        send({ method: "subscribe", subscription: { type: "trades", coin: coinRef.current } });
        send({ method: "subscribe", subscription: { type: "candle", coin: coinRef.current, interval: intervalRef.current } });
        subscribeBook();
        if (pingTimer) clearInterval(pingTimer);
        // HL drops sockets idle for 60s; quiet alts can go that long without a trade.
        pingTimer = setInterval(() => send({ method: "ping" }), 30_000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg?.channel === "trades") onTrades(msg.data);
          else if (msg?.channel === "l2Book") onBook(msg.data);
          else if (msg?.channel === "candle") onCandle(msg.data);
        } catch { /* ignore bad frame */ }
      };
      ws.onerror = () => { statusRef.current = "error"; };
      ws.onclose = () => {
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        if (cancelled) return;
        statusRef.current = "connecting";
        if (attempt >= 8) { statusRef.current = "error"; return; }
        const delay = Math.min(30_000, 1000 * 2 ** attempt);
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      const ws = wsRef.current;
      if (ws) { try { ws.onclose = null; ws.close(); } catch { /* ignore */ } }
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Chart candles: history from /api/candles, live via WS `candle` ──
  const candleQuery = useQuery({
    queryKey: ["chart-candles", coin, chartInterval],
    queryFn: async (): Promise<{ coin: string; interval: string; candles: Candle[]; profile: Candle[] }> => {
      // Straight from the browser first: HL rate-limits (429) Vercel's shared server
      // IPs, but each visitor has their own budget. The server route is the fallback.
      try {
        return await browserCandles(coin, chartInterval);
      } catch {
        const res = await fetch(`/api/candles?coin=${encodeURIComponent(coin)}&interval=${chartInterval}`);
        if (!res.ok) throw new Error("candles failed");
        return res.json();
      }
    },
    retry: 2,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    const d = candleQuery.data;
    if (!d || d.coin !== coinRef.current || d.interval !== intervalRef.current) return;
    // Keep any newer live candle the WS already gave us.
    const live = chartCandlesRef.current;
    const hist = d.candles.slice();
    const lastLive = live[live.length - 1];
    if (lastLive && hist.length && lastLive.t >= hist[hist.length - 1].t) {
      while (hist.length && hist[hist.length - 1].t >= lastLive.t) hist.pop();
      hist.push(...live.filter((c) => c.t > (hist[hist.length - 1]?.t ?? 0)));
    }
    // Keep older candles the user already scrolled back into (the refetch only covers the recent window).
    if (hist.length && live.length && live[0].t < hist[0].t) hist.unshift(...live.filter((c) => c.t < hist[0].t));
    chartCandlesRef.current = hist;
    profileRef.current = d.profile;
  }, [candleQuery.data]);

  // ── Older candles on demand (chart scrolled near its left edge) ──
  // HL only serves the most recent 5000 candles per interval; an empty page means we've hit that floor.
  const olderRef = useRef({ key: "", loading: false, done: false });
  const loadOlder = useCallback(() => {
    const c = coinRef.current, iv = intervalRef.current, key = `${c}|${iv}`;
    const arr = chartCandlesRef.current;
    if (!arr.length) return;
    const st = olderRef.current;
    if (st.key !== key) { st.key = key; st.loading = false; st.done = false; }
    if (st.loading || st.done) return;
    st.loading = true;
    const first = arr[0].t;
    hlCandles(c, iv, first - 1500 * CHART_INTERVALS[iv], first - 1)
      .then((older) => {
        if (coinRef.current !== c || intervalRef.current !== iv) return;
        const cur = chartCandlesRef.current;
        const firstNow = cur[0]?.t ?? Infinity;
        const add = older.filter((k) => k.t < firstNow);
        if (!add.length) st.done = true;
        else chartCandlesRef.current = [...add, ...cur];
      })
      .catch(() => { /* try again on the next scroll */ })
      .finally(() => { if (olderRef.current.key === key) olderRef.current.loading = false; });
  }, []);

  // ── Stored delta history from the 24/7 flow recorder ──
  const flowQuery = useQuery({
    queryKey: ["flow-history", coin, chartInterval],
    queryFn: async (): Promise<{ coin: string; interval: string; recorded: boolean; bars: [number, number, number][] }> => {
      const res = await fetch(`/api/flow/history?coin=${encodeURIComponent(coin)}&interval=${chartInterval}`);
      if (!res.ok) throw new Error("flow history failed");
      return res.json();
    },
    refetchInterval: 2 * 60_000,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    const d = flowQuery.data;
    if (!d) return;
    flowHistRef.current = {
      coin: d.coin,
      interval: d.interval,
      recorded: d.recorded && d.bars.length > 0,
      bars: new Map(d.bars.map(([t, buy, sell]) => [t, { buy, sell }])),
    };
  }, [flowQuery.data]);

  // Switch candle subscription when the chart interval changes.
  useEffect(() => {
    const prev = intervalRef.current;
    if (prev === chartInterval) return;
    send({ method: "unsubscribe", subscription: { type: "candle", coin: coinRef.current, interval: prev } });
    intervalRef.current = chartInterval;
    chartCandlesRef.current = [];
    send({ method: "subscribe", subscription: { type: "candle", coin: coinRef.current, interval: chartInterval } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartInterval]);

  // ── Persist the tape: every 15s, when hidden, and on unmount ────────
  useEffect(() => {
    const save = (toDisk: boolean) => {
      if (!tradesRef.current.length) return;
      const snap = snapshotTape();
      saveMemory(snap);
      if (toDisk) saveStorage(snap);
    };
    const id = setInterval(() => save(true), 15_000);
    const onHide = () => { if (document.visibilityState === "hidden") save(true); };
    const onPageHide = () => save(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      save(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Engine tick: once per second ─────────────────────────────────
  const ctxData = ctxQuery.data && ctxQuery.data.coin === coin ? ctxQuery.data.ctx : null;
  const ctxError = ctxQuery.isError;
  const ctxDataRef = useRef(ctxData);
  ctxDataRef.current = ctxData;
  const ctxErrorRef = useRef(ctxError);
  ctxErrorRef.current = ctxError;

  useEffect(() => {
    const id = setInterval(() => {
      try {
        const now = Date.now();
        // Sample the latest book reading once per second (skip if stale > 15s).
        const imb = lastImbRef.current;
        if (imb && now - imb.t < 15_000) {
          const samples = bookRef.current;
          samples.push({ ...imb, t: now });
          const cut = now - BOOK_KEEP_MS;
          while (samples.length && samples[0].t < cut) samples.shift();
        }
        const trades = tradesRef.current;
        const ctx = ctxDataRef.current;
        const vol = ctx?.volume24hUsd ?? 0;
        const input = {
          trades,
          book: bookRef.current,
          ctx: ctxRef.current,
          candles: candlesRef.current,
          volume24hUsd: vol,
          now,
          cohort: cohortRef.current?.data ?? null,
          cohortLoaded: cohortRef.current !== null,
        };
        // Raw engine reads → smoothed, hysteresis-held reads (what the user sees).
        const sm = smoothersRef.current;
        const raw = { "5m": computeBias(input, H5), "15m": computeBias(input, H15), "1h": computeBias(input, H60) };
        // While a horizon is still warming up, show the recorder's read (if it
        // has this coin) and feed its score into the smoother, so the hand-off
        // to this tab's own read is continuous instead of a jump.
        const rec = recRef.current?.reads ?? {};
        const read = (id: "5m" | "15m" | "1h"): BiasResult => {
          const r = raw[id];
          const seed = rec[id];
          if (r.warmingUp && seed && now - seed.t < RECORDER_MAX_AGE_MS) {
            sm[id].update(seed.score, now);
            return fromRecorder(r, seed, now);
          }
          return applySmoothing(r, sm[id].update(r.score, now));
        };
        const mtf = { "5m": read("5m"), "15m": read("15m"), "1h": read("1h") };
        // Headline lean follows the chart timeframe.
        const bias = mtf[horizonForInterval(intervalRef.current)];

        const iv = intervalRef.current;
        const ivMs = CHART_INTERVALS[iv];
        const chartCandles = chartCandlesRef.current;
        const deltaMap = candleDelta(trades, ivMs);
        // Stored candles before the first one this tab saw in full; live tape after.
        const hist = flowHistRef.current;
        const useHist = !!hist && hist.recorded && hist.coin === coinRef.current && hist.interval === iv;
        const liveStart = trades.length ? Math.ceil(trades[0].t / ivMs) * ivMs : Infinity;
        const merged = new Map<number, { buy: number; sell: number }>();
        // Recorded buckets fill anything the tab didn't see (incl. gaps in a restored tape).
        if (useHist) for (const [t, f] of hist.bars) if (t < liveStart || !deltaMap.has(t)) merged.set(t, f);
        for (const [t, d] of deltaMap) if (!useHist || t >= liveStart || !merged.has(t)) merged.set(t, { buy: d.buy, sell: d.sell });
        const delta = [...merged.entries()].map(([t, f]) => ({ t, net: f.buy - f.sell, buy: f.buy, sell: f.sell })).sort((a, b) => a.t - b.t);
        const lastPx = trades.length ? trades[trades.length - 1].px : ctx?.markPx ?? null;
        const whaleMin = whaleThreshold(vol);

        setState({
          status: statusRef.current,
          bias,
          ctx,
          lastPx,
          cvd: cvdRef.current.slice(),
          ...(() => {
            // HL splits one taker order into many fills (same ms, same side, walking
            // the book). Re-assemble them so a $500k market order reads as one print.
            const orders: Trade[] = [];
            for (const t of trades) {
              const last = orders[orders.length - 1];
              if (last && last.t === t.t && last.side === t.side) {
                const usd = last.usd + t.usd, sz = last.sz + t.sz;
                orders[orders.length - 1] = { t: t.t, side: t.side, usd, sz, px: usd / sz };
              } else orders.push({ ...t });
            }
            const big = orders.filter((t) => t.usd >= whaleMin);
            return { bigPrints: big.slice(-25).reverse(), allPrints: big.slice(-400) };
          })(),
          whaleMin,
          book: lastBookRef.current,
          tradeCount: trades.length,
          ctxError: ctxErrorRef.current,
          cohorts: cohortRef.current,
          mtf,
          restored: restoredRef.current,
          layers: { heat: heatRef.current, tape: trades, tick: ++tickRef.current },
          chart: chartCandles.length
            ? { coin: coinRef.current, interval: iv, candles: chartCandles.slice(), profile: profileRef.current, delta, deltaSource: useHist ? "recorded" : "live" }
            : null,
        });
      } catch {
        /* never let the engine take the page down */
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return { ...state, live, loadOlder };
}

/** One candleSnapshot page straight from Hyperliquid (max 5000 candles per call). */
export async function hlCandles(coin: string, iv: string, startTime: number, endTime: number): Promise<Candle[]> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval: iv, startTime, endTime } }),
  });
  if (!res.ok) throw new Error(`HL ${res.status}`);
  const raw = (await res.json()) as { t: number; o: string; h: string; l: string; c: string; v: string }[];
  return (Array.isArray(raw) ? raw : []).map((k) => ({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }));
}

/** Initial chart window: the last 1000 bars (and at least back to the UTC day start), plus today's 1m candles. */
export const INITIAL_BARS = 1000;
async function browserCandles(coin: string, interval: ChartInterval) {
  const now = Date.now();
  const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
  const start = Math.min(dayStart, now - INITIAL_BARS * CHART_INTERVALS[interval]);
  const [candles, profile] = await Promise.all([hlCandles(coin, interval, start, now), hlCandles(coin, "1m", dayStart, now)]);
  if (!candles.length) throw new Error("no candles");
  return { coin, interval, candles, profile };
}
