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
import { volumeProfile, vwapSeries, type VolumeProfile } from "@/lib/bias/chart-math";
import { fmtUsd } from "@/lib/bias/engine";
import { buildFootprint, niceStep } from "@/lib/bias/footprint";
import type { LiqLevel } from "@/lib/cohorts/cohorts";
import { CHART_INTERVALS, type ChartInterval, type OrderflowState } from "@/lib/hooks/use-orderflow";
import { BubbleLayer, FootprintLayer, HeatmapLayer, ProfileLayer } from "./primitives";
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
const PROFILE_W = 90;

export type IndicatorId = "vwap" | "profile" | "heatmap" | "footprint" | "bubbles" | "liqs" | "delta" | "cvd";
export type IndicatorState = "off" | "on" | "hidden";
export type Indicators = Record<IndicatorId, IndicatorState>;

const ALL_INDICATORS: { id: IndicatorId; label: string; desc: string }[] = [
  { id: "vwap", label: "VWAP", desc: "Daily volume-weighted average price" },
  { id: "profile", label: "Session volume profile", desc: "Today (UTC) · POC and value area" },
  { id: "heatmap", label: "Order book heatmap", desc: "Resting liquidity over time · live session" },
  { id: "footprint", label: "Footprint", desc: "Buy × sell volume per price inside each candle" },
  { id: "bubbles", label: "Large trades", desc: "Big prints at their exact price and time" },
  { id: "liqs", label: "Liquidation levels", desc: "Where tracked wallets get force-closed" },
  { id: "delta", label: "Delta", desc: "Net aggressive volume per candle · live session" },
  { id: "cvd", label: "CVD", desc: "Cumulative volume delta · live session" },
];

// Parked Nov 2026: browser-only tape/book made these far weaker than dedicated
// order-flow terminals (MMT). Code and layers are kept so they can return,
// e.g. Large trades bubbles once prints are served from stored history.
export const PARKED_INDICATORS: IndicatorId[] = ["heatmap", "footprint", "bubbles"];
export const INDICATORS = ALL_INDICATORS.filter((i) => !PARKED_INDICATORS.includes(i.id));

export const DEFAULT_INDICATORS: Indicators = {
  vwap: "off", profile: "off", heatmap: "off", footprint: "off", bubbles: "off", liqs: "off", delta: "off", cvd: "off",
};

const on = (s: IndicatorState) => s === "on";

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
}

interface Hover {
  o: number; h: number; l: number; c: number; v?: number; t: number;
}

export function OrderflowChart({ of, coin, interval, indicators, setIndicators, liqLevels }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);
  const deltaRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const cvdRef = useRef<ISeriesApi<"Line"> | null>(null);
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
  const [pane0H, setPane0H] = useState<number | null>(null);

  const chart = of.chart && of.chart.interval === interval ? of.chart : null;
  const showLower = on(indicators.delta) || on(indicators.cvd);

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
        background: { type: ColorType.Solid, color: "#08080A" },
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

    heatRef.current = new HeatmapLayer();
    fpRef.current = new FootprintLayer();
    bubbleRef.current = new BubbleLayer();
    profRef.current = new ProfileLayer();
    profRef.current.width = PROFILE_W;
    for (const l of [heatRef.current, fpRef.current, bubbleRef.current, profRef.current]) {
      l.enabled = false;
      candleRef.current.attachPrimitive(l);
    }
    hlRef.current = createSeriesMarkers(candleRef.current, []);

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

    const ph = setInterval(() => {
      try { setPane0H(c.panes().length > 1 ? c.panes()[0].getHeight() : null); } catch { /* ignore */ }
    }, 500);

    return () => {
      clearInterval(ph);
      c.unsubscribeCrosshairMove(onMove);
      c.remove();
      chartRef.current = null;
      candleRef.current = null;
      deltaRef.current = null;
      cvdRef.current = null;
      linesRef.current = [];
      dataKeyRef.current = "";
      linesKeyRef.current = "";
      precRef.current = -1;
      fpWasOn.current = null;
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
      }, 1);
      cvdRef.current = c.addSeries(LineSeries, {
        color: "#EDEDEF", lineWidth: 1, priceScaleId: "cvd", priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      }, 1);
      try { c.panes()[1]?.setStretchFactor(0.25); c.panes()[0]?.setStretchFactor(0.75); } catch { /* ignore */ }
      dataKeyRef.current = "";
    } else if (!showLower && deltaRef.current) {
      try {
        c.removeSeries(deltaRef.current);
        if (cvdRef.current) c.removeSeries(cvdRef.current);
      } catch { /* ignore */ }
      deltaRef.current = null;
      cvdRef.current = null;
    }
  }, [showLower]);

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

    const key = `${chart.interval}|${k[0].t}|${k.length}`;
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
      vwapRef.current?.setData(on(indicators.vwap) ? vwapSeries(k).map((x) => ({ time: ts(x.t), value: x.v })) : []);

      if (deltaRef.current) {
        const times = new Set(k.map((c) => c.t));
        const deltas = chart.delta.filter((d) => times.has(d.t));
        deltaRef.current.setData(
          on(indicators.delta)
            ? deltas.map((d) => ({ time: ts(d.t), value: d.net, color: d.net >= 0 ? "rgba(31,184,128,0.7)" : "rgba(239,68,68,0.7)" }))
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
  }, [chart, of.layers, of.allPrints, interval, indicators.heatmap, indicators.footprint, indicators.bubbles]);

  // ── Profile layer + POC/VA axis pills + liquidation pills ──
  useEffect(() => {
    const p = profRef.current;
    if (p) {
      p.enabled = on(indicators.profile) && !on(indicators.footprint) && !!profile;
      if (profile) { p.bins = profile.bins; p.poc = profile.poc; p.vah = profile.vah; p.val = profile.val; }
      p.refresh();
    }
    const cs = candleRef.current;
    if (!cs) return;
    const px = of.lastPx ?? 0;
    const liqs = on(indicators.liqs) && px > 0
      ? liqLevels.filter((l) => Math.abs(l.px - px) / px <= 0.15).sort((a, b) => b.longUsd + b.shortUsd - (a.longUsd + a.shortUsd)).slice(0, 6)
      : [];
    const showVa = on(indicators.profile) && profile;
    const key = JSON.stringify([showVa ? [profile!.poc, profile!.vah, profile!.val].map((v) => v.toPrecision(6)) : null, liqs.map((l) => l.px.toPrecision(6))]);
    if (key === linesKeyRef.current) return;
    linesKeyRef.current = key;
    for (const l of linesRef.current) { try { cs.removePriceLine(l); } catch { /* ignore */ } }
    linesRef.current = [];
    if (showVa && profile) {
      linesRef.current.push(cs.createPriceLine({ price: profile.poc, color: "rgba(237,237,239,0.55)", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "" }));
      linesRef.current.push(cs.createPriceLine({ price: profile.vah, color: "rgba(237,237,239,0.22)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" }));
      linesRef.current.push(cs.createPriceLine({ price: profile.val, color: "rgba(237,237,239,0.22)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" }));
    }
    for (const l of liqs) {
      const longSide = l.longUsd >= l.shortUsd;
      linesRef.current.push(cs.createPriceLine({
        price: l.px, color: longSide ? "rgba(245,158,11,0.55)" : "rgba(96,165,250,0.55)",
        lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "",
      }));
    }
  }, [profile, liqLevels, of.lastPx, indicators.profile, indicators.liqs, indicators.footprint]);

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
      case "heatmap": return `${heatMins}m recorded`;
      case "bubbles": return `≥ ${fmtUsd(of.whaleMin).replace("+", "")}`;
      case "liqs": return `${nearLiqs} within 15%`;
      case "delta": return deltaAt != null ? fmtUsd(deltaAt) : "—";
      default: return "";
    }
  };

  const priceInds = INDICATORS.filter((i) => i.id !== "delta" && i.id !== "cvd" && indicators[i.id] !== "off");
  const lowerInds = INDICATORS.filter((i) => (i.id === "delta" || i.id === "cvd") && indicators[i.id] !== "off");

  const toggleHide = (id: IndicatorId) => setIndicators((s) => ({ ...s, [id]: s[id] === "hidden" ? "on" : "hidden" }));
  const remove = (id: IndicatorId) => setIndicators((s) => ({ ...s, [id]: "off" }));

  return (
    <div className="relative w-full h-full">
      <div ref={wrapRef} className="absolute inset-0" />

      {/* Legend — price pane */}
      <div className="absolute left-3 top-2.5 z-20 pointer-events-none select-none">
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
              <LegendRow key={i.id} label={i.label} value={indValue(i.id)} hidden={indicators[i.id] === "hidden"} onHide={() => toggleHide(i.id)} onRemove={() => remove(i.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Legend — lower pane */}
      {lowerInds.length > 0 && pane0H != null && (
        <div className="absolute left-3 z-20 pointer-events-none select-none flex flex-col gap-0.5" style={{ top: pane0H + 6 }}>
          {lowerInds.map((i) => (
            <LegendRow key={i.id} label={i.label} value={indValue(i.id)} hidden={indicators[i.id] === "hidden"} onHide={() => toggleHide(i.id)} onRemove={() => remove(i.id)} />
          ))}
        </div>
      )}

      {!chart && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-txt-muted">Loading chart…</div>}
    </div>
  );
}

function LegendRow({ label, value, hidden, onHide, onRemove }: { label: string; value: string; hidden: boolean; onHide: () => void; onRemove: () => void }) {
  return (
    <div className="group flex items-center gap-2 h-[18px] text-[11.5px] pointer-events-auto w-fit pr-1 rounded hover:bg-white/[0.04]">
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
