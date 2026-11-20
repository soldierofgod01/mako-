"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Eye, EyeOff, X } from "lucide-react";
import { absorptionMarks, volumeProfile, vwapSeries, type VolumeProfile } from "@/lib/bias/chart-math";
import { fmtUsd } from "@/lib/bias/engine";
import { buildFootprint, niceStep } from "@/lib/bias/footprint";
import type { LiqLevel } from "@/lib/cohorts/cohorts";
import type { VolState } from "@/lib/vol/use-vol";
import { rollingRv } from "@/lib/vol/options";
import { CHART_INTERVALS, type ChartInterval, type OrderflowState } from "@/lib/hooks/use-orderflow";
import { BandLayer, BarStatsLayer, BubbleLayer, FootprintLayer, HeatmapLayer, ProfileLayer } from "./primitives";
import { oiRegime, REGIME_STYLE, useFundingHistory, useOiHistory } from "@/lib/flow/use-positioning";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Mako chart — TradingView-standard presentation.
//   • Clean default: candles + in-pane volume. Everything else is an
//     indicator from one menu, listed in the legend with hide / remove.
//   • Legend top-left: symbol line, live/hover OHLC, one row per indicator.
//   • Values live on the price axis as pills, not as text across candles.
// ════════════════════════════════════════════════════════════════

const UP = "#1FB880";
const DOWN = "#EF4444";
const UP_VOL = "rgba(31,184,128,0.28)";
const DOWN_VOL = "rgba(239,68,68,0.28)";
const AXIS_TEXT = "#8A8A91";
const FONT = "Inter, -apple-system, BlinkMacSystemFont, sans-serif";

export type IndicatorId = "vwap" | "vpvr" | "profile" | "heatmap" | "footprint" | "bubbles" | "liqs" | "delta" | "cvd" | "dvol" | "rv" | "gex" | "oi" | "funding" | "absorption" | "barstats";
export type IndicatorState = "off" | "on" | "hidden";
export type Indicators = Record<IndicatorId, IndicatorState>;

const ALL_INDICATORS: { id: IndicatorId; label: string; desc: string }[] = [
  { id: "vwap", label: "VWAP", desc: "Daily volume-weighted average price" },
  { id: "vpvr", label: "Volume profile", desc: "Visible range · buy/sell split · POC and value area" },
  { id: "profile", label: "Session volume profile", desc: "Today (UTC) · POC and value area" },
  { id: "heatmap", label: "Order book heatmap", desc: "Resting liquidity over time · live session" },
  { id: "footprint", label: "Footprint", desc: "Buy × sell volume per price inside each candle" },
  { id: "bubbles", label: "Large trades", desc: "Big market orders (fills re-assembled) · since the tab opened" },
  { id: "liqs", label: "Liquidation levels", desc: "Where tracked wallets get force-closed" },
  { id: "delta", label: "Delta", desc: "Net aggressive volume per candle · history on the top 20 coins" },
  { id: "cvd", label: "CVD", desc: "Cumulative volume delta · history on the top 20 coins" },
  { id: "dvol", label: "DVOL", desc: "Deribit 30-day implied vol index · BTC and ETH" },
  { id: "rv", label: "Realised vol", desc: "Rolling 30-bar realised vol, annualised · every coin" },
  { id: "gex", label: "Gamma strikes", desc: "Strikes with the most option gamma near price · Deribit options" },
  { id: "oi", label: "Open interest", desc: "OI + change per bar, coloured by who's opening/closing · 7d, every coin" },
  { id: "funding", label: "Funding", desc: "Hourly funding rate · 30d from Hyperliquid" },
  { id: "absorption", label: "Absorption", desc: "Strong aggressive flow that didn't move price · top 20 coins have history" },
  { id: "barstats", label: "Bar statistics", desc: "Volume, delta and delta % under every bar" },
];

// Parked Nov 2026: browser-only tape/book made these far weaker than dedicated
// order-flow terminals (MMT). Code and layers are kept so they can return,
// e.g. Large trades bubbles once prints are served from stored history.
export const PARKED_INDICATORS: IndicatorId[] = ["heatmap", "footprint"];
export const INDICATORS = ALL_INDICATORS.filter((i) => !PARKED_INDICATORS.includes(i.id));

export const DEFAULT_INDICATORS: Indicators = {
  vwap: "off", vpvr: "off", profile: "off", heatmap: "off", footprint: "off", bubbles: "off", liqs: "off", delta: "off", cvd: "off", dvol: "off", rv: "off", gex: "off", oi: "off", funding: "off", absorption: "off", barstats: "off",
};

const on = (s: IndicatorState) => s === "on";

/** Legend swatch per indicator — matches what's drawn. */
const SWATCH: Partial<Record<IndicatorId, string>> = {
  vwap: "#E0B341",
  vpvr: "linear-gradient(90deg, rgba(31,184,128,0.8) 50%, rgba(239,68,68,0.8) 50%)",
  profile: "linear-gradient(90deg, rgba(31,184,128,0.8) 50%, rgba(239,68,68,0.8) 50%)",
  liqs: "linear-gradient(90deg, #F59E0B 50%, #60A5FA 50%)",
  gex: "#A78BFA",
  delta: "linear-gradient(90deg, #1FB880 50%, #EF4444 50%)",
  cvd: "#EDEDEF",
  dvol: "#A78BFA",
  rv: "#38BDF8",
  oi: "linear-gradient(90deg, #1FB880 25%, #EF4444 25% 50%, #38BDF8 50% 75%, #F59E0B 75%)",
  funding: "linear-gradient(90deg, #1FB880 50%, #EF4444 50%)",
  absorption: "linear-gradient(90deg, #EF4444 50%, #1FB880 50%)",
  barstats: "#9B9BA0",
  bubbles: "linear-gradient(90deg, #1FB880 50%, #EF4444 50%)",
};

function precisionFor(px: number) {
  if (px >= 1000) return 1;
  if (px >= 100) return 2;
  if (px >= 1) return 4;
  if (px >= 0.01) return 5;
  return 7;
}
const ts = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

interface Props {
  of: OrderflowState;
  coin: string;
  interval: ChartInterval;
  indicators: Indicators;
  setIndicators: (f: (i: Indicators) => Indicators) => void;
  liqLevels: LiqLevel[];
  vol?: VolState;
}

interface Hover {
  o: number; h: number; l: number; c: number; v?: number; t: number;
}

export function OrderflowChart({ of, coin, interval, indicators, setIndicators, liqLevels, vol }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapBandRefs = useRef<ISeriesApi<"Line">[]>([]);
  const bandRef = useRef<BandLayer | null>(null);
  const deltaRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const cvdRef = useRef<ISeriesApi<"Line"> | null>(null);
  const dvolRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rvRef = useRef<ISeriesApi<"Line"> | null>(null);
  const gexLinesRef = useRef<IPriceLine[]>([]);
  const oiLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const oiDeltaRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fundRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const statsSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const statsLayerRef = useRef<BarStatsLayer | null>(null);
  const absMarkRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const gexKeyRef = useRef("");
  const hlRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const heatRef = useRef<HeatmapLayer | null>(null);
  const fpRef = useRef<FootprintLayer | null>(null);
  const bubbleRef = useRef<BubbleLayer | null>(null);
  const profRef = useRef<ProfileLayer | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const dataKeyRef = useRef("");
  const linesKeyRef = useRef("");
  const precRef = useRef(-1);
  const fpWasOn = useRef<boolean | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [paneTops, setPaneTops] = useState<Record<string, number | null>>({});

  const chart = of.chart && of.chart.interval === interval && of.chart.coin === coin ? of.chart : null;
  const showLower = on(indicators.delta) || on(indicators.cvd);
  const showVolPane = on(indicators.dvol) || on(indicators.rv);

  // Visible logical range (whole bars), for the visible-range volume profile.
  const [vis, setVis] = useState<{ a: number; b: number } | null>(null);
  const flowMap = useMemo(
    () => new Map((chart?.delta ?? []).filter((d) => d.buy + d.sell > 0).map((d) => [d.t, { buy: d.buy, sell: d.sell }])),
    [chart?.delta]
  );
  const vpvr: VolumeProfile | null = useMemo(() => {
    if (!chart || !on(indicators.vpvr)) return null;
    const k = chart.candles;
    const a = Math.max(0, vis?.a ?? k.length - 120);
    const b = Math.min(k.length - 1, vis?.b ?? k.length - 1);
    return b - a >= 4 ? volumeProfile(k.slice(a, b + 1), 80, flowMap) : null;
  }, [chart, vis, flowMap, indicators.vpvr]);

  const profile: VolumeProfile | null = useMemo(
    () => (chart ? volumeProfile(chart.profile) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chart?.profile]
  );

  // ── Create once ──
  useEffect(() => {
    if (!wrapRef.current) return;
    const c = createChart(wrapRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" }, // canvas shows through (depth pass)
        textColor: AXIS_TEXT,
        fontFamily: FONT,
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: "rgba(255,255,255,0.08)", separatorHoverColor: "rgba(255,255,255,0.15)", enableResize: true },
      },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(237,237,239,0.35)", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#26262B" },
        horzLine: { color: "rgba(237,237,239,0.35)", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#26262B" },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.08 } }, // room for the legend
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 7,
        tickMarkFormatter: (t: number) => {
          const d = new Date(t * 1000);
          return d.getHours() === 0 && d.getMinutes() === 0
            ? d.toLocaleDateString([], { day: "numeric", month: "short" })
            : d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" });
        },
      },
      localization: {
        timeFormatter: (t: number) =>
          new Date(t * 1000).toLocaleString([], { hour12: false, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      },
    });
    candleRef.current = c.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
    });
    volRef.current = c.addSeries(HistogramSeries, {
      priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false,
    });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    vwapRef.current = c.addSeries(LineSeries, {
      color: "#E0B341", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
      autoscaleInfoProvider: () => null,
    });
    // VWAP ±1σ (dotted) and ±2σ (faint dotted); ±1σ is also filled by BandLayer.
    vwapBandRefs.current = [1, -1, 2, -2].map((m) =>
      c.addSeries(LineSeries, {
        color: Math.abs(m) === 1 ? "rgba(224,179,65,0.45)" : "rgba(224,179,65,0.25)",
        lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => null,
      })
    );

    heatRef.current = new HeatmapLayer();
    fpRef.current = new FootprintLayer();
    bubbleRef.current = new BubbleLayer();
    profRef.current = new ProfileLayer();
    bandRef.current = new BandLayer();
    bandRef.current.enabled = false;
    candleRef.current.attachPrimitive(bandRef.current);
    for (const l of [heatRef.current, fpRef.current, bubbleRef.current, profRef.current]) {
      l.enabled = false;
      candleRef.current.attachPrimitive(l);
    }
    hlRef.current = createSeriesMarkers(candleRef.current, []);
    absMarkRef.current = createSeriesMarkers(candleRef.current, []);

    const onMove = (p: MouseEventParams<Time>) => {
      const cs = candleRef.current;
      if (!cs || !p.time) { setHover(null); setHoverT(null); return; }
      const d = p.seriesData.get(cs) as { open: number; high: number; low: number; close: number } | undefined;
      const v = volRef.current ? (p.seriesData.get(volRef.current) as { value: number } | undefined) : undefined;
      const tMs = (p.time as number) * 1000;
      setHoverT(tMs);
      setHover(d ? { o: d.open, h: d.high, l: d.low, c: d.close, v: v?.value, t: tMs } : null);
    };
    c.subscribeCrosshairMove(onMove);
    chartRef.current = c;

    // Where each lower pane starts (for its legend). Panes stack top-down with a 1px separator.
    const ph = setInterval(() => {
      try {
        const panes = c.panes();
        const topOf = (s: ISeriesApi<"Line"> | ISeriesApi<"Histogram"> | null) => {
          if (!s) return null;
          const idx = s.getPane().paneIndex();
          let y = 0;
          for (let i = 0; i < idx; i++) y += panes[i].getHeight() + 1;
          return idx > 0 ? y : null;
        };
        const next: Record<string, number | null> = {
          delta: topOf(deltaRef.current), vol: topOf(dvolRef.current), oi: topOf(oiLineRef.current),
          funding: topOf(fundRef.current), stats: topOf(statsSeriesRef.current),
        };
        setPaneTops((p) => (Object.keys(next).every((k) => p[k] === next[k]) ? p : next));
      } catch { /* ignore */ }
    }, 500);

    return () => {
      clearInterval(ph);
      c.unsubscribeCrosshairMove(onMove);
      c.remove();
      chartRef.current = null;
      candleRef.current = null;
      deltaRef.current = null;
      cvdRef.current = null;
      dvolRef.current = null;
      rvRef.current = null;
      oiLineRef.current = null;
      oiDeltaRef.current = null;
      fundRef.current = null;
      statsSeriesRef.current = null;
      statsLayerRef.current = null;
      absMarkRef.current = null;
      linesRef.current = [];
      gexLinesRef.current = [];
      gexKeyRef.current = "";
      dataKeyRef.current = "";
      linesKeyRef.current = "";
      precRef.current = -1;
      fpWasOn.current = null;
    };
  }, []);

  // ── Track the visible bar range (rounded) for the visible-range profile ──
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    let frame = 0;
    const onRange = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = c.timeScale().getVisibleLogicalRange();
        if (!r) return;
        const a = Math.floor(r.from), b = Math.ceil(r.to);
        setVis((p) => (p && p.a === a && p.b === b ? p : { a, b }));
      });
    };
    c.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    onRange();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      try { c.timeScale().unsubscribeVisibleLogicalRangeChange(onRange); } catch { /* ignore */ }
    };
  }, []);

  // ── Lower pane (delta / CVD): created only when one is on ──
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    if (showLower && !deltaRef.current) {
      deltaRef.current = c.addSeries(HistogramSeries, {
        priceLineVisible: false, lastValueVisible: false,
        priceFormat: { type: "custom", formatter: (v: number) => fmtUsd(v), minMove: 1 },
      }, c.panes().length);
      const idx = deltaRef.current.getPane().paneIndex();
      cvdRef.current = c.addSeries(LineSeries, {
        color: "#EDEDEF", lineWidth: 1, priceScaleId: "cvd", priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
        priceFormat: { type: "custom", formatter: (v: number) => fmtUsd(v), minMove: 1 },
      }, idx);
      relayoutPanes(c);
      dataKeyRef.current = "";
    } else if (!showLower && deltaRef.current) {
      try {
        c.removeSeries(deltaRef.current);
        if (cvdRef.current) c.removeSeries(cvdRef.current);
      } catch { /* ignore */ }
      deltaRef.current = null;
      cvdRef.current = null;
      relayoutPanes(c);
    }
  }, [showLower]);

  // ── Vol pane (DVOL / realised vol): its own pane at the bottom ──
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    if (showVolPane && !dvolRef.current) {
      const fmt = { type: "custom" as const, formatter: (v: number) => v.toFixed(1), minMove: 0.1 };
      dvolRef.current = c.addSeries(LineSeries, {
        color: "#A78BFA", lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: fmt,
      }, c.panes().length);
      const idx = dvolRef.current.getPane().paneIndex();
      rvRef.current = c.addSeries(LineSeries, {
        color: "#38BDF8", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: fmt,
      }, idx);
      relayoutPanes(c);
    } else if (!showVolPane && dvolRef.current) {
      try {
        c.removeSeries(dvolRef.current);
        if (rvRef.current) c.removeSeries(rvRef.current);
      } catch { /* ignore */ }
      dvolRef.current = null;
      rvRef.current = null;
      relayoutPanes(c);
    }
  }, [showVolPane]);

  // ── DVOL (step-aligned to the chart's candles) + rolling realised vol ──
  const rvBars = 30;
  const rvSeries = useMemo(() => {
    if (!chart?.candles.length) return [];
    const ppy = (365 * 24 * 3600_000) / CHART_INTERVALS[chart.interval];
    return rollingRv(chart.candles, rvBars, ppy);
  }, [chart?.candles, chart?.interval]);
  const dvolAligned = useMemo(() => {
    const d = vol?.dvol;
    if (!d?.length || !chart?.candles.length) return [];
    const out: { t: number; v: number }[] = [];
    let j = 0;
    for (const k of chart.candles) {
      while (j + 1 < d.length && d[j + 1].t <= k.t) j++;
      if (d[j].t <= k.t + CHART_INTERVALS[chart.interval]) out.push({ t: k.t, v: d[j].v });
    }
    return out;
  }, [vol?.dvol, chart?.candles, chart?.interval]);
  useEffect(() => {
    try {
      dvolRef.current?.setData(on(indicators.dvol) ? dvolAligned.map((x) => ({ time: ts(x.t), value: x.v })) : []);
      rvRef.current?.setData(on(indicators.rv) ? rvSeries.map((x) => ({ time: ts(x.t), value: x.v })) : []);
    } catch { /* ignore */ }
  }, [dvolAligned, rvSeries, indicators.dvol, indicators.rv, showVolPane]);

  // ── Order-flow panes: OI, funding, bar statistics (each its own pane) ──
  const showOi = on(indicators.oi), showFund = on(indicators.funding), showStats = on(indicators.barstats);
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    if (showOi && !oiLineRef.current) {
      oiLineRef.current = c.addSeries(LineSeries, {
        color: "#EDEDEF", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
        priceFormat: { type: "custom", formatter: (v: number) => fmtUsd(v).replace("+", ""), minMove: 1 },
      }, c.panes().length);
      oiDeltaRef.current = c.addSeries(HistogramSeries, {
        priceScaleId: "oid", priceLineVisible: false, lastValueVisible: false,
        priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(2)}%`, minMove: 0.01 },
      }, oiLineRef.current.getPane().paneIndex());
      try { oiDeltaRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.55, bottom: 0 } }); } catch { /* ignore */ }
      relayoutPanes(c);
    } else if (!showOi && oiLineRef.current) {
      try { c.removeSeries(oiLineRef.current); if (oiDeltaRef.current) c.removeSeries(oiDeltaRef.current); } catch { /* ignore */ }
      oiLineRef.current = null; oiDeltaRef.current = null;
      relayoutPanes(c);
    }
  }, [showOi]);
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    if (showFund && !fundRef.current) {
      fundRef.current = c.addSeries(HistogramSeries, {
        priceLineVisible: false, lastValueVisible: true,
        priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(4)}%`, minMove: 0.0001 },
      }, c.panes().length);
      relayoutPanes(c);
    } else if (!showFund && fundRef.current) {
      try { c.removeSeries(fundRef.current); } catch { /* ignore */ }
      fundRef.current = null;
      relayoutPanes(c);
    }
  }, [showFund]);
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    if (showStats && !statsSeriesRef.current) {
      // An invisible carrier series gives the stats layer its own pane.
      statsSeriesRef.current = c.addSeries(LineSeries, {
        color: "rgba(0,0,0,0)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        priceFormat: { type: "custom", formatter: () => "", minMove: 1 },
      }, c.panes().length);
      statsLayerRef.current = new BarStatsLayer();
      statsSeriesRef.current.attachPrimitive(statsLayerRef.current);
      relayoutPanes(c);
    } else if (!showStats && statsSeriesRef.current) {
      try { c.removeSeries(statsSeriesRef.current); } catch { /* ignore */ }
      statsSeriesRef.current = null; statsLayerRef.current = null;
      relayoutPanes(c);
    }
  }, [showStats]);

  const oiQ = useOiHistory(coin, showOi);
  const fundQ = useFundingHistory(coin, showFund);

  // OI per bar: value at bar close + % change across the bar, coloured by regime.
  const oiBars = useMemo(() => {
    const pts = oiQ.data;
    if (!pts?.length || !chart?.candles.length) return [];
    const ivMs = CHART_INTERVALS[chart.interval];
    const live = of.ctx?.oiUsd ? { t: Date.now(), oi: of.ctx.oiUsd, px: of.lastPx ?? 0 } : null;
    const all = live && live.t > pts[pts.length - 1].t ? [...pts, live] : pts;
    const out: { t: number; oi: number; chg: number; regime: ReturnType<typeof oiRegime> }[] = [];
    let j = 0;
    let prevEnd: { t: number; oi: number } | null = null;
    for (const k of chart.candles) {
      while (j + 1 < all.length && all[j + 1].t <= k.t + ivMs) j++;
      const end = all[j];
      if (!end || end.t > k.t + ivMs) continue;
      if (end.t < k.t - 15 * 60_000) { prevEnd = end; continue; } // no snapshot near this bar
      const start = prevEnd;
      prevEnd = end;
      const chg = start && start.t !== end.t && start.oi > 0 ? ((end.oi - start.oi) / start.oi) * 100 : 0;
      out.push({ t: k.t, oi: end.oi, chg, regime: oiRegime(k.c - k.o, chg) });
    }
    return out;
  }, [oiQ.data, chart?.candles, chart?.interval, of.ctx?.oiUsd, of.lastPx]);

  // Funding per bar: the hourly rate at that hour (sub-hour charts) or the bar's average.
  const fundBars = useMemo(() => {
    const f = fundQ.data;
    if (!f?.length || !chart?.candles.length) return [];
    const ivMs = CHART_INTERVALS[chart.interval];
    const first = chart.candles[0].t;
    const m = new Map<number, number[]>();
    for (const x of f) {
      const hour = Math.floor(x.t / 3_600_000) * 3_600_000;
      if (hour < first) continue;
      const b = Math.floor(hour / ivMs) * ivMs;
      (m.get(b) ?? m.set(b, []).get(b)!).push(x.rate);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, r]) => ({ t, rate: (r.reduce((s, x) => s + x, 0) / r.length) * 100 }));
  }, [fundQ.data, chart?.candles, chart?.interval]);

  const deltaByT = useMemo(() => new Map((chart?.delta ?? []).map((d) => [d.t, d])), [chart?.delta]);
  const absMarks = useMemo(() => {
    if (!on(indicators.absorption) || !chart?.candles.length) return [];
    return absorptionMarks(chart.candles, new Map([...deltaByT.entries()].map(([t, d]) => [t, d.net])));
  }, [indicators.absorption, chart?.candles, deltaByT]);

  useEffect(() => {
    try {
      oiLineRef.current?.setData(oiBars.map((b) => ({ time: ts(b.t), value: b.oi })));
      oiDeltaRef.current?.setData(oiBars.map((b) => ({ time: ts(b.t), value: b.chg, color: REGIME_STYLE[b.regime].color })));
      fundRef.current?.setData(fundBars.map((b) => ({ time: ts(b.t), value: b.rate, color: b.rate >= 0 ? "rgba(31,184,128,0.75)" : "rgba(239,68,68,0.75)" })));
      absMarkRef.current?.setMarkers(
        absMarks.map((m) => ({
          time: ts(m.t),
          position: m.side === 1 ? "aboveBar" : "belowBar",
          shape: "circle",
          color: m.side === 1 ? "rgba(239,68,68,0.95)" : "rgba(31,184,128,0.95)",
          size: 0.6,
        })) as SeriesMarker<Time>[]
      );
      const st = statsLayerRef.current;
      if (st && chart) {
        const k = chart.candles;
        statsSeriesRef.current?.setData(k.map((c) => ({ time: ts(c.t), value: 0 })));
        st.times = k.map((c) => c.t);
        st.iv = CHART_INTERVALS[chart.interval];
        st.stats = k.map((c) => {
          const d = deltaByT.get(c.t);
          return { t: c.t, vol: c.v * c.c, delta: d ? d.net : null, buy: d?.buy ?? 0, sell: d?.sell ?? 0 };
        });
        st.refresh();
      }
    } catch { /* ignore */ }
  }, [oiBars, fundBars, absMarks, deltaByT, chart, showOi, showFund, showStats]);

  // ── Gamma levels: flip + biggest dealer-gamma strikes as price lines ──
  useEffect(() => {
    const cs = candleRef.current;
    if (!cs) return;
    const s = vol?.surface;
    // Right after a coin switch lastPx can still be the old coin's; trust the chain's spot then.
    const px = s && of.lastPx && Math.abs(of.lastPx - s.spot) / s.spot < 0.2 ? of.lastPx : s?.spot ?? 0;
    const levels = on(indicators.gex) && s && px > 0
      ? s.gex.filter((g) => Math.abs(g.strike - px) / px <= 0.1).sort((a, b) => b.abs - a.abs).slice(0, 4)
      : [];
    const key = JSON.stringify(levels.map((l) => l.strike));
    if (key === gexKeyRef.current) return;
    gexKeyRef.current = key;
    for (const l of gexLinesRef.current) { try { cs.removePriceLine(l); } catch { /* ignore */ } }
    gexLinesRef.current = [];
    // No flip line and no +/− colouring: dealer direction is unknown (see vol-panel).
    for (const l of levels) {
      gexLinesRef.current.push(cs.createPriceLine({
        price: l.strike, color: "rgba(167,139,250,0.85)",
        lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "γ",
        axisLabelColor: "#3B2F66", axisLabelTextColor: "#E4DCFF",
      }));
    }
  }, [vol?.surface, of.lastPx, indicators.gex]);

  // ── Candles, volume, VWAP, delta/CVD ──
  useEffect(() => {
    const cs = candleRef.current;
    if (!cs || !chart || !chart.candles.length) return;
    const k = chart.candles;
    const last = k[k.length - 1];

    const p = precisionFor(last.c);
    if (p !== precRef.current) {
      precRef.current = p;
      const fmt = { type: "price" as const, precision: p, minMove: Math.pow(10, -p) };
      cs.applyOptions({ priceFormat: fmt });
      vwapRef.current?.applyOptions({ priceFormat: fmt });
    }

    const key = `${chart.coin}|${chart.interval}|${k[0].t}|${k.length}`;
    try {
      const volBar = (c: typeof last) => ({ time: ts(c.t), value: c.v * c.c, color: c.c >= c.o ? UP_VOL : DOWN_VOL });
      if (key === dataKeyRef.current) {
        cs.update({ time: ts(last.t), open: last.o, high: last.h, low: last.l, close: last.c });
        volRef.current?.update(volBar(last));
      } else {
        dataKeyRef.current = key;
        cs.setData(k.map((c) => ({ time: ts(c.t), open: c.o, high: c.h, low: c.l, close: c.c })));
        volRef.current?.setData(k.map(volBar));
      }
      const vw = on(indicators.vwap) ? vwapSeries(k) : [];
      vwapRef.current?.setData(vw.map((x) => ({ time: ts(x.t), value: x.v })));
      [1, -1, 2, -2].forEach((m, i) => vwapBandRefs.current[i]?.setData(vw.map((x) => ({ time: ts(x.t), value: x.v + m * x.sd }))));
      if (bandRef.current) {
        bandRef.current.enabled = vw.length > 1;
        bandRef.current.times = k.map((c) => c.t);
        bandRef.current.iv = CHART_INTERVALS[chart.interval];
        bandRef.current.points = vw.map((x) => ({ t: x.t, lo: x.v - x.sd, hi: x.v + x.sd }));
        bandRef.current.refresh();
      }

      if (deltaRef.current) {
        const times = new Set(k.map((c) => c.t));
        const deltas = chart.delta.filter((d) => times.has(d.t));
        // With CVD on, CVD owns the readable right axis and delta sits on an overlay scale.
        const cvdOn = on(indicators.cvd);
        deltaRef.current.applyOptions({ priceScaleId: cvdOn ? "delta" : "right" });
        cvdRef.current?.applyOptions({ priceScaleId: cvdOn ? "right" : "cvd" });
        // Shade bars by size: the biggest 10% read solid, small ones fade.
        const mags = deltas.map((d) => Math.abs(d.net)).sort((a, b) => a - b);
        const p90 = mags[Math.floor(mags.length * 0.9)] || 1;
        deltaRef.current.setData(
          on(indicators.delta)
            ? deltas.map((d) => {
                const a = (0.3 + 0.6 * Math.min(1, Math.abs(d.net) / p90)).toFixed(2);
                return { time: ts(d.t), value: d.net, color: d.net >= 0 ? `rgba(31,184,128,${a})` : `rgba(239,68,68,${a})` };
              })
            : []
        );
        let run = 0;
        const byT = new Map(deltas.map((d) => [d.t, d.net]));
        const firstT = deltas[0]?.t ?? Infinity;
        cvdRef.current?.setData(
          on(indicators.cvd)
            ? k.filter((c) => c.t >= firstT).map((c) => {
                const net = byT.get(c.t);
                return net === undefined ? { time: ts(c.t) } : { time: ts(c.t), value: (run += net) };
              })
            : []
        );
      }
    } catch {
      dataKeyRef.current = "";
    }
  }, [chart, indicators.vwap, indicators.delta, indicators.cvd, showLower]);

  // ── High / low of the visible range (small labels, no markers drawn) ──
  useEffect(() => {
    const c = chartRef.current;
    const m = hlRef.current;
    if (!c || !m || !chart) return;
    const k = chart.candles;
    const update = () => {
      try {
        const r = c.timeScale().getVisibleLogicalRange();
        if (!r || !k.length) return;
        const a = Math.max(0, Math.floor(r.from));
        const b = Math.min(k.length - 1, Math.ceil(r.to));
        if (b <= a) return;
        let hi = a, lo = a;
        for (let i = a; i <= b; i++) {
          if (k[i].h > k[hi].h) hi = i;
          if (k[i].l < k[lo].l) lo = i;
        }
        const p = precisionFor(k[hi].h);
        const markers: SeriesMarker<Time>[] = [
          { time: ts(k[hi].t), position: "aboveBar", shape: "arrowDown", color: "rgba(237,237,239,0.85)", text: k[hi].h.toFixed(p), size: 0 },
          { time: ts(k[lo].t), position: "belowBar", shape: "arrowUp", color: "rgba(237,237,239,0.85)", text: k[lo].l.toFixed(p), size: 0 },
        ];
        m.setMarkers(markers);
      } catch { /* ignore */ }
    };
    update();
    c.timeScale().subscribeVisibleLogicalRangeChange(update);
    return () => { try { c.timeScale().unsubscribeVisibleLogicalRangeChange(update); } catch { /* ignore */ } };
  }, [chart]);

  // ── Custom layers ──
  useEffect(() => {
    const heat = heatRef.current, fp = fpRef.current, bub = bubbleRef.current;
    if (!heat || !fp || !bub || !chart || !of.layers) return;
    const ivMs = CHART_INTERVALS[interval];
    const times = chart.candles.map((c) => c.t);
    for (const l of [heat, fp, bub]) { l.times = times; l.iv = ivMs; }

    heat.enabled = on(indicators.heatmap);
    heat.frames = of.layers.heat;

    fp.enabled = on(indicators.footprint);
    if (fp.enabled) {
      const ranges = chart.candles.slice(-40).map((c) => c.h - c.l).filter((x) => x > 0).sort((a, b) => a - b);
      const med = ranges[Math.floor(ranges.length / 2)] || (chart.candles[chart.candles.length - 1]?.c ?? 1) * 0.001;
      fp.row = niceStep(med / 12);
      fp.bars = buildFootprint(of.layers.tape, ivMs, fp.row, times[0] ?? 0);
    }

    bub.enabled = on(indicators.bubbles);
    bub.prints = bub.enabled ? of.allPrints.filter((p) => p.t >= (times[0] ?? 0)) : [];
    bub.minUsd = of.whaleMin;

    if (fpWasOn.current !== fp.enabled) {
      if (fpWasOn.current !== null || fp.enabled) {
        try {
          chartRef.current?.timeScale().applyOptions({ barSpacing: fp.enabled ? 72 : 7 });
          chartRef.current?.timeScale().scrollToRealTime();
        } catch { /* ignore */ }
      }
      fpWasOn.current = fp.enabled;
    }
    candleRef.current?.applyOptions(
      fp.enabled
        ? { upColor: "rgba(31,184,128,0.10)", downColor: "rgba(239,68,68,0.10)", borderUpColor: "rgba(31,184,128,0.35)", borderDownColor: "rgba(239,68,68,0.35)" }
        : { upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN }
    );
    for (const l of [heat, fp, bub]) l.refresh();
  }, [chart, of.layers, of.allPrints, of.whaleMin, interval, indicators.heatmap, indicators.footprint, indicators.bubbles]);

  // ── Profile layer + POC/VA axis pills + liquidation pills ──
  useEffect(() => {
    // Visible-range profile wins if both are on; session is the fallback.
    const active = on(indicators.vpvr) && vpvr ? vpvr : on(indicators.profile) && profile ? profile : null;
    const p = profRef.current;
    if (p) {
      p.enabled = !!active && !on(indicators.footprint);
      if (active) { p.bins = active.bins; p.poc = active.poc; p.vah = active.vah; p.val = active.val; }
      p.refresh();
    }
    const cs = candleRef.current;
    if (!cs) return;
    const px = of.lastPx ?? 0;
    const liqs = on(indicators.liqs) && px > 0
      ? liqLevels.filter((l) => Math.abs(l.px - px) / px <= 0.15).sort((a, b) => b.longUsd + b.shortUsd - (a.longUsd + a.shortUsd)).slice(0, 6)
      : [];
    const key = JSON.stringify([active ? [active.poc, active.vah, active.val].map((v) => v.toPrecision(6)) : null, liqs.map((l) => l.px.toPrecision(6))]);
    if (key === linesKeyRef.current) return;
    linesKeyRef.current = key;
    for (const l of linesRef.current) { try { cs.removePriceLine(l); } catch { /* ignore */ } }
    linesRef.current = [];
    if (active) {
      const lab = { axisLabelVisible: true, axisLabelColor: "#26262B", axisLabelTextColor: "#EDEDEF" };
      linesRef.current.push(cs.createPriceLine({ price: active.poc, color: "rgba(237,237,239,0.6)", lineWidth: 1, lineStyle: LineStyle.Solid, title: "POC", ...lab }));
      linesRef.current.push(cs.createPriceLine({ price: active.vah, color: "rgba(237,237,239,0.28)", lineWidth: 1, lineStyle: LineStyle.Dashed, title: "VAH", ...lab }));
      linesRef.current.push(cs.createPriceLine({ price: active.val, color: "rgba(237,237,239,0.28)", lineWidth: 1, lineStyle: LineStyle.Dashed, title: "VAL", ...lab }));
    }
    for (const l of liqs) {
      const longSide = l.longUsd >= l.shortUsd;
      linesRef.current.push(cs.createPriceLine({
        price: l.px, color: longSide ? "rgba(245,158,11,0.55)" : "rgba(96,165,250,0.55)",
        lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "",
      }));
    }
  }, [profile, vpvr, liqLevels, of.lastPx, indicators.profile, indicators.vpvr, indicators.liqs, indicators.footprint]);

  // ── Legend values (hover, else latest) ──
  const lastK = chart?.candles[chart.candles.length - 1];
  const leg = hover ?? (lastK ? { o: lastK.o, h: lastK.h, l: lastK.l, c: lastK.c, v: lastK.v * lastK.c, t: lastK.t } : null);
  const prec = leg ? precisionFor(leg.c) : 2;
  const chg = leg ? leg.c - leg.o : 0;
  const chgPct = leg && leg.o ? (chg / leg.o) * 100 : 0;
  const tone = chg >= 0 ? "text-positive" : "text-negative";
  const atT = hoverT ?? lastK?.t ?? null;
  const deltaAt = atT != null && chart ? chart.delta.find((d) => d.t === atT)?.net : undefined;
  const vwapNow = chart && on(indicators.vwap) ? vwapSeries(chart.candles).slice(-1)[0]?.v : undefined;
  const nearLiqs = on(indicators.liqs) && of.lastPx
    ? liqLevels.filter((l) => Math.abs(l.px - (of.lastPx as number)) / (of.lastPx as number) <= 0.15).length
    : 0;
  const heatMins = of.layers?.heat.length ? Math.round((of.layers.heat[of.layers.heat.length - 1].t - of.layers.heat[0].t) / 60000) : 0;

  const indValue = (id: IndicatorId): string => {
    switch (id) {
      case "vwap": return vwapNow != null ? vwapNow.toFixed(prec) : "";
      case "profile": return profile ? `POC ${profile.poc.toFixed(prec)}` : "";
      case "vpvr": return vpvr ? `POC ${vpvr.poc.toFixed(prec)} · ${vpvr.measured >= 0.5 ? "measured flow" : "est. split"}` : "";
      case "heatmap": return `${heatMins}m recorded`;
      case "bubbles": return `≥ ${fmtUsd(of.whaleMin).replace("+", "")}`;
      case "liqs": return `${nearLiqs} within 15%`;
      case "delta": return deltaAt != null ? fmtUsd(deltaAt) : "—";
      case "cvd": return of.chart?.deltaSource === "live" ? "since tab opened" : "";
      case "dvol": {
        if (!vol || vol.coverage === "none" || (coin !== "BTC" && coin !== "ETH")) return `n/a for ${coin} · BTC & ETH only`;
        const at = atT != null ? dvolAligned.find((x) => x.t === atT)?.v : undefined;
        return (at ?? vol.dvolNow)?.toFixed(1) ?? "loading";
      }
      case "rv": {
        const at = atT != null ? rvSeries.find((x) => x.t === atT)?.v : undefined;
        return `${rvBars} bars · ${(at ?? rvSeries[rvSeries.length - 1]?.v)?.toFixed(1) ?? "—"}`;
      }
      case "oi": {
        const last = oiBars[oiBars.length - 1];
        const at = atT != null ? oiBars.find((b) => b.t === atT) : last;
        if (!at) return oiQ.isLoading ? "loading" : "no history yet";
        return `${fmtUsd(at.oi).replace("+", "")} · ${at.chg >= 0 ? "+" : ""}${at.chg.toFixed(2)}% · ${REGIME_STYLE[at.regime].label}`;
      }
      case "funding": {
        const at = atT != null ? fundBars.find((b) => b.t === atT) : fundBars[fundBars.length - 1];
        if (!at) return fundQ.isLoading ? "loading" : "—";
        return `${at.rate >= 0 ? "+" : ""}${at.rate.toFixed(4)}%/h · ${(at.rate * 24 * 365).toFixed(1)}% APR`;
      }
      case "absorption": {
        const n = absMarks.length;
        return `${n} bar${n === 1 ? "" : "s"} · red = buyers absorbed, green = sellers absorbed`;
      }
      case "barstats": return chart?.deltaSource === "live" ? "delta since tab opened" : "";
      case "gex": {
        const s = vol?.surface;
        if (!s) return vol?.coverage === "none" ? `no listed ${coin} options` : "loading";
        return "top 4 within ±10%";
      }
      default: return "";
    }
  };

  const LOWER: IndicatorId[] = ["delta", "cvd", "dvol", "rv", "oi", "funding", "barstats"];
  const priceInds = INDICATORS.filter((i) => !LOWER.includes(i.id) && indicators[i.id] !== "off");
  const lowerInds = INDICATORS.filter((i) => (i.id === "delta" || i.id === "cvd") && indicators[i.id] !== "off");
  const volInds = INDICATORS.filter((i) => (i.id === "dvol" || i.id === "rv") && indicators[i.id] !== "off");
  const paneLegend = (id: IndicatorId, top: number | null | undefined) =>
    indicators[id] !== "off" && top != null ? (
      <div className="absolute left-3 z-20 pointer-events-none select-none flex flex-col gap-0.5" style={{ top: top + 6 }}>
        <LegendRow label={INDICATORS.find((i) => i.id === id)!.label} value={indValue(id)} hidden={indicators[id] === "hidden"}
          onHide={() => toggleHide(id)} onRemove={() => remove(id)} dot={SWATCH[id]} />
      </div>
    ) : null;

  const toggleHide = (id: IndicatorId) => setIndicators((s) => ({ ...s, [id]: s[id] === "hidden" ? "on" : "hidden" }));
  const remove = (id: IndicatorId) => setIndicators((s) => ({ ...s, [id]: "off" }));

  return (
    <div className="relative w-full h-full">
      <div ref={wrapRef} className="absolute inset-0" />

      {/* Legend — price pane */}
      <div className="absolute left-1.5 top-1.5 z-20 pointer-events-none select-none rounded-md bg-[#070709]/80 px-1.5 py-1">
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="font-semibold text-txt-primary">{coin}-PERP</span>
          <span className="text-txt-muted">Hyperliquid</span>
          <span className="text-txt-muted">·</span>
          <span className="text-txt-secondary">{interval}</span>
        </div>
        {leg && (
          <div className="mt-1 flex items-center gap-2.5 ds-num text-[11.5px]">
            <span className="text-txt-muted">O <span className={tone}>{leg.o.toFixed(prec)}</span></span>
            <span className="text-txt-muted">H <span className={tone}>{leg.h.toFixed(prec)}</span></span>
            <span className="text-txt-muted">L <span className={tone}>{leg.l.toFixed(prec)}</span></span>
            <span className="text-txt-muted">C <span className={tone}>{leg.c.toFixed(prec)}</span></span>
            <span className={tone}>{chg >= 0 ? "+" : ""}{chg.toFixed(prec)} ({chgPct >= 0 ? "+" : ""}{chgPct.toFixed(2)}%)</span>
          </div>
        )}
        {leg?.v != null && (
          <div className="mt-0.5 ds-num text-[11.5px] text-txt-muted">Vol <span className="text-txt-secondary">{fmtUsd(leg.v).replace("+", "")}</span></div>
        )}
        {priceInds.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-0.5">
            {priceInds.map((i) => (
              <LegendRow key={i.id} label={i.label} value={indValue(i.id)} hidden={indicators[i.id] === "hidden"} onHide={() => toggleHide(i.id)} onRemove={() => remove(i.id)} dot={SWATCH[i.id]} />
            ))}
          </div>
        )}
      </div>

      {/* Legend — lower pane */}
      {paneLegend("oi", paneTops.oi)}
      {paneLegend("funding", paneTops.funding)}
      {paneLegend("barstats", paneTops.stats)}
      {lowerInds.length > 0 && paneTops.delta != null && (
        <div className="absolute left-3 z-20 pointer-events-none select-none flex flex-col gap-0.5" style={{ top: paneTops.delta + 6 }}>
          {lowerInds.map((i) => (
            <LegendRow key={i.id} label={i.label} value={indValue(i.id)} hidden={indicators[i.id] === "hidden"} onHide={() => toggleHide(i.id)} onRemove={() => remove(i.id)} dot={SWATCH[i.id]} />
          ))}
        </div>
      )}

      {/* Legend — vol pane */}
      {volInds.length > 0 && paneTops.vol != null && (
        <div className="absolute left-3 z-20 pointer-events-none select-none flex flex-col gap-0.5" style={{ top: paneTops.vol + 6 }}>
          {volInds.map((i) => (
            <LegendRow key={i.id} label={i.label} value={indValue(i.id)} hidden={indicators[i.id] === "hidden"} onHide={() => toggleHide(i.id)} onRemove={() => remove(i.id)}
              dot={SWATCH[i.id]} />
          ))}
        </div>
      )}

      {!chart && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-txt-muted">Loading chart…</div>}
    </div>
  );
}

function LegendRow({ label, value, hidden, onHide, onRemove, dot }: { label: string; value: string; hidden: boolean; onHide: () => void; onRemove: () => void; dot?: string }) {
  return (
    <div className="group flex items-center gap-2 h-[18px] text-[11.5px] pointer-events-auto w-fit pr-1 rounded hover:bg-white/[0.04]">
      {dot && <span className="w-2.5 h-[3px] rounded-full shrink-0" style={{ background: dot }} />}
      <span className={cn(hidden ? "text-txt-dim" : "text-txt-secondary")}>{label}</span>
      {value && <span className={cn("ds-num", hidden ? "text-txt-dim" : "text-txt-primary")}>{value}</span>}
      <span className="hidden group-hover:flex items-center gap-1 ml-0.5">
        <button onClick={onHide} className="text-txt-muted hover:text-txt-primary" title={hidden ? "Show" : "Hide"}>
          {hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        </button>
        <button onClick={onRemove} className="text-txt-muted hover:text-txt-primary" title="Remove">
          <X className="w-3 h-3" />
        </button>
      </span>
    </div>
  );
}

/** Main pane gets most of the height; each lower pane shares the rest. */
function relayoutPanes(c: IChartApi) {
  try {
    const panes = c.panes();
    const n = panes.length;
    if (n <= 1) return;
    // The bar-statistics pane (transparent carrier series) only needs ~3 text rows.
    const isStats = (i: number) => panes[i].getSeries().some((s) => (s.options() as { color?: string }).color === "rgba(0,0,0,0)");
    const lower = [...Array(n).keys()].slice(1);
    const statsN = lower.filter(isStats).length;
    const main = n === 2 ? 0.75 : 0.62;
    const statsF = 0.07;
    const otherN = lower.length - statsN;
    const mainF = otherN === 0 ? 1 - statsF * statsN : main;
    panes[0].setStretchFactor(mainF);
    for (const i of lower) panes[i].setStretchFactor(isStats(i) ? statsF : (1 - mainF - statsF * statsN) / Math.max(1, otherN));
  } catch { /* ignore */ }
}
