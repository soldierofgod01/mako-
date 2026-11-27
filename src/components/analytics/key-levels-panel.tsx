"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildKeyLevels, SOURCE_LABEL, type KeyLevel, type LevelSource } from "@/lib/levels/key-levels";
import type { VolState } from "@/lib/vol/use-vol";
import type { CohortsResponse } from "@/lib/hooks/use-orderflow";
import { fmtPrice } from "@/components/bias/bias-module";
import { useSize } from "./mini-chart";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Key levels view (Analytics): price with the ranked levels drawn
// across it, and the ranked list split above / below price.
// ════════════════════════════════════════════════════════════════

const SRC_COLOR: Record<LevelSource, string> = {
  gamma: "#B26BFF",
  basis: "#1FB880",
  liq: "#F5A524",
  swing: "#4C8DFF",
};

type Candle = { t: number; o: number; h: number; l: number; c: number };

function use1hCandles(coin: string) {
  return useQuery({
    queryKey: ["hl-1h-14d", coin],
    queryFn: async (): Promise<Candle[]> => {
      const now = Date.now();
      const r = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval: "1h", startTime: now - 15 * 86_400_000, endTime: now } }),
      });
      if (!r.ok) throw new Error("candles failed");
      const raw = (await r.json()) as { t: number; o: string; h: string; l: string; c: string }[];
      return raw.map((k) => ({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c }));
    },
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function KeyLevelsPanel({ coin, px, vol, cohorts }: {
  coin: string;
  px: number | null;
  vol: VolState;
  cohorts: CohortsResponse | null;
}) {
  const { data: candles } = use1hCandles(coin);
  const [hover, setHover] = useState<number | null>(null);

  const levels = useMemo(
    () => (px ? buildKeyLevels({
      px,
      gex: vol.surface?.gex ?? null,
      entries: cohorts?.data?.entries ?? null,
      liqs: cohorts?.data?.liqLevels ?? null,
      candles: candles ?? null,
    }) : []),
    [px, vol.surface, cohorts, candles],
  );

  const loading = !px || !candles;
  const above = levels.filter((l) => l.distPct > 0).sort((a, b) => a.distPct - b.distPct);
  const below = levels.filter((l) => l.distPct <= 0).sort((a, b) => b.distPct - a.distPct);
  const missing = [
    !vol.surface?.gex?.length && "gamma (no listed options for this coin)",
    !cohorts?.data && "wallet data",
  ].filter(Boolean) as string[];

  return (
    <div className="p-3 h-full flex flex-col gap-3">
      <div className="flex-1 min-h-0 flex gap-3">
        {/* Map */}
        <div className="flex-1 min-w-0 rounded-lg border border-border bg-[#0C0C0F] px-3 pt-2.5 pb-2 flex flex-col">
          <div className="flex items-baseline justify-between shrink-0">
            <span className="text-[13px] font-semibold text-txt-primary">Levels map</span>
            <span className="text-[12px] text-txt-muted">Last 7 days, 1h · line thickness = strength</span>
          </div>
          <div className="mt-2 flex-1 min-h-0 relative">
            {loading ? <div className="absolute inset-0 skeleton rounded" /> : (
              <LevelsMap candles={candles!.slice(-24 * 7)} px={px!} levels={levels} hover={hover} onHover={setHover} />
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-4 shrink-0">
            {(Object.keys(SRC_COLOR) as LevelSource[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5 text-[12px] text-txt-secondary">
                <span className="w-2 h-2 rounded-full" style={{ background: SRC_COLOR[s] }} />{SOURCE_LABEL[s]}
              </span>
            ))}
          </div>
        </div>

        {/* Ranked list */}
        <div className="w-[440px] shrink-0 rounded-lg border border-border bg-[#0C0C0F] flex flex-col min-h-0">
          <div className="h-11 px-4 flex items-center justify-between border-b border-border shrink-0">
            <span className="text-[13px] font-semibold text-txt-primary">Ranked levels</span>
            {px && <span className="ds-num text-[12.5px] text-txt-secondary">Price {fmtPrice(px)}</span>}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {loading ? (
              <div className="p-3 flex flex-col gap-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[58px] skeleton rounded" />)}</div>
            ) : levels.length === 0 ? (
              <div className="p-4 text-[13px] text-txt-secondary">No levels within 15% of price.</div>
            ) : (
              <>
                <Group title="Above price" rows={above} all={levels} hover={hover} onHover={setHover} />
                <Group title="Below price" rows={below} all={levels} hover={hover} onHover={setHover} />
              </>
            )}
          </div>
        </div>
      </div>
      <p className="shrink-0 text-[12px] text-txt-muted leading-[1.5]">
        Combines gamma strikes (Deribit), cost-basis and liquidation clusters (tracked Hyperliquid wallets) and 4h swing highs and lows (last 14 days),
        within 15% of price. Nearby levels merge; more independent sources agreeing ranks a level higher. A map of where things pile up, not a forecast.
        {missing.length > 0 && ` Missing for ${coin}: ${missing.join(", ")}.`}
      </p>
    </div>
  );
}

function Group({ title, rows, all, hover, onHover }: {
  title: string; rows: KeyLevel[]; all: KeyLevel[]; hover: number | null; onHover: (i: number | null) => void;
}) {
  if (!rows.length) return null;
  return (
    <div>
      <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-[0.06em] text-txt-muted">{title}</div>
      {rows.map((l) => {
        const i = all.indexOf(l);
        return (
          <div
            key={l.px}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
            className={cn("px-4 py-2.5 border-b border-border/60 last:border-0 cursor-default", hover === i && "bg-elevated")}
          >
            <div className="flex items-center gap-3">
              <span className="ds-num text-[15px] font-semibold text-txt-primary w-[92px]">{fmtPrice(l.px)}</span>
              <span className={cn("ds-num text-[12.5px] w-[58px]", l.distPct > 0 ? "text-negative" : "text-positive")}>
                {l.distPct > 0 ? "+" : ""}{l.distPct.toFixed(2)}%
              </span>
              <span className={cn(
                "text-[11.5px] font-medium px-2 py-0.5 rounded-full",
                l.strength === "Strong" ? "bg-white/90 text-black" : l.strength === "Medium" ? "bg-elevated-2 text-txt-primary" : "text-txt-muted",
              )}>{l.strength}</span>
              <span className="ml-auto flex gap-1">
                {l.sources.map((s) => <span key={s} className="w-2 h-2 rounded-full" style={{ background: SRC_COLOR[s] }} title={SOURCE_LABEL[s]} />)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {dedupe(l).map((p) => (
                <span key={p.label + p.px} className="text-[12px] text-txt-secondary">
                  <span style={{ color: SRC_COLOR[p.source] }}>●</span> {p.label}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Show the biggest piece of each source (plus a second if it's large), so rows stay short. */
function dedupe(l: KeyLevel) {
  const out: KeyLevel["parts"] = [];
  for (const s of l.sources) {
    const ps = l.parts.filter((p) => p.source === s).sort((a, b) => b.weight - a.weight);
    out.push(ps[0]);
    if (ps[1] && ps[1].weight > 0.6) out.push(ps[1]);
  }
  return out;
}

// ─── Map: price line + level lines ──────────────────────────────

function LevelsMap({ candles, px, levels, hover, onHover }: {
  candles: Candle[]; px: number; levels: KeyLevel[]; hover: number | null; onHover: (i: number | null) => void;
}) {
  const [ref, w, h] = useSize<HTMLDivElement>();
  const L = 6, R = 132, T = 10, B = 22;
  const prices = [...candles.flatMap((k) => [k.h, k.l]), ...levels.map((l) => l.px)];
  let lo = Math.min(...prices), hi = Math.max(...prices);
  const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  const pw = Math.max(1, w - L - R), ph = Math.max(1, h - T - B);
  const X = (i: number) => L + (i / Math.max(1, candles.length - 1)) * pw;
  const Y = (v: number) => T + ph - ((v - lo) / (hi - lo)) * ph;
  const maxScore = Math.max(...levels.map((l) => l.score), 1);
  // Keep right-edge labels from overlapping: nudge apart by at least 14px, strongest first.
  const labelY = new Map<number, number>();
  const placed: number[] = [];
  [...levels].sort((a, b) => b.score - a.score).forEach((l) => {
    let y = Y(l.px);
    for (let k = 0; k < 20 && placed.some((p) => Math.abs(p - y) < 14); k++) y += (k % 2 ? -1 : 1) * 14 * Math.ceil((k + 1) / 2);
    placed.push(y); labelY.set(l.px, y);
  });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (candles.length - 1)));

  return (
    <div ref={ref} className="absolute inset-0">
      {w > 0 && h > 0 && (
        <svg width={w} height={h} className="block">
          {levels.map((l, i) => {
            const y = Y(l.px), strong = l.score / maxScore, on = hover === i;
            const col = l.distPct > 0 ? "248,113,113" : "52,211,153";
            return (
              <g key={l.px} onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)} style={{ cursor: "default" }}>
                <line x1={L} x2={L + pw} y1={y} y2={y} stroke={`rgba(${col},${on ? 0.95 : 0.25 + 0.5 * strong})`} strokeWidth={on ? 2.5 : 0.8 + 2.2 * strong} />
                <line x1={L + pw} x2={L + pw + 8} y1={y} y2={labelY.get(l.px)!} stroke="rgba(255,255,255,0.15)" />
                <g transform={`translate(${L + pw + 10}, ${labelY.get(l.px)! + 4})`}>
                  {l.sources.map((s, k) => <circle key={s} cx={k * 7 + 3} cy={-4} r={2.6} fill={SRC_COLOR[s]} />)}
                  <text x={l.sources.length * 7 + 4} y={0} fontSize={11.5} fontFamily="var(--font-mono, ui-monospace)" fill={on ? "#FFFFFF" : "#C2C2C8"}>{fmtPrice(l.px)}</text>
                </g>
                <rect x={L} width={pw} y={y - 5} height={10} fill="transparent" />
              </g>
            );
          })}
          <path d={candles.map((k, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(k.c).toFixed(1)}`).join("")} fill="none" stroke="#E4E4E7" strokeWidth={1.5} />
          <line x1={L} x2={L + pw} y1={Y(px)} y2={Y(px)} stroke="rgba(255,255,255,0.5)" strokeDasharray="3 3" />
          <circle cx={X(candles.length - 1)} cy={Y(px)} r={3.5} fill="#FFFFFF" />
          {ticks.map((i, k) => (
            <text key={k} x={X(i)} y={h - 6} fontSize={11} fill="#8A8A91" textAnchor={k === 0 ? "start" : k === ticks.length - 1 ? "end" : "middle"}>
              {new Date(candles[i].t).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}
