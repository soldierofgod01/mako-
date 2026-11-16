"use client";
import { useEffect, useRef } from "react";
import {
  AreaSeries,
  createChart,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { cn } from "@/lib/utils";

// Shared Velo-style chart pieces: a panel shell, a time-series chart and a
// bar chart. One idea per panel, axis on the right, legend underneath.

const FONT = "Inter, -apple-system, BlinkMacSystemFont, sans-serif";

export function Panel({ title, note, legend, children }: { title: string; note?: string; legend?: { label: string; color: string }[]; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-[#0C0C0F] flex flex-col min-w-0">
      <h3 className="pt-3.5 text-center text-[13.5px] font-semibold text-txt-primary tracking-[-0.01em]">{title}</h3>
      <div className="h-[230px] px-2 pt-2">{children}</div>
      <div className="min-h-[34px] px-3 pb-2.5 pt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {legend?.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5 text-[11.5px] text-txt-secondary">
            <span className="w-3 h-[2px] rounded" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
        {note && <span className="text-[11px] text-txt-muted">{note}</span>}
      </div>
    </section>
  );
}

export interface SeriesSpec {
  kind: "area" | "line" | "histogram";
  data: { t: number; v: number; color?: string }[];
  color: string;
  scaleId?: string;
}

export function TimeChart({ series, format, zeroLine, empty }: { series: SeriesSpec[]; format: (v: number) => string; zeroLine?: boolean; empty?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const hasData = series.some((s) => s.data.length > 1);

  useEffect(() => {
    if (!el.current || !hasData) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8A8A91", fontFamily: FONT, fontSize: 10.5, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false, timeVisible: false,
        tickMarkFormatter: (t: number) => new Date(t * 1000).toLocaleDateString([], { day: "numeric", month: "short" }),
      },
      localization: {
        priceFormatter: format,
        timeFormatter: (t: number) => new Date(t * 1000).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }),
      },
      crosshair: {
        vertLine: { color: "rgba(237,237,239,0.3)", style: LineStyle.Dashed, labelBackgroundColor: "#26262B" },
        horzLine: { color: "rgba(237,237,239,0.3)", style: LineStyle.Dashed, labelBackgroundColor: "#26262B" },
      },
      handleScroll: false,
      handleScale: false,
    });
    for (const s of series) {
      const data = s.data.map((d) => ({ time: Math.floor(d.t / 1000) as UTCTimestamp, value: d.v, ...(d.color ? { color: d.color } : {}) }));
      const common = { priceLineVisible: false, lastValueVisible: true, priceScaleId: s.scaleId ?? "right" };
      if (s.kind === "area") {
        c.addSeries(AreaSeries, { ...common, lineColor: s.color, lineWidth: 2, topColor: s.color + "55", bottomColor: s.color + "05" }).setData(data);
      } else if (s.kind === "line") {
        const ls = c.addSeries(LineSeries, { ...common, color: s.color, lineWidth: 2, crosshairMarkerRadius: 3 });
        ls.setData(data);
        if (zeroLine) ls.createPriceLine({ price: 0, color: "rgba(237,237,239,0.18)", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: "" });
      } else {
        c.addSeries(HistogramSeries, { ...common, color: s.color }).setData(data);
      }
    }
    c.timeScale().fitContent();
    chartRef.current = c;
    return () => { c.remove(); chartRef.current = null; };
  }, [series, format, zeroLine, hasData]);

  if (!hasData) return <div className="h-full flex items-center justify-center text-[12px] text-txt-muted text-center px-6">{empty ?? "No data yet"}</div>;
  return <div ref={el} className="w-full h-full" />;
}

/** Simple signed bar chart (SVG): green above zero, orange-red below. */
export function BarChart({ data, format, highlight, xEvery = 1 }: { data: { label: string; value: number }[]; format: (v: number) => string; highlight?: number; xEvery?: number }) {
  const W = 600, H = 210, padR = 46, padB = 22, padT = 8;
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1e-9);
  const plotW = W - padR;
  const plotH = H - padB - padT;
  const zeroY = padT + plotH / 2;
  const bw = plotW / data.length;
  const ticks = [max, max / 2, 0, -max / 2, -max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      {highlight != null && highlight >= 0 && highlight < data.length && (
        <rect x={highlight * bw + 1} y={padT} width={bw - 2} height={plotH} fill="rgba(255,255,255,0.04)" />
      )}
      <line x1={0} x2={plotW} y1={zeroY} y2={zeroY} stroke="rgba(237,237,239,0.18)" strokeWidth={1} />
      {data.map((d, i) => {
        const h = (Math.abs(d.value) / max) * (plotH / 2);
        const y = d.value >= 0 ? zeroY - h : zeroY;
        return (
          <g key={d.label}>
            <rect x={i * bw + bw * 0.18} y={y} width={bw * 0.64} height={Math.max(1, h)} fill={d.value >= 0 ? "#1FB880" : "#F0643C"} rx={1}>
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
            {i % xEvery === 0 && (
              <text x={i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize={10.5} fill="#8A8A91" fontFamily={FONT}>{d.label}</text>
            )}
          </g>
        );
      })}
      {ticks.map((v, i) => (
        <text key={i} x={W - 4} y={padT + (i * plotH) / 4 + 3.5} textAnchor="end" fontSize={10.5} fill="#8A8A91" fontFamily={FONT}>{format(v)}</text>
      ))}
    </svg>
  );
}

export const Stat = ({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) => (
  <div className="flex flex-col items-center">
    <span className="text-[10.5px] uppercase tracking-[0.05em] text-txt-muted">{label}</span>
    <span className={cn("ds-num text-[15px] font-semibold", tone === "pos" ? "text-positive" : tone === "neg" ? "text-negative" : "text-txt-primary")}>{value}</span>
  </div>
);
