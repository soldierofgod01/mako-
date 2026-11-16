"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { volumeProfile, vwapSeries, type VolumeProfile } from "@/lib/bias/chart-math";
import { buildFootprint, niceStep } from "@/lib/bias/footprint";
import { BubbleLayer, FootprintLayer, HeatmapLayer } from "./primitives";
import { fmtUsd } from "@/lib/bias/engine";
import type { LiqLevel } from "@/lib/cohorts/cohorts";
import { CHART_INTERVALS, type ChartInterval, type OrderflowState } from "@/lib/hooks/use-orderflow";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Mako's own order-flow chart. Everything the engine reads, on price:
//   candles (HL) · daily VWAP · session volume profile (POC / VAH / VAL)
//   · large prints · liquidation levels of tracked wallets · per-candle delta
// ════════════════════════════════════════════════════════════════

const UP = "#1FB880";
const DOWN = "#EF4444";
const MINT = "#33FFA3";
const PROFILE_W = 90;

export interface Layers {
  heatmap: boolean;
  footprint: boolean;
  bubbles: boolean;
  cvd: boolean;
  vwap: boolean;
  profile: boolean;
  liqs: boolean;
}

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
  interval: ChartInterval;
  onInterval: (i: ChartInterval) => void;
  liqLevels: LiqLevel[];
}

export function OrderflowChart({ of, interval, onInterval, liqLevels }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);
  const deltaRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const cvdRef = useRef<ISeriesApi<"Line"> | null>(null);
  const heatRef = useRef<HeatmapLayer | null>(null);
  const fpRef = useRef<FootprintLayer | null>(null);
  const bubbleRef = useRef<BubbleLayer | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const dataKeyRef = useRef("");
  const linesKeyRef = useRef("");

  const precRef = useRef(-1);
  const [layers, setLayers] = useState<Layers>(() => {
    const def: Layers = { heatmap: true, footprint: false, bubbles: true, cvd: true, vwap: true, profile: true, liqs: true };
    try {
      const saved = typeof window !== "undefined" ? localStorage.getItem("mako:chart:layers") : null;
      return saved ? { ...def, ...JSON.parse(saved) } : def;
    } catch { return def; }
  });
  useEffect(() => {
    try { localStorage.setItem("mako:chart:layers", JSON.stringify(layers)); } catch { /* ignore */ }
  }, [layers]);
  const [profileBars, setProfileBars] = useState<{ top: number; h: number; w: number; inVa: boolean; poc: boolean }[]>([]);
  const [scaleW, setScaleW] = useState(60);

  const chart = of.chart && of.chart.interval === interval ? of.chart : null;
  const profile: VolumeProfile | null = useMemo(
    () => (chart ? volumeProfile(chart.profile) : null),
    // Recompute when the 1m profile data changes, not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chart?.profile]
  );

  // ── Create once ──
  useEffect(() => {
    if (!wrapRef.current) return;
    const c = createChart(wrapRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0A0A0C" },
        textColor: "#6B6B72",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 10,
        attributionLogo: false,
        panes: { separatorColor: "rgba(255,255,255,0.06)", enableResize: true },
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.025)" },
        horzLines: { color: "rgba(255,255,255,0.025)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        tickMarkFormatter: (t: number) =>
          new Date(t * 1000).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" }),
      },
      localization: {
        timeFormatter: (t: number) =>
          new Date(t * 1000).toLocaleString([], { hour12: false, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      },
    });
    candleRef.current = c.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN,
      wickUpColor: "rgba(31,184,128,0.7)", wickDownColor: "rgba(239,68,68,0.7)",
    });
    vwapRef.current = c.addSeries(LineSeries, {
      color: "rgba(237,237,239,0.55)", lineWidth: 1, lineStyle: LineStyle.Solid,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: "VWAP",
    });
    deltaRef.current = c.addSeries(HistogramSeries, {
      priceLineVisible: false, lastValueVisible: false,
      priceFormat: { type: "custom", formatter: (v: number) => fmtUsd(v), minMove: 1 },
    }, 1);
    cvdRef.current = c.addSeries(LineSeries, {
      color: MINT, lineWidth: 2, priceScaleId: "cvd",
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    }, 1);
    c.panes()[1]?.setStretchFactor(0.22);
    c.panes()[0]?.setStretchFactor(0.78);
    heatRef.current = new HeatmapLayer();
    fpRef.current = new FootprintLayer();
    bubbleRef.current = new BubbleLayer();
    candleRef.current.attachPrimitive(heatRef.current);
    candleRef.current.attachPrimitive(fpRef.current);
    candleRef.current.attachPrimitive(bubbleRef.current);
    chartRef.current = c;
    return () => {
      c.remove();
      chartRef.current = null;
      candleRef.current = null;
      linesRef.current = [];
      dataKeyRef.current = "";
      linesKeyRef.current = "";
      precRef.current = -1;
    };
  }, []);

  // ── Candles, VWAP, delta ──
  useEffect(() => {
    const cs = candleRef.current;
    if (!cs || !chart || !chart.candles.length) return;
    const k = chart.candles;
    const last = k[k.length - 1];

    const p = precisionFor(last.c);
    if (p !== precRef.current) {
      precRef.current = p;
      cs.applyOptions({ priceFormat: { type: "price", precision: p, minMove: Math.pow(10, -p) } });
      vwapRef.current?.applyOptions({ priceFormat: { type: "price", precision: p, minMove: Math.pow(10, -p) } });
    }

    const key = `${of.chart?.interval}|${k[0].t}|${k.length}`;
    try {
      if (key === dataKeyRef.current) {
        cs.update({ time: ts(last.t), open: last.o, high: last.h, low: last.l, close: last.c });
      } else {
        dataKeyRef.current = key;
        cs.setData(k.map((c) => ({ time: ts(c.t), open: c.o, high: c.h, low: c.l, close: c.c })));
      }
      vwapRef.current?.setData(layers.vwap ? vwapSeries(k).map((x) => ({ time: ts(x.t), value: x.v })) : []);
      const times = new Set(k.map((c) => c.t));
      const deltas = chart.delta.filter((d) => times.has(d.t));
      deltaRef.current?.setData(
        deltas.map((d) => ({ time: ts(d.t), value: d.net, color: d.net >= 0 ? "rgba(31,184,128,0.75)" : "rgba(239,68,68,0.75)" }))
      );
      // Bucketed CVD: running sum of per-candle delta (session).
      let run = 0;
      cvdRef.current?.setData(layers.cvd ? deltas.map((d) => ({ time: ts(d.t), value: (run += d.net) })) : []);
    } catch {
      /* out-of-order frame — next tick will resync */
      dataKeyRef.current = "";
    }
  }, [chart, layers.vwap, layers.cvd, of.chart?.interval]);

  // ── Heatmap / footprint / bubbles (custom layers) ──
  useEffect(() => {
    const heat = heatRef.current, fp = fpRef.current, bub = bubbleRef.current;
    if (!heat || !fp || !bub || !chart || !of.layers) return;
    const ivMs = CHART_INTERVALS[interval];
    const times = chart.candles.map((c) => c.t);
    for (const l of [heat, fp, bub]) { l.times = times; l.iv = ivMs; }

    heat.enabled = layers.heatmap;
    heat.frames = of.layers.heat;

    fp.enabled = layers.footprint;
    if (layers.footprint) {
      // Row size: ~12 rows across a typical recent candle.
      const recent = chart.candles.slice(-40);
      const ranges = recent.map((c) => c.h - c.l).filter((x) => x > 0).sort((a, b) => a - b);
      const med = ranges[Math.floor(ranges.length / 2)] || (chart.candles[chart.candles.length - 1]?.c ?? 1) * 0.001;
      fp.row = niceStep(med / 12);
      fp.bars = buildFootprint(of.layers.tape, ivMs, fp.row, times[0] ?? 0);
    }

    bub.enabled = layers.bubbles;
    bub.prints = layers.bubbles ? of.allPrints.filter((p) => p.t >= (times[0] ?? 0)) : [];

    // Footprint replaces candle bodies: fade them so the cells read clearly.
    candleRef.current?.applyOptions(
      layers.footprint
        ? { upColor: "rgba(31,184,128,0.12)", downColor: "rgba(239,68,68,0.12)", borderUpColor: "rgba(31,184,128,0.35)", borderDownColor: "rgba(239,68,68,0.35)" }
        : { upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN }
    );
    for (const l of [heat, fp, bub]) l.refresh();
  }, [chart, of.layers, of.allPrints, interval, layers.heatmap, layers.footprint, layers.bubbles]);

  // ── Price lines: POC / VAH / VAL + liquidation levels ──
  useEffect(() => {
    const cs = candleRef.current;
    if (!cs) return;
    const px = of.lastPx ?? 0;
    const liqs = layers.liqs && px > 0
      ? liqLevels
          .filter((l) => Math.abs(l.px - px) / px <= 0.15)
          .sort((a, b) => b.longUsd + b.shortUsd - (a.longUsd + a.shortUsd))
          .slice(0, 6)
      : [];
    const key = JSON.stringify([
      layers.profile && profile ? [profile.poc, profile.vah, profile.val].map((v) => v.toPrecision(6)) : null,
      liqs.map((l) => [l.px.toPrecision(6), Math.round((l.longUsd + l.shortUsd) / 1e5)]),
    ]);
    if (key === linesKeyRef.current) return;
    linesKeyRef.current = key;
    for (const l of linesRef.current) { try { cs.removePriceLine(l); } catch { /* ignore */ } }
    linesRef.current = [];
    if (layers.profile && profile) {
      linesRef.current.push(cs.createPriceLine({ price: profile.poc, color: MINT, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "POC" }));
      linesRef.current.push(cs.createPriceLine({ price: profile.vah, color: "rgba(155,155,160,0.6)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "VAH" }));
      linesRef.current.push(cs.createPriceLine({ price: profile.val, color: "rgba(155,155,160,0.6)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "VAL" }));
    }
    for (const l of liqs) {
      const longSide = l.longUsd >= l.shortUsd;
      const usd = l.longUsd + l.shortUsd;
      linesRef.current.push(cs.createPriceLine({
        price: l.px,
        color: longSide ? "rgba(245,158,11,0.75)" : "rgba(96,165,250,0.75)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
        title: `${longSide ? "Long" : "Short"} liqs ${fmtUsd(usd).replace("+", "")}`,
      }));
    }
  }, [profile, liqLevels, of.lastPx, layers.profile, layers.liqs]);

  // ── Volume profile histogram overlay (DOM, positioned from the price scale) ──
  // Leave empty space on the right so the profile never covers the latest candles.
  useEffect(() => {
    const ts_ = chartRef.current?.timeScale();
    if (!ts_) return;
    try {
      const spacing = ts_.options().barSpacing || 6;
      ts_.applyOptions({ rightOffset: layers.profile ? Math.ceil(PROFILE_W / spacing) + 2 : 6 });
    } catch { /* ignore */ }
  }, [layers.profile, chart?.candles.length]);

  useEffect(() => {
    if (!layers.profile || !profile) { setProfileBars([]); return; }
    const draw = () => {
      const cs = candleRef.current;
      const c = chartRef.current;
      if (!cs || !c) return;
      const maxV = Math.max(...profile.bins.map((b) => b.vol), 1);
      const bars = profile.bins.map((b) => {
        const y1 = cs.priceToCoordinate(b.hi);
        const y2 = cs.priceToCoordinate(b.lo);
        if (y1 == null || y2 == null) return null;
        const mid = (b.lo + b.hi) / 2;
        return {
          top: Math.min(y1, y2),
          h: Math.max(1, Math.abs(y2 - y1) - 1),
          w: (b.vol / maxV) * 100,
          inVa: mid >= profile.val && mid <= profile.vah,
          poc: profile.poc >= b.lo && profile.poc <= b.hi,
        };
      }).filter((x): x is NonNullable<typeof x> => x !== null);
      // Clip to the price pane so bars never spill into the delta pane.
      let paneH = Infinity;
      try { paneH = c.panes()[0]?.getHeight() ?? Infinity; } catch { /* ignore */ }
      setProfileBars(bars.filter((b) => b.top >= 0 && b.top + b.h <= paneH));
      try { setScaleW(c.priceScale("right").width()); } catch { /* ignore */ }
    };
    draw();
    const id = setInterval(draw, 700);
    return () => clearInterval(id);
  }, [profile, layers.profile]);

  const toggle = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  return (
    <div className="w-full h-full flex flex-col">
      {/* Toolbar */}
      <div className="h-9 shrink-0 flex items-center gap-1 px-2 border-b border-border overflow-x-auto whitespace-nowrap">
        {(Object.keys(CHART_INTERVALS) as ChartInterval[]).map((i) => (
          <button
            key={i}
            onClick={() => onInterval(i)}
            className={cn("h-6 px-2 rounded text-[11.5px] font-medium ds-num", interval === i ? "bg-elevated text-txt-primary" : "text-txt-muted hover:text-txt-primary")}
          >
            {i}
          </button>
        ))}
        <span className="w-px h-4 bg-border mx-1.5" />
        {([
          ["heatmap", "Heatmap"],
          ["footprint", "Footprint"],
          ["bubbles", "Bubbles"],
          ["cvd", "CVD"],
          ["vwap", "VWAP"],
          ["profile", "Profile"],
          ["liqs", "Liqs"],
        ] as [keyof Layers, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => toggle(k)}
            className={cn("h-6 px-2 rounded text-[11.5px] font-medium", layers[k] ? "text-txt-primary bg-elevated/60" : "text-txt-dim hover:text-txt-secondary")}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-[10.5px] text-txt-muted pr-1 hidden xl:block">
          Heatmap, footprint, bubbles &amp; delta build from the live session · liqs: tracked wallets
        </span>
      </div>

      {/* Chart + profile overlay */}
      <div className="relative flex-1 min-h-0">
        <div ref={wrapRef} className="absolute inset-0" />
        {layers.profile && profileBars.length > 0 && (
          <div className="absolute top-0 bottom-0 pointer-events-none z-10" style={{ right: scaleW, width: PROFILE_W }}>
            {profileBars.map((b, i) => (
              <div
                key={i}
                className="absolute right-0"
                style={{
                  top: b.top,
                  height: b.h,
                  width: `${b.w}%`,
                  background: b.poc ? "rgba(51,255,163,0.5)" : b.inVa ? "rgba(155,155,160,0.3)" : "rgba(155,155,160,0.14)",
                }}
              />
            ))}
          </div>
        )}
        {!chart && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-txt-muted">Loading candles…</div>
        )}
      </div>
    </div>
  );
}
