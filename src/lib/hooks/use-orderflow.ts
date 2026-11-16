"use client";
import { useEffect, useRef, useState } from "react";
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
import { tickLog, logStats, type LogStats } from "@/lib/bias/log";
import type { CoinCohorts } from "@/lib/cohorts/cohorts";
import { restore, saveMemory, saveStorage, type CvdPoint, type TapeState } from "@/lib/bias/persist";
import { candleDelta } from "@/lib/bias/chart-math";

export type { CvdPoint };
export const CHART_INTERVALS = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000 } as const;
export type ChartInterval = keyof typeof CHART_INTERVALS;

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
  logStats: LogStats | null;
  ctxError: boolean;
  cohorts: CohortsResponse | null;
  mtf: { "5m": BiasResult; "15m": BiasResult; "1h": BiasResult } | null;
  restored: { minutes: number; gapSec: number } | null;
  chart: {
    interval: ChartInterval;
    candles: Candle[];
    profile: Candle[];
    delta: { t: number; net: number }[];
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
  logStats: null,
  ctxError: false,
  cohorts: null,
  mtf: null,
  restored: null,
  chart: null,
};

export function useOrderflow(coin: string, chartInterval: ChartInterval = "15m"): OrderflowState {
  const [state, setState] = useState<OrderflowState>(EMPTY);

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

  function snapshotTape(): TapeState {
    return {
      coin: coinRef.current,
      trades: tradesRef.current,
      book: bookRef.current,
      ctx: ctxRef.current,
      cvd: cvdRef.current,
      cvdTotal: cvdTotalRef.current,
      savedAt: Date.now(),
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

  function subscribeBook() {
    if (sigFigsRef.current === null) return;
    send({
      method: "subscribe",
      subscription: { type: "l2Book", coin: coinRef.current, nSigFigs: sigFigsRef.current },
    });
  }

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
      }
    }
    if (prev !== coin && tradesRef.current.length) {
      const snap = snapshotTape();
      saveMemory(snap);
      saveStorage(snap);
    }
    coinRef.current = coin;
    sigFigsRef.current = null;
    lastBookRef.current = null;
    lastImbRef.current = null;
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
      for (const raw of data as { coin: string; side: string; px: string; sz: string; time: number }[]) {
        if (raw?.coin !== coinRef.current) continue;
        const px = parseFloat(raw.px);
        const sz = parseFloat(raw.sz);
        if (!(px > 0) || !(sz > 0)) continue;
        const side: 1 | -1 = raw.side === "B" ? 1 : -1;
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
      const res = await fetch(`/api/candles?coin=${encodeURIComponent(coin)}&interval=${chartInterval}`);
      if (!res.ok) throw new Error("candles failed");
      return res.json();
    },
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
    chartCandlesRef.current = hist;
    profileRef.current = d.profile;
  }, [candleQuery.data]);

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
        const bias = computeBias(input, H15);
        const mtf = { "5m": computeBias(input, H5), "15m": bias, "1h": computeBias(input, H60) };

        const iv = intervalRef.current;
        const ivMs = CHART_INTERVALS[iv];
        const chartCandles = chartCandlesRef.current;
        const deltaMap = candleDelta(trades, ivMs);
        const delta = [...deltaMap.entries()].map(([t, d]) => ({ t, net: d.net })).sort((a, b) => a.t - b.t);
        const lastPx = trades.length ? trades[trades.length - 1].px : ctx?.markPx ?? null;
        const whaleMin = whaleThreshold(vol);

        let stats: LogStats | null = null;
        if (!bias.warmingUp && lastPx && typeof window !== "undefined") {
          const log = tickLog(coinRef.current, bias.score, lastPx, now);
          stats = logStats(log, coinRef.current);
        }

        setState({
          status: statusRef.current,
          bias,
          ctx,
          lastPx,
          cvd: cvdRef.current.slice(),
          ...(() => {
            const big = trades.filter((t) => t.usd >= whaleMin);
            return { bigPrints: big.slice(-25).reverse(), allPrints: big.slice(-400) };
          })(),
          whaleMin,
          book: lastBookRef.current,
          tradeCount: trades.length,
          logStats: stats,
          ctxError: ctxErrorRef.current,
          cohorts: cohortRef.current,
          mtf,
          restored: restoredRef.current,
          chart: chartCandles.length
            ? { interval: iv, candles: chartCandles.slice(), profile: profileRef.current, delta }
            : null,
        });
      } catch {
        /* never let the engine take the page down */
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return state;
}
