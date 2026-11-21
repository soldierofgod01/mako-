// ════════════════════════════════════════════════════════════════
// Custom lightweight-charts layers (series primitives). They draw INSIDE
// the chart canvas, so they pan / zoom / rescale exactly with the candles.
//   HeatmapLayer   — resting order-book liquidity over time (behind candles)
//   FootprintLayer — buy × sell volume per price row inside each candle
//   BubbleLayer    — large trades at their exact price and time
// ════════════════════════════════════════════════════════════════

import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { Trade } from "@/lib/bias/engine";
import { heatColor, heatScale, imbalanceAt, type FootprintBar, type HeatFrame } from "@/lib/bias/footprint";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

const k = (usd: number) => {
  const a = Math.abs(usd);
  if (a >= 1e6) return `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return a >= 1 ? a.toFixed(0) : "";
};

/** Maps an epoch-ms time to an x coordinate, including inside a bar and past the last bar. */
class TimeMap {
  private lastT: number;
  private lastX: number | null;
  readonly spacing: number;
  constructor(private chart: IChartApi, private times: number[], private iv: number) {
    const ts = chart.timeScale();
    this.lastT = times[times.length - 1] ?? 0;
    this.lastX = times.length ? ts.timeToCoordinate((this.lastT / 1000) as Time) : null;
    const prevX = times.length > 1 ? ts.timeToCoordinate((times[times.length - 2] / 1000) as Time) : null;
    this.spacing = this.lastX != null && prevX != null ? Math.max(0.5, this.lastX - prevX) : 6;
  }
  barX(bt: number): number | null {
    const x = this.chart.timeScale().timeToCoordinate((bt / 1000) as Time);
    if (x != null) return x;
    if (this.lastX == null) return null;
    return this.lastX + ((bt - this.lastT) / this.iv) * this.spacing;
  }
  x(t: number): number | null {
    const bt = Math.floor(t / this.iv) * this.iv;
    const c = this.barX(bt);
    if (c == null) return null;
    return c - this.spacing / 2 + ((t - bt) / this.iv) * this.spacing;
  }
}

abstract class Layer implements ISeriesPrimitive<Time> {
  protected chart: IChartApi | null = null;
  protected series: ISeriesApi<SeriesType> | null = null;
  private request: (() => void) | null = null;
  times: number[] = [];
  iv = 60_000;
  enabled = true;

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart;
    this.series = p.series;
    this.request = p.requestUpdate;
  }
  detached() {
    this.chart = null;
    this.series = null;
    this.request = null;
  }
  refresh() {
    this.request?.();
  }
  protected timeMap() {
    return this.chart && this.times.length ? new TimeMap(this.chart, this.times, this.iv) : null;
  }
  abstract paneViews(): readonly IPrimitivePaneView[];
}

class View implements IPrimitivePaneView {
  constructor(private z: PrimitivePaneViewZOrder, private draw: (t: Target) => void) {}
  zOrder() { return this.z; }
  renderer(): IPrimitivePaneRenderer {
    return { draw: (t) => { try { this.draw(t); } catch { /* never break the chart */ } } };
  }
}

// ─── Heatmap ─────────────────────────────────────────────────────
export class HeatmapLayer extends Layer {
  frames: HeatFrame[] = [];
  private view = new View("bottom", (target) => this.drawHeat(target));
  paneViews() { return this.enabled ? [this.view] : []; }

  private drawHeat(target: Target) {
    const tm = this.timeMap();
    const s = this.series;
    if (!tm || !s || this.frames.length < 2) return;
    const coarse = this.frames.filter((f) => f.coarse);
    const fine = this.frames.filter((f) => !f.coarse);
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
      const W = bitmapSize.width;
      const H = bitmapSize.height;
      const pass = (frames: HeatFrame[], dim: number) => {
        if (frames.length < 2) return;
        // Normalise each book separately; 98th pct so only real walls saturate.
        const scale = heatScale(frames.slice(-300), 0.98);
        let prevX2 = -Infinity;
        for (let i = 0; i < frames.length; i++) {
          const f = frames[i];
          const next = frames[i + 1];
          const t2 = next ? next.t : Math.min(Date.now(), f.t + 15_000);
          const xa = tm.x(f.t);
          const xb = tm.x(t2);
          if (xa == null || xb == null) continue;
          let x1 = Math.round(xa * hr);
          const x2 = Math.round(xb * hr);
          if (x2 <= 0 || x1 >= W) continue;
          if (x1 < prevX2) x1 = prevX2;
          if (x2 - x1 < 1) continue;
          prevX2 = x2;
          for (const [px, usd] of f.levels) {
            const v = usd / scale;
            if (v < 0.1) continue;
            const ya = s.priceToCoordinate(px + f.tick / 2);
            const yb = s.priceToCoordinate(px - f.tick / 2);
            if (ya == null || yb == null) continue;
            const y1 = Math.round(Math.min(ya, yb) * vr);
            const y2 = Math.round(Math.max(ya, yb) * vr);
            if (y2 <= 0 || y1 >= H) continue;
            ctx.globalAlpha = dim;
            ctx.fillStyle = heatColor(v);
            ctx.fillRect(x1, y1, x2 - x1, Math.max(1, y2 - y1));
          }
        }
        ctx.globalAlpha = 1;
      };
      pass(coarse, 0.45); // wide, blocky context at the edges
      pass(fine, 1);      // full resolution near price, on top
    });
  }
}

// ─── Volume profile (session, right edge of the price pane) ──────
export class ProfileLayer extends Layer {
  bins: { lo: number; hi: number; vol: number; buy: number; sell: number }[] = [];
  poc = 0;
  vah = 0;
  val = 0;
  /** Share of the pane width the longest row takes. */
  widthFrac = 0.22;
  private view = new View("normal", (target) => this.drawProfile(target));
  paneViews() { return this.enabled ? [this.view] : []; }

  // Rows are split buy (left part, green) | sell (right part, red), anchored to the
  // right edge. Value area brighter, outside dimmer, POC row brightest.
  private drawProfile(target: Target) {
    const s = this.series;
    if (!s || !this.bins.length) return;
    let maxV = 1;
    for (const b of this.bins) if (b.vol > maxV) maxV = b.vol;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const right = mediaSize.width - 2;
      const maxW = mediaSize.width * this.widthFrac;
      for (const b of this.bins) {
        const ya = s.priceToCoordinate(b.hi);
        const yb = s.priceToCoordinate(b.lo);
        if (ya == null || yb == null) continue;
        const top = Math.min(ya, yb);
        const h = Math.max(1, Math.abs(yb - ya) - (Math.abs(yb - ya) > 3 ? 1 : 0));
        if (top > mediaSize.height || top + h < 0) continue;
        const w = (b.vol / maxV) * maxW;
        if (w < 0.5) continue;
        const mid = (b.lo + b.hi) / 2;
        const isPoc = this.poc >= b.lo && this.poc <= b.hi;
        const inVa = mid >= this.val && mid <= this.vah;
        const a = isPoc ? 0.62 : inVa ? 0.36 : 0.15;
        const wb = b.vol > 0 ? w * (b.buy / b.vol) : 0;
        ctx.fillStyle = `rgba(31,184,128,${a})`;
        ctx.fillRect(right - w, top, wb, h);
        ctx.fillStyle = `rgba(239,68,68,${a})`;
        ctx.fillRect(right - w + wb, top, w - wb, h);
        if (isPoc) {
          ctx.fillStyle = "rgba(237,237,239,0.85)";
          ctx.fillRect(right - w, top, 1.5, h);
        }
      }
    });
  }
}

// ─── Band fill (VWAP ±1σ) ────────────────────────────────────────
export class BandLayer extends Layer {
  points: { t: number; lo: number; hi: number }[] = [];
  color = "rgba(224,179,65,0.04)";
  private view = new View("bottom", (target) => this.drawBand(target));
  paneViews() { return this.enabled ? [this.view] : []; }

  private drawBand(target: Target) {
    const tm = this.timeMap();
    const s = this.series;
    if (!tm || !s || this.points.length < 2) return;
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      // One polygon per UTC day (VWAP resets daily — don't bridge the gap).
      let seg: { x: number; lo: number; hi: number }[] = [];
      let day = -1;
      const flush = () => {
        if (seg.length > 1) {
          ctx.beginPath();
          seg.forEach((p, i) => (i ? ctx.lineTo(p.x, p.hi) : ctx.moveTo(p.x, p.hi)));
          for (let i = seg.length - 1; i >= 0; i--) ctx.lineTo(seg[i].x, seg[i].lo);
          ctx.closePath();
          ctx.fillStyle = this.color;
          ctx.fill();
        }
        seg = [];
      };
      for (const p of this.points) {
        const d = Math.floor(p.t / 86_400_000);
        if (d !== day) { flush(); day = d; }
        const x = tm.barX(p.t);
        const yh = s.priceToCoordinate(p.hi);
        const yl = s.priceToCoordinate(p.lo);
        if (x == null || yh == null || yl == null) continue;
        seg.push({ x, lo: yl, hi: yh });
      }
      flush();
    });
  }
}

// ─── Footprint ───────────────────────────────────────────────────
export class FootprintLayer extends Layer {
  bars: Map<number, FootprintBar> = new Map();
  row = 1;
  private view = new View("top", (target) => this.drawFp(target));
  paneViews() { return this.enabled ? [this.view] : []; }

  private drawFp(target: Target) {
    const tm = this.timeMap();
    const s = this.series;
    if (!tm || !s || !this.bars.size) return;
    const width = tm.spacing * 0.88;
    const yRow = (px: number) => {
      const a = s.priceToCoordinate(px + this.row);
      const b = s.priceToCoordinate(px);
      return a == null || b == null ? null : { top: Math.min(a, b), h: Math.abs(b - a) };
    };
    // Normalise colour by the busiest visible row.
    let maxRow = 1;
    for (const b of this.bars.values()) for (const r of b.rows) maxRow = Math.max(maxRow, r.buy + r.sell);
    const sample = yRow(this.times.length ? (this.bars.values().next().value?.pocPx ?? 0) : 0);
    const rowH = sample?.h ?? 0;
    const textMode = width >= 46 && rowH >= 10;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.font = `${Math.min(10, Math.max(8, rowH - 2))}px "JetBrains Mono", monospace`;
      ctx.textBaseline = "middle";
      for (const bar of this.bars.values()) {
        const xc = tm.barX(bar.t);
        if (xc == null || xc + width < 0 || xc - width > mediaSize.width) continue;
        const x0 = xc - width / 2;
        const minUsd = maxRow * 0.02;
        bar.rows.forEach((r, i) => {
          const y = yRow(r.px);
          if (!y || y.top > mediaSize.height || y.top + y.h < 0) return;
          const tot = r.buy + r.sell;
          const net = r.buy - r.sell;
          const a = 0.12 + 0.6 * Math.sqrt(tot / maxRow);
          ctx.fillStyle = net >= 0 ? `rgba(31,184,128,${a.toFixed(3)})` : `rgba(239,68,68,${a.toFixed(3)})`;
          ctx.fillRect(x0, y.top + 0.5, width, Math.max(1, y.h - 1));
          const imb = imbalanceAt(bar.rows, i, 3, minUsd);
          if (imb !== 0) {
            ctx.fillStyle = imb === 1 ? "#33FFA3" : "#FF5C5C";
            ctx.fillRect(imb === 1 ? x0 + width - 2 : x0, y.top + 0.5, 2, Math.max(1, y.h - 1));
          }
          if (r.px === bar.pocPx) {
            ctx.strokeStyle = "rgba(237,237,239,0.9)";
            ctx.lineWidth = 1;
            ctx.strokeRect(x0 + 0.5, y.top + 0.5, width - 1, Math.max(1, y.h - 1));
          }
          if (textMode) {
            ctx.fillStyle = "rgba(237,237,239,0.92)";
            ctx.textAlign = "right";
            ctx.fillText(k(r.sell), xc - 3, y.top + y.h / 2);
            ctx.fillStyle = "rgba(155,155,160,0.8)";
            ctx.textAlign = "center";
            ctx.fillText("×", xc, y.top + y.h / 2);
            ctx.fillStyle = "rgba(237,237,239,0.92)";
            ctx.textAlign = "left";
            ctx.fillText(k(r.buy), xc + 4, y.top + y.h / 2);
          }
        });
      }
    });
  }
}

// ─── Bubbles ─────────────────────────────────────────────────────
export class BubbleLayer extends Layer {
  prints: Trade[] = [];
  /** Threshold the prints were filtered at — the smallest bubble. */
  minUsd = 25_000;
  private view = new View("top", (target) => this.drawBubbles(target));
  paneViews() { return this.enabled ? [this.view] : []; }

  // One bubble per big order at its average price. Area grows with size
  // (radius ∝ √size), colour by the side that hit, size printed inside when
  // it fits, beside it otherwise.
  private drawBubbles(target: Target) {
    const tm = this.timeMap();
    const s = this.series;
    if (!tm || !s || !this.prints.length) return;
    const sorted = [...this.prints].sort((a, b) => a.usd - b.usd);
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.textBaseline = "middle";
      for (const p of sorted) {
        const x = tm.x(p.t);
        const y = s.priceToCoordinate(p.px);
        if (x == null || y == null || x < -40 || x > mediaSize.width + 40) continue;
        const r = Math.min(30, 3 * Math.sqrt(p.usd / this.minUsd));
        const buy = p.side === 1;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = buy ? "rgba(31,184,128,0.35)" : "rgba(239,68,68,0.35)";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = buy ? "rgba(31,184,128,0.95)" : "rgba(239,68,68,0.95)";
        ctx.stroke();
        if (p.usd >= this.minUsd * 3) {
          const label = k(p.usd);
          ctx.font = `600 10px Inter, -apple-system, sans-serif`;
          const tw = ctx.measureText(label).width;
          if (tw + 6 <= r * 2) {
            ctx.textAlign = "center";
            ctx.fillStyle = "rgba(237,237,239,0.95)";
            ctx.fillText(label, x, y);
          } else {
            ctx.textAlign = "left";
            ctx.fillStyle = buy ? "rgba(31,184,128,1)" : "rgba(239,68,68,1)";
            ctx.fillText(label, x + r + 3, y);
          }
        }
      }
    });
  }
}

// ─── Bar statistics (MotiveWave-style rows under the chart) ──────
export interface BarStat { t: number; vol: number; delta: number | null; buy: number; sell: number; cvd: number | null }

export const BAR_STAT_ROWS = ["Volume", "Delta", "Delta %", "CVD"] as const;

/** Heat-cell table docked under the price pane: one column per bar, one row per statistic. */
export class BarStatsLayer extends Layer {
  stats: BarStat[] = [];
  private view = new View("top", (target) => this.drawStats(target));
  paneViews() { return this.enabled ? [this.view] : []; }

  private drawStats(target: Target) {
    const tm = this.timeMap();
    if (!tm || !this.stats.length) return;
    const p90 = (xs: number[]) => { const a = xs.filter((x) => isFinite(x)).map(Math.abs).sort((x, y) => x - y); return a[Math.floor(a.length * 0.9)] || 1; };
    const vP = p90(this.stats.map((x) => x.vol));
    const dP = p90(this.stats.filter((x) => x.delta != null).map((x) => x.delta!));
    const cP = p90(this.stats.filter((x) => x.cvd != null).map((x) => x.cvd!));
    const heat = (v: number, scale: number) => Math.min(1, Math.abs(v) / scale);
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const rows = BAR_STAT_ROWS.length;
      const rh = mediaSize.height / rows;
      const w = tm.spacing;
      const text = w >= 38 && rh >= 12;
      ctx.font = `${Math.min(10.5, rh - 4)}px "JetBrains Mono", monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const b of this.stats) {
        const xc = tm.barX(b.t);
        if (xc == null || xc + w < 0 || xc - w > mediaSize.width) continue;
        const x0 = xc - w / 2;
        const cw = w + 0.6; // contiguous cells, no gaps
        const tot = b.buy + b.sell;
        const cells: [string, string | null][] = [
          [`rgba(170,170,178,${(0.08 + 0.62 * heat(b.vol, vP)).toFixed(3)})`, k(b.vol) || "0"],
          b.delta == null ? ["rgba(0,0,0,0)", null] : [b.delta >= 0 ? `rgba(31,184,128,${(0.1 + 0.8 * heat(b.delta, dP)).toFixed(3)})` : `rgba(239,68,68,${(0.1 + 0.8 * heat(b.delta, dP)).toFixed(3)})`, `${b.delta < 0 ? "−" : ""}${k(b.delta) || "0"}`],
          b.delta == null || tot <= 0 ? ["rgba(0,0,0,0)", null] : (() => { const pct = b.delta! / tot; return [pct >= 0 ? `rgba(31,184,128,${(0.1 + 0.8 * Math.min(1, Math.abs(pct) / 0.5)).toFixed(3)})` : `rgba(239,68,68,${(0.1 + 0.8 * Math.min(1, Math.abs(pct) / 0.5)).toFixed(3)})`, `${Math.round(pct * 100)}%`] as [string, string]; })(),
          b.cvd == null ? ["rgba(0,0,0,0)", null] : [b.cvd >= 0 ? `rgba(31,184,128,${(0.1 + 0.7 * heat(b.cvd, cP)).toFixed(3)})` : `rgba(239,68,68,${(0.1 + 0.7 * heat(b.cvd, cP)).toFixed(3)})`, `${b.cvd < 0 ? "−" : ""}${k(b.cvd) || "0"}`],
        ];
        cells.forEach(([fill, label], i) => {
          ctx.fillStyle = fill;
          ctx.fillRect(x0, i * rh, cw, rh - (i < rows - 1 ? 1 : 0));
          if (text && label) {
            ctx.fillStyle = "rgba(237,237,239,0.92)";
            ctx.fillText(label, xc, i * rh + rh / 2);
          }
        });
      }
      // Row labels pinned to the left edge.
      ctx.textAlign = "left";
      ctx.font = `10px Inter, -apple-system, sans-serif`;
      BAR_STAT_ROWS.forEach((l, i) => {
        ctx.fillStyle = "rgba(7,7,9,0.88)";
        ctx.fillRect(0, i * rh, 52, rh - 1);
        ctx.fillStyle = "rgba(170,170,178,0.95)";
        ctx.fillText(l, 6, i * rh + rh / 2);
      });
    });
  }
}

// ─── Absorption: box + dot around the flagged candles ────────────
export class AbsorptionBoxLayer extends Layer {
  boxes: { t: number; h: number; l: number; side: 1 | -1 }[] = [];
  private view = new View("top", (target) => this.drawBoxes(target));
  paneViews() { return this.enabled ? [this.view] : []; }

  private drawBoxes(target: Target) {
    const tm = this.timeMap();
    const s = this.series;
    if (!tm || !s || !this.boxes.length) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const w = Math.max(5, tm.spacing * 0.95);
      for (const b of this.boxes) {
        const xc = tm.barX(b.t);
        const yh = s.priceToCoordinate(b.h);
        const yl = s.priceToCoordinate(b.l);
        if (xc == null || yh == null || yl == null || xc < -20 || xc > mediaSize.width + 20) continue;
        // Buyers absorbed (side +1) is bearish → amber; sellers absorbed → sky.
        const col = b.side === 1 ? "245,158,11" : "56,189,248";
        const top = Math.min(yh, yl) - 3, bot = Math.max(yh, yl) + 3;
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(${col},0.9)`;
        ctx.strokeRect(xc - w / 2, top, w, bot - top);
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(${col},0.1)`;
        ctx.fillRect(xc - w / 2, top, w, bot - top);
        ctx.beginPath();
        ctx.arc(xc, b.side === 1 ? top - 5 : bot + 5, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${col},1)`;
        ctx.fill();
      }
    });
  }
}

// ─── Candle close countdown ──────────────────────────────────────
// A second price-axis label sitting directly under the last-price label,
// TradingView-style: time left until the current bar closes.
export class CountdownLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private request: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Price the last-value label sits at (the current bar's close). */
  price: number | null = null;
  /** Epoch ms when the current bar closes. */
  endsAt: number | null = null;
  back = "#26262B";
  text = "#EDEDEF";
  enabled = true;

  private view: ISeriesPrimitiveAxisView = {
    coordinate: () => {
      const y = this.price != null ? this.series?.priceToCoordinate(this.price) : null;
      if (y == null) return -1000;
      // Last-value label height = fontSize + 2 × (2.5/12 × fontSize) in lightweight-charts.
      const fs = this.chart?.options().layout.fontSize ?? 11;
      return y + fs * (1 + 5 / 12);
    },
    text: () => fmtLeft(this.endsAt != null ? this.endsAt - Date.now() : 0),
    textColor: () => this.text,
    backColor: () => this.back,
    visible: () => this.enabled && this.price != null && this.endsAt != null && this.endsAt > Date.now(),
    tickVisible: () => false,
  };

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart;
    this.series = p.series;
    this.request = p.requestUpdate;
    this.timer = setInterval(() => this.request?.(), 1000);
  }
  detached() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.chart = null;
    this.series = null;
    this.request = null;
  }
  refresh() { this.request?.(); }
  priceAxisViews() { return [this.view]; }
  paneViews() { return []; }
}

function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${p(h)}h`;
  if (h > 0) return `${p(h)}:${p(m)}:${p(sec)}`;
  return `${p(m)}:${p(sec)}`;
}
