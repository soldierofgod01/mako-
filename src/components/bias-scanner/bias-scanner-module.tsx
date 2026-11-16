"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Search } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { TokenIcon } from "@/components/scanner/token-icon";
import { fmtPrice } from "@/components/bias/bias-module";
import { fmtUsd } from "@/lib/bias/engine";
import type { MarketStance, ScanRow, ScanTag } from "@/lib/bias/scan";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Bias Scanner — which coins deserve attention right now, by positioning.
// Click a row → opens that coin in the Terminal for the live order-flow read.
// ════════════════════════════════════════════════════════════════

interface ScanResponse {
  rows: ScanRow[];
  market: MarketStance;
  updatedAt: number;
  tracked: { sharps: number; donors: number };
}

const FILTERS: { id: string; label: string; match: (r: ScanRow) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "sharps-long", label: "Sharps long", match: (r) => r.tag === "sharps-long" },
  { id: "sharps-short", label: "Sharps short", match: (r) => r.tag === "sharps-short" },
  { id: "crowded", label: "Crowded", match: (r) => r.fundingRate8h > 0.03 || r.fundingRate8h < -0.01 },
];

const TAG_STYLE: Record<ScanTag, string> = {
  "sharps-long": "text-positive",
  "sharps-short": "text-negative",
  "crowded-long": "text-warning",
  "crowded-short": "text-warning",
  aligned: "text-txt-secondary",
  thin: "text-txt-muted",
};

export function BiasScannerModule() {
  const { setBiasCoin, setActiveModule } = useAppStore();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"strongest" | "standouts">("strongest");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["bias-scan"],
    queryFn: async (): Promise<ScanResponse> => {
      const res = await fetch("/api/bias-scan");
      if (!res.ok) throw new Error("scan failed");
      return res.json();
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[0];
    const s = q.trim().toUpperCase();
    const out = (data?.rows ?? []).filter((r) => f.match(r) && (!s || r.symbol.includes(s)));
    if (sort === "standouts") {
      // Coins furthest from the sharps' market-wide stance first; unread coins last.
      const key = (r: ScanRow) => (r.relative == null ? -1 : Math.abs(r.relative));
      out.sort((a, b) => key(b) - key(a));
    }
    return out;
  }, [data, filter, q, sort]);

  const open = (coin: string) => {
    setBiasCoin(coin);
    setActiveModule("terminal");
  };

  const ageMin = data ? Math.max(0, Math.round((Date.now() - data.updatedAt) / 60_000)) : null;

  return (
    <div className="flex-1 overflow-y-auto bg-bg-base">
      <div className="px-6 md:px-10 py-8 max-w-[1240px] mx-auto">
        <div className="mb-6 flex items-end justify-between gap-6">
          <div>
            <h1 className="ds-page-title">Where to look</h1>
            <p className="mt-2 text-[14px] text-txt-secondary leading-[1.5] max-w-[680px]">
              Every liquid Hyperliquid perp, ranked by positioning: what the {data?.tracked.sharps ?? 120} most profitable
              active wallets hold versus the {data?.tracked.donors ?? 120} biggest losers, plus funding crowding. Open a coin
              in the Terminal to confirm with live order flow.
            </p>
          </div>
          {ageMin !== null && <span className="ds-label shrink-0">Updated {ageMin === 0 ? "just now" : `${ageMin}m ago`}</span>}
        </div>

        {data?.market && data.market.baseline !== null && <MarketBanner m={data.market} />}

        <div className="flex items-center gap-2 mb-3">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "h-8 px-3 rounded-md text-[12.5px] font-medium transition-colors",
                filter === f.id ? "bg-elevated text-txt-primary" : "text-txt-secondary hover:text-txt-primary hover:bg-panel"
              )}
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto flex items-center rounded-md border border-border p-0.5">
            {(["strongest", "standouts"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                title={k === "strongest" ? "Biggest absolute positioning" : "Furthest from the sharps' market-wide stance"}
                className={cn(
                  "h-7 px-2.5 rounded text-[12px] font-medium",
                  sort === k ? "bg-elevated text-txt-primary" : "text-txt-muted hover:text-txt-primary"
                )}
              >
                {k === "strongest" ? "Strongest" : "Stand-outs"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-border bg-panel w-[180px]">
            <Search className="w-3.5 h-3.5 text-txt-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              className="flex-1 bg-transparent outline-none text-[12.5px] placeholder:text-txt-muted"
            />
          </div>
        </div>

        <div className="ds-panel ds-panel-signature overflow-hidden">
          <div className="grid grid-cols-[1.3fr_0.9fr_0.7fr_0.8fr_0.8fr_1fr_1fr_0.7fr_0.7fr_1.1fr_28px] gap-3 px-4 h-10 items-center border-b border-border ds-label text-[11.5px]">
            <span>Coin</span>
            <span className="text-right">Price</span>
            <span className="text-right">24h</span>
            <span className="text-right">Funding/8h</span>
            <span className="text-right">OI</span>
            <span>Sharps</span>
            <span>Donors</span>
            <span className="text-right">Divergence</span>
            <span className="text-right" title="Divergence minus the sharps' market-wide average">vs mkt</span>
            <span>Positioning</span>
            <span />
          </div>

          {isError ? (
            <div className="py-14 text-center text-[13px] text-txt-muted">Couldn&rsquo;t build the scan. Retrying…</div>
          ) : isLoading ? (
            <div className="p-4 flex flex-col gap-2">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-10 skeleton" />)}
              <p className="text-[12px] text-txt-muted pt-2">First load pulls ~240 wallets&rsquo; positions — can take ~10s.</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="py-14 text-center text-[13px] text-txt-muted">Nothing matches this filter right now.</div>
          ) : (
            rows.map((r) => (
              <button
                key={r.coin}
                onClick={() => open(r.coin)}
                className="w-full grid grid-cols-[1.3fr_0.9fr_0.7fr_0.8fr_0.8fr_1fr_1fr_0.7fr_0.7fr_1.1fr_28px] gap-3 px-4 py-2.5 items-center text-left border-b border-border last:border-b-0 ds-row-hover group"
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <TokenIcon symbol={r.symbol} size={22} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-txt-primary">{r.coin}</span>
                    <span className={cn("block text-[11px] truncate", TAG_STYLE[r.tag])}>{r.read}</span>
                  </span>
                </span>
                <span className="ds-num text-[12.5px] text-right text-txt-primary">{fmtPrice(r.markPrice)}</span>
                <span className={cn("ds-num text-[12.5px] text-right", r.priceChange24hPct >= 0 ? "text-positive" : "text-negative")}>
                  {r.priceChange24hPct >= 0 ? "+" : ""}
                  {r.priceChange24hPct.toFixed(2)}%
                </span>
                <span className={cn("ds-num text-[12px] text-right", r.fundingRate8h > 0.03 || r.fundingRate8h < -0.01 ? "text-warning" : "text-txt-secondary")}>
                  {r.fundingRate8h >= 0 ? "+" : ""}
                  {r.fundingRate8h.toFixed(4)}%
                </span>
                <span className="ds-num text-[12px] text-right text-txt-secondary">{fmtUsd(r.openInterestUsd).replace("+", "")}</span>
                <CohortCell side={r.sharps} />
                <CohortCell side={r.donors} />
                <span
                  className={cn(
                    "ds-num text-[12.5px] text-right font-medium",
                    r.divergence == null ? "text-txt-muted" : r.divergence >= 25 ? "text-positive" : r.divergence <= -25 ? "text-negative" : "text-txt-secondary"
                  )}
                >
                  {r.divergence == null ? "—" : `${r.divergence > 0 ? "+" : ""}${r.divergence}`}
                </span>
                <span
                  className={cn(
                    "ds-num text-[12px] text-right",
                    r.relative == null ? "text-txt-muted" : r.relative >= 30 ? "text-positive" : r.relative <= -30 ? "text-negative" : "text-txt-secondary"
                  )}
                >
                  {r.relative == null ? "—" : `${r.relative > 0 ? "+" : ""}${r.relative}`}
                </span>
                <span className="flex items-center gap-2">
                  <Bar v={r.positioning / 100} />
                  <span className="ds-num text-[12px] text-txt-primary w-8 text-right">
                    {r.positioning > 0 ? "+" : ""}
                    {r.positioning}
                  </span>
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-txt-muted group-hover:text-accent transition-colors" />
              </button>
            ))
          )}
        </div>

        <p className="mt-5 text-[12px] text-txt-muted leading-[1.55] max-w-[760px]">
          Positioning only — this scan does not include live order flow (delta, absorption, large prints), which needs a live
          tape per coin. Use it to shortlist, then confirm in the Terminal. Cohorts are tracked wallets, not the whole market; past PnL
          doesn&rsquo;t guarantee future skill. Coins under $500K daily volume are hidden. Not trade calls.
        </p>
        <div className="h-8" />
      </div>
    </div>
  );
}

function CohortCell({ side }: { side: { net: number; n: number } | null }) {
  if (!side) return <span className="text-[12px] text-txt-muted">—</span>;
  const pct = Math.round(side.net * 100);
  return (
    <span className="flex flex-col">
      <span className={cn("ds-num text-[12px]", pct > 10 ? "text-positive" : pct < -10 ? "text-negative" : "text-txt-secondary")}>
        {pct > 10 ? `${pct}% long` : pct < -10 ? `${-pct}% short` : "flat"}
      </span>
      <span className="text-[10.5px] text-txt-muted">{side.n} wallet{side.n === 1 ? "" : "s"}</span>
    </span>
  );
}

function Bar({ v }: { v: number }) {
  const w = Math.min(1, Math.abs(v)) * 50;
  return (
    <div className="relative flex-1 h-1.5 rounded-full bg-elevated overflow-hidden">
      <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
      <div
        className={cn("absolute inset-y-0", v >= 0 ? "bg-positive" : "bg-negative")}
        style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
      />
    </div>
  );
}

function MarketBanner({ m }: { m: MarketStance }) {
  const b = m.baseline as number;
  const share = Math.round(m.sharpsShortShare * 100);
  const broad = share >= 70 || share <= 30;
  const stance = b <= -20 ? "net short" : b >= 20 ? "net long" : "mixed";
  return (
    <div className="ds-panel ds-stat-accent px-4 py-3 mb-4 flex items-start gap-4">
      <div className="shrink-0">
        <div className="ds-label text-[11px]">Market baseline</div>
        <div className={cn("ds-num text-[20px] font-semibold", b <= -20 ? "text-negative" : b >= 20 ? "text-positive" : "text-txt-primary")}>
          {b > 0 ? "+" : ""}
          {b}
        </div>
      </div>
      <p className="text-[12.5px] text-txt-secondary leading-[1.55]">
        Sharps are {stance} vs donors across the market — net short on {share}% of {m.coins} coins.
        {broad
          ? " That's one market-wide stance, so a big divergence on a single coin mostly repeats it. The coin-specific read is the vs mkt column — use Stand-outs to see where sharps break from their own trade."
          : " Positioning varies coin by coin, so divergence carries coin-specific information."}
      </p>
    </div>
  );
}
