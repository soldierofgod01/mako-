"use client";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Small SVG charts for the Analytics "Now" tabs.
// • Sparkline — a metric's history with its normal range (20th–80th pct) shaded,
//   Glassnode Market Pulse style, and the current value marked.
// • XYChart — numeric x (expiry days, strike), for term structure and smile.
// Measured width (no viewBox stretching), so strokes and dots stay crisp.
// ════════════════════════════════════════════════════════════════

/** Size of an element, re-measured on resize. Callback ref, so it works even when the element mounts after the first render. */
export function useSize<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ref = useCallback((el: T | null) => {
    setNode(el);
    if (el) { const r = el.getBoundingClientRect(); setSize({ w: Math.floor(r.width), h: Math.floor(r.height) }); }
  }, []);
  useEffect(() => {
    if (!node) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  return [ref, size.w, size.h] as const;
}
export function useWidth<T extends HTMLElement>() {
  const [ref, w] = useSize<T>();
  return [ref, w] as const;
}

const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// ─── Sparkline ──────────────────────────────────────────────────

export function Sparkline({
  series, range, bars, format, height, fill, color = "#D4D4D8", signed,
}: {
  series: { t: number; v: number }[];
  range?: { lo: number; hi: number };
  bars?: boolean;
  format: (v: number) => string;
  height?: number;
  /** Grow to the parent's height (parent must be a flex column). */
  fill?: boolean;
  /** Series colour (line, bars, band tint, current-value dot). */
  color?: string;
  /** Bars whose sign means direction (net flow): green above zero, red below. */
  signed?: boolean;
}) {
  const [ref, w, mh] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (series.length < 2) return <div className="h-[52px]" />;

  const vs = series.map((p) => p.v);
  let lo = Math.min(...vs, range?.lo ?? Infinity, bars ? 0 : Infinity);
  let hi = Math.max(...vs, range?.hi ?? -Infinity, bars ? 0 : -Infinity);
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const H = fill ? Math.max(44, mh) : height ?? 52, PADX = 2;
  const x = (i: number) => PADX + (i / (series.length - 1)) * Math.max(1, w - PADX * 2 - 4);
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const last = series[series.length - 1];
  const inBand = range ? last.v >= range.lo && last.v <= range.hi : true;
  const POS = "#1FB880", NEG = "#F0643C";
  const barCol = (v: number, isLast: boolean) => {
    const base = signed ? (v >= 0 ? POS : NEG) : color;
    return isLast ? base : `${base}${signed ? "8C" : "4D"}`; // last bar solid, history ~55% / 30%
  };
  const hv = hover != null ? series[hover] : null;

  return (
    <div
      ref={ref}
      className={cn("relative mt-2", fill && "flex-1 min-h-[44px]")}
      style={fill ? undefined : { height: H }}
      onMouseMove={(e) => {
        if (!w) return;
        const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const i = bars
          ? Math.floor(((e.clientX - r.left) / w) * series.length)
          : Math.round(((e.clientX - r.left - PADX) / Math.max(1, w - PADX * 2 - 4)) * (series.length - 1));
        setHover(Math.max(0, Math.min(series.length - 1, i)));
      }}
      onMouseLeave={() => setHover(null)}
    >
      {w > 0 && (
        <svg width={w} height={H} className="block overflow-visible">
          {range && (
            <rect x={0} width={w} y={y(range.hi)} height={Math.max(1, y(range.lo) - y(range.hi))} fill={signed ? "rgba(255,255,255,0.05)" : `${color}14`} />
          )}
          {range && <line x1={0} x2={w} y1={y(range.hi)} y2={y(range.hi)} stroke={signed ? "rgba(255,255,255,0.14)" : `${color}40`} strokeDasharray="2 3" />}
          {range && <line x1={0} x2={w} y1={y(range.lo)} y2={y(range.lo)} stroke={signed ? "rgba(255,255,255,0.14)" : `${color}40`} strokeDasharray="2 3" />}
          {bars ? (
            series.map((p, i) => {
              // Each bar gets an equal slot across the width (works for 5 bars or 90).
              const slot = w / series.length;
              const bw = Math.max(1, Math.min(slot - 1.5, 28));
              const y0 = y(0), y1 = y(p.v);
              return (
                <rect key={p.t} x={i * slot + (slot - bw) / 2} width={bw} y={Math.min(y0, y1)} height={Math.max(1, Math.abs(y1 - y0))}
                  fill={barCol(p.v, i === series.length - 1)} />
              );
            })
          ) : (
            <path d={series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("")} fill="none" stroke={color} strokeOpacity={0.9} strokeWidth={1.5} />
          )}
          {!bars && !inBand && <circle cx={x(series.length - 1)} cy={y(last.v)} r={7} fill={color} fillOpacity={0.22} />}
          {!bars && <circle cx={x(series.length - 1)} cy={y(last.v)} r={3} fill={inBand ? color : "#FFFFFF"} stroke={inBand ? undefined : color} strokeWidth={inBand ? 0 : 1.5} />}
          {hv && hover != null && !bars && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="rgba(255,255,255,0.25)" />}
        </svg>
      )}
      {hv && (
        <div className="pointer-events-none absolute -top-6 right-0 ds-num text-[11.5px] text-txt-primary bg-elevated-2 rounded px-1.5 py-0.5 whitespace-nowrap">
          {fmtDate(hv.t)} · {format(hv.v)}
        </div>
      )}
    </div>
  );
}

// ─── XY chart ───────────────────────────────────────────────────

export interface XYSeries { label: string; color: string; pts: { x: number; y: number }[]; dashed?: boolean }

export function XYChart({
  series, xFormat, yFormat, vlines = [], height: fixedH, className, xLabel,
}: {
  series: XYSeries[];
  xFormat: (x: number) => string;
  yFormat: (y: number) => string;
  vlines?: { x: number; label: string }[];
  /** Fixed height; omit to fill the parent (which needs a definite height). */
  height?: number;
  className?: string;
  xLabel?: string;
}) {
  const [ref, w, mh] = useSize<HTMLDivElement>();
  const height = fixedH ?? Math.max(160, mh);
  const [hx, setHx] = useState<number | null>(null);
  const all = series.flatMap((s) => s.pts);
  if (all.length < 2) return <div className={cn("flex items-center justify-center text-[13px] text-txt-secondary", className)} style={{ height }}>Not enough data.</div>;

  const L = 8, R = 52, T = 10, B = 22;
  const x0 = Math.min(...all.map((p) => p.x));
  let x1 = Math.max(...all.map((p) => p.x));
  let y0 = Math.min(...all.map((p) => p.y)), y1 = Math.max(...all.map((p) => p.y));
  if (x1 === x0) x1 += 1;
  const yp = (y1 - y0 || 1) * 0.12; y0 -= yp; y1 += yp;
  const pw = Math.max(1, w - L - R), ph = height - T - B;
  const X = (v: number) => L + ((v - x0) / (x1 - x0)) * pw;
  const Y = (v: number) => T + ph - ((v - y0) / (y1 - y0)) * ph;
  const yTicks = [0, 0.5, 1].map((f) => y0 + yp + (y1 - y0 - 2 * yp) * f);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => x0 + (x1 - x0) * f);
  const nearest = (s: XYSeries, xv: number) => s.pts.reduce((b, p) => (Math.abs(p.x - xv) < Math.abs(b.x - xv) ? p : b), s.pts[0]);

  return (
    <div className={cn("relative", fixedH == null && "h-full", className)}>
      <div
        ref={ref}
        style={fixedH != null ? { height: fixedH } : { position: "absolute", inset: 0 }}
        onMouseMove={(e) => {
          if (!w) return;
          const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          const xv = x0 + ((e.clientX - r.left - L) / pw) * (x1 - x0);
          setHx(Math.max(x0, Math.min(x1, xv)));
        }}
        onMouseLeave={() => setHx(null)}
      >
        {w > 0 && (
          <svg width={w} height={height} className="block">
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={L} x2={L + pw} y1={Y(v)} y2={Y(v)} stroke="rgba(255,255,255,0.05)" />
                <text x={L + pw + 6} y={Y(v) + 4} className="fill-[#8A8A91]" fontSize={11} fontFamily="var(--font-mono, ui-monospace)">{yFormat(v)}</text>
              </g>
            ))}
            {xTicks.map((v, i) => (
              <text key={i} x={X(v)} y={height - 6} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"} className="fill-[#8A8A91]" fontSize={11} fontFamily="var(--font-mono, ui-monospace)">{xFormat(v)}</text>
            ))}
            {vlines.filter((v) => v.x >= x0 && v.x <= x1).map((v) => (
              <g key={v.label}>
                <line x1={X(v.x)} x2={X(v.x)} y1={T} y2={T + ph} stroke="rgba(255,255,255,0.35)" strokeDasharray="3 3" />
                <text x={X(v.x) + 4} y={T + 10} className="fill-[#D4D4D8]" fontSize={11}>{v.label}</text>
              </g>
            ))}
            {series.map((s) => (
              <g key={s.label}>
                <path d={s.pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("")} fill="none" stroke={s.color} strokeWidth={1.8} strokeDasharray={s.dashed ? "4 3" : undefined} />
                {s.pts.length <= 24 && s.pts.map((p) => <circle key={p.x} cx={X(p.x)} cy={Y(p.y)} r={2.4} fill={s.color} />)}
              </g>
            ))}
            {hx != null && <line x1={X(hx)} x2={X(hx)} y1={T} y2={T + ph} stroke="rgba(255,255,255,0.2)" />}
          </svg>
        )}
      </div>
      {hx != null && (
        <div className="pointer-events-none absolute top-1 left-3 ds-num text-[11.5px] bg-elevated-2 rounded px-2 py-1 leading-[1.5]">
          <div className="text-txt-secondary">{xLabel ? `${xLabel} ` : ""}{xFormat(hx)}</div>
          {series.map((s) => { const p = nearest(s, hx); return <div key={s.label} style={{ color: s.color }}>{s.label} {yFormat(p.y)}</div>; })}
        </div>
      )}
    </div>
  );
}

// ─── Entry map (trader cost basis) ──────────────────────────────

/**
 * Mirror histogram on a price axis: tracked longs' entries above the axis,
 * shorts' below, current price and each side's break-even marked.
 */
export function EntryMap({
  bins, px, longAvg, shortAvg, fmt, height: fixedH,
}: {
  bins: { lo: number; hi: number; long: number; short: number }[]; // ascending by price
  px: number;
  longAvg: number | null;
  shortAvg: number | null;
  fmt: (v: number) => string;
  /** Fixed height; omit to fill the parent (which needs a definite height). */
  height?: number;
}) {
  const [ref, w, mh] = useSize<HTMLDivElement>();
  const height = fixedH ?? Math.max(200, mh);
  const [hi, setHi] = useState<number | null>(null);
  if (!bins.length) return null;
  const L = 8, R = 8, T = 16, B = 24;
  const lo = bins[0].lo, top = bins[bins.length - 1].hi;
  const pw = Math.max(1, w - L - R), ph = height - T - B, mid = T + ph / 2;
  const X = (v: number) => L + ((v - lo) / (top - lo)) * pw;
  const max = Math.max(...bins.map((b) => Math.max(b.long, b.short)), 1);
  const bw = pw / bins.length;
  const hb = hi != null ? bins[hi] : null;
  const usd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`);
  const marks = [
    { v: px, label: "price", col: "#FFFFFF", dash: undefined as string | undefined },
    ...(longAvg ? [{ v: longAvg, label: "long b/e", col: "#1FB880", dash: "4 3" }] : []),
    ...(shortAvg ? [{ v: shortAvg, label: "short b/e", col: "#EF4444", dash: "4 3" }] : []),
  ].filter((m) => m.v >= lo && m.v <= top);

  return (
    <div className={cn("relative", fixedH == null && "h-full")}>
      <div
        ref={ref}
        style={fixedH != null ? { height: fixedH } : { position: "absolute", inset: 0 }}
        onMouseMove={(e) => {
          if (!w) return;
          const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          const i = Math.floor((e.clientX - r.left - L) / bw);
          setHi(i >= 0 && i < bins.length ? i : null);
        }}
        onMouseLeave={() => setHi(null)}
      >
        {w > 0 && (
          <svg width={w} height={height} className="block">
            <line x1={L} x2={L + pw} y1={mid} y2={mid} stroke="rgba(255,255,255,0.12)" />
            {bins.map((b, i) => {
              const hl = (b.long / max) * (ph / 2 - 4), hs = (b.short / max) * (ph / 2 - 4);
              return (
                <g key={i} opacity={hi == null || hi === i ? 1 : 0.55}>
                  {b.long > 0 && <rect x={L + i * bw + 0.5} width={Math.max(1, bw - 1)} y={mid - hl} height={hl} rx={1} fill="rgba(31,184,128,0.75)" />}
                  {b.short > 0 && <rect x={L + i * bw + 0.5} width={Math.max(1, bw - 1)} y={mid} height={hs} rx={1} fill="rgba(239,68,68,0.7)" />}
                </g>
              );
            })}
            {marks.map((m, i) => (
              <g key={m.label}>
                <line x1={X(m.v)} x2={X(m.v)} y1={T - 4} y2={T + ph} stroke={m.col} strokeOpacity={0.8} strokeDasharray={m.dash} />
                <text x={X(m.v) + 4} y={T + 6 + i * 13} fill={m.col} fontSize={11}>{m.label} {fmt(m.v)}</text>
              </g>
            ))}
            <text x={L} y={T + 6} fill="#8A8A91" fontSize={11} textAnchor="start" dx={pw - 4} style={{ textAnchor: "end" }}>longs ↑</text>
            <text x={L + pw - 4} y={T + ph - 2} fill="#8A8A91" fontSize={11} textAnchor="end">shorts ↓</text>
            {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
              <text key={f} x={L + pw * f} y={height - 6} fill="#8A8A91" fontSize={11} fontFamily="var(--font-mono, ui-monospace)" textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}>{fmt(lo + (top - lo) * f)}</text>
            ))}
          </svg>
        )}
      </div>
      {hb && (
        <div className="pointer-events-none absolute top-1 left-3 ds-num text-[11.5px] bg-elevated-2 rounded px-2 py-1 leading-[1.5]">
          <div className="text-txt-secondary">{fmt(hb.lo)} – {fmt(hb.hi)}</div>
          <div className="text-positive">Longs {usd(hb.long)}</div>
          <div className="text-negative">Shorts {usd(hb.short)}</div>
        </div>
      )}
    </div>
  );
}

// ─── Gauge (metrics without history) ────────────────────────────

/** Horizontal scale with a marker; `zones` shade the ends. For live-only readings. */
export function Gauge({ value, min, max, center, leftLabel, rightLabel, format, color }: {
  value: number; min: number; max: number; center?: number; leftLabel: string; rightLabel: string; format: (v: number) => string; color?: string;
}) {
  const pos = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const c = center != null ? (center - min) / (max - min) : null;
  return (
    <div className="mt-3 flex-1 flex flex-col justify-center">
      <div className="relative h-2 rounded-full bg-elevated">
        <div className="absolute inset-y-0 left-0 w-[20%] rounded-l-full bg-white/[0.06]" />
        <div className="absolute inset-y-0 right-0 w-[20%] rounded-r-full bg-white/[0.06]" />
        {c != null && <div className="absolute -inset-y-1 w-px bg-border-strong" style={{ left: `${c * 100}%` }} />}
        {color && (
          <div className="absolute inset-y-0 rounded-full" style={c != null
            ? { left: `${Math.min(c, pos) * 100}%`, width: `${Math.abs(pos - c) * 100}%`, background: `${color}59` }
            : { left: 0, width: `${pos * 100}%`, background: `${color}59` }} />
        )}
        <div className="absolute -top-[4px] w-[3px] h-4 rounded-full" style={{ left: `calc(${pos * 100}% - 1.5px)`, background: color ?? "var(--txt-primary, #EDEDEF)", boxShadow: color ? `0 0 0 3px ${color}33` : undefined }} />
      </div>
      <div className="flex justify-between mt-1.5 text-[11.5px] text-txt-muted">
        <span>{leftLabel} · {format(min)}</span>
        <span>{format(max)} · {rightLabel}</span>
      </div>
    </div>
  );
}
