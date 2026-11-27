"use client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildKeyLevels, SOURCE_LABEL, type KeyLevel, type LevelSource } from "@/lib/levels/key-levels";
import type { VolState } from "@/lib/vol/use-vol";
import type { CohortsResponse } from "@/lib/hooks/use-orderflow";
import { fmtPrice } from "@/components/bias/bias-module";
import { TimeChart, type SeriesSpec } from "./charts";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Key levels view (Analytics). Same building blocks as the other views:
// summary cards on top (like Market pulse), the Overview chart style with
// levels drawn as price lines, and level tiles in the Market pulse style.
// ════════════════════════════════════════════════════════════════

const PRICE_C = "#4C8DFF"; // same blue as the Overview price chart
const CARD = "rounded-lg border border-border bg-[#0C0C0F]";

type Candle = { t: number; h: number; l: number; c: number };

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
      const raw = (await r.json()) as { t: number; h: string; l: string; c: string }[];
      return raw.map((k) => ({ t: k.t, h: +k.h, l: +k.l, c: +k.c }));
    },
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

const pct = (d: number) => `${d > 0 ? "+" : ""}${d.toFixed(2)}%`;

export function KeyLevelsPanel({ coin, px, vol, cohorts }: {
  coin: string;
  px: number | null;
  vol: VolState;
  cohorts: CohortsResponse | null;
}) {
  const { data: candles } = use1hCandles(coin);

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

  const above = levels.filter((l) => l.distPct > 0).sort((a, b) => a.distPct - b.distPct);
  const below = levels.filter((l) => l.distPct <= 0).sort((a, b) => b.distPct - a.distPct);
  const strongest = levels[0] ?? null;
  const counts = { Strong: 0, Medium: 0, Weak: 0 };
  levels.forEach((l) => counts[l.strength]++);

  // Chart: 7 days of 1h closes + Strong (solid) and Medium (dashed) levels.
  const series = useMemo<SeriesSpec[]>(() => {
    if (!candles?.length) return [];
    return [{
      kind: "area",
      color: PRICE_C,
      data: candles.slice(-24 * 7).map((k) => ({ t: k.t, v: k.c })),
      priceLines: levels
        .filter((l) => l.strength !== "Weak")
        .map((l) => ({
          price: l.px,
          color: l.strength === "Strong" ? "rgba(237,237,239,0.85)" : "rgba(237,237,239,0.35)",
          width: l.strength === "Strong" ? 2 : 1,
          dashed: l.strength !== "Strong",
          title: l.strength,
        })),
    }];
  }, [candles, levels]);

  const missing = [
    !vol.surface?.gex?.length && "gamma (no listed options)",
    !cohorts?.data && "wallet data",
  ].filter(Boolean) as string[];
  const loading = !px || !candles;

  return (
    <div className="p-3 h-full flex flex-col gap-3">
      {/* Summary — same card style as Market pulse */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 shrink-0">
        <SummaryCard label="Nearest resistance" level={above[0]} loading={loading} />
        <SummaryCard label="Nearest support" level={below[0]} loading={loading} />
        <SummaryCard label="Strongest level" level={strongest} loading={loading} />
        <div className={cn(CARD, "px-4 py-3 flex items-center justify-between gap-3")}>
          <div className="min-w-0">
            <div className="text-[12px] text-txt-muted">Levels within 15%</div>
            <div className="text-[16px] font-semibold text-txt-primary mt-0.5">
              {loading ? "—" : `${counts.Strong} strong`}
              {!loading && <span className="text-[13px] font-medium text-txt-secondary"> · {counts.Medium} medium · {counts.Weak} weak</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-3 gap-3">
        {/* Chart — Overview style */}
        <section className={cn(CARD, "xl:col-span-2 flex flex-col min-w-0 min-h-[360px]")}>
          <h3 className="pt-3.5 text-center text-[13.5px] font-semibold text-txt-primary tracking-[-0.01em]">{coin} Price &amp; Key Levels</h3>
          <div className="flex-1 min-h-0 px-2 pt-2">
            {loading ? <div className="h-full skeleton rounded" /> : <TimeChart series={series} format={fmtPrice} />}
          </div>
          <div className="min-h-[34px] px-3 pb-2.5 pt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5 text-[11.5px] text-txt-secondary"><span className="w-4 h-[2px] rounded bg-[rgba(237,237,239,0.85)]" />Strong</span>
            <span className="flex items-center gap-1.5 text-[11.5px] text-txt-secondary"><span className="w-4 border-t border-dashed border-[rgba(237,237,239,0.5)]" />Medium</span>
            <span className="text-[11px] text-txt-muted">Last 7 days, 1h · weak levels listed only</span>
          </div>
        </section>

        {/* Ladder of level tiles — Market pulse tile style */}
        <section className="flex flex-col min-h-0 min-w-0">
          <div className="flex items-baseline justify-between px-1 pb-2 shrink-0">
            <span className="text-[13.5px] font-semibold text-txt-primary">Levels, by price</span>
            <span className="text-[12px] text-txt-muted">nearest to price in the middle</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-[84px] skeleton rounded-lg" />)
            ) : levels.length === 0 ? (
              <div className="text-[13px] text-txt-secondary text-center pt-6">No levels within 15% of price.</div>
            ) : (
              <>
                {[...above].reverse().map((l) => <LevelTile key={l.px} l={l} />)}
                <div className="flex items-center gap-2 py-1">
                  <span className="flex-1 border-t border-dashed border-border" />
                  <span className="ds-num text-[12.5px] text-txt-primary">Price {fmtPrice(px!)}</span>
                  <span className="flex-1 border-t border-dashed border-border" />
                </div>
                {below.map((l) => <LevelTile key={l.px} l={l} />)}
              </>
            )}
          </div>
        </section>
      </div>

      <p className="shrink-0 text-[12px] text-txt-muted leading-[1.5]">
        Combines gamma strikes (Deribit), cost-basis and liquidation clusters (tracked Hyperliquid wallets) and 4h swing highs and lows (last 14 days), within 15% of price.
        Nearby levels merge; the more independent sources agree, the stronger the level. A map of where things pile up, not a forecast.
        {missing.length > 0 && ` Missing for ${coin}: ${missing.join(", ")}.`}
      </p>
    </div>
  );
}

type Strength = KeyLevel["strength"];
const BARS: Record<Strength, number> = { Strong: 3, Medium: 2, Weak: 1 };

/** Strength pill with a 3-bar meter — readable at a glance. */
function StrengthBadge({ s, size = "md" }: { s: Strength; size?: "md" | "lg" }) {
  const pill =
    s === "Strong" ? "bg-[#EDEDEF] text-black"
    : s === "Medium" ? "bg-white/[0.14] text-txt-primary"
    : "border border-white/[0.14] text-txt-secondary";
  const bar = (on: boolean) =>
    s === "Strong" ? (on ? "bg-black" : "bg-black/20") : on ? "bg-txt-primary" : "bg-white/[0.18]";
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full font-semibold shrink-0", size === "lg" ? "h-7 px-3 text-[13px]" : "h-6 px-2.5 text-[12.5px]", pill)}>
      <span className="flex items-end gap-[2px]">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn("w-[3px] rounded-[1px]", bar(i <= BARS[s]))} style={{ height: 4 + i * 3 }} />
        ))}
      </span>
      {s}
    </span>
  );
}

const ACCENT: Record<Strength, string> = {
  Strong: "before:bg-[#EDEDEF]",
  Medium: "before:bg-white/[0.35]",
  Weak: "before:bg-white/[0.10]",
};

function SummaryCard({ label, level, loading }: { label: string; level: KeyLevel | null | undefined; loading: boolean }) {
  return (
    <div className={cn(CARD, "px-4 py-3 flex items-center justify-between gap-3")}>
      <div className="min-w-0">
        <div className="text-[12px] text-txt-muted">{label}</div>
        <div className="text-[16px] font-semibold text-txt-primary mt-0.5 ds-num">
          {loading || !level ? "—" : fmtPrice(level.px)}
          {!loading && level && (
            <span className={cn("text-[13px] font-medium", level.distPct > 0 ? "text-negative" : "text-positive")}> {pct(level.distPct)}</span>
          )}
        </div>
      </div>
      {!loading && level && <StrengthBadge s={level.strength} />}
    </div>
  );
}

function LevelTile({ l }: { l: KeyLevel }) {
  const side = l.distPct > 0 ? "Resistance" : "Support";
  return (
    <div className={cn(CARD, "relative overflow-hidden pl-4 pr-3.5 py-3 shrink-0 before:absolute before:left-0 before:inset-y-0 before:w-[3px]", ACCENT[l.strength])}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.06em] text-txt-muted">{side}</span>
        <span className={cn("ds-num text-[12px]", l.distPct > 0 ? "text-negative" : "text-positive")}>{pct(l.distPct)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-1">
        <span className="ds-num text-[17px] font-semibold text-txt-primary">{fmtPrice(l.px)}</span>
        <span className="flex items-center gap-2">
          <span className="text-[12px] text-txt-muted">{l.sources.length} source{l.sources.length > 1 ? "s" : ""}</span>
          <StrengthBadge s={l.strength} />
        </span>
      </div>
      <div className="mt-1.5 flex flex-col gap-0.5">
        {pieces(l).map((p) => (
          <span key={p.label + p.px} className="text-[12.5px] text-[#C2C2C8] leading-[1.45]">
            <span className="text-txt-muted">{SOURCE_LABEL[p.source as LevelSource]} · </span>{p.label.replace(/^Gamma strike · /, "")}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The biggest piece of each source, so tiles stay short. */
function pieces(l: KeyLevel) {
  return l.sources.map((s) => l.parts.filter((p) => p.source === s).sort((a, b) => b.weight - a.weight)[0]);
}
