"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LiveFeed, LiveLevel } from "@/lib/bias/live-feed";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Order book + trades — a standard exchange-style book that moves on
// every Hyperliquid push (rAF-coalesced), independent of the 1s engine.
// Asks on top (best ask nearest the spread), bids below, cumulative depth
// bars, and a brief flash on any level whose size changed.
// ════════════════════════════════════════════════════════════════

const ROW_H = 20;

type Unit = "coin" | "usd";

function useLive(feed: LiveFeed) {
  return useSyncExternalStore(feed.subscribe, feed.getVersion, () => 0);
}

function priceDecimals(mid: number, sigFigs: number) {
  if (!(mid > 0)) return 2;
  return Math.max(0, sigFigs - 1 - Math.floor(Math.log10(mid)));
}

function fmtPx(px: number, dec: number) {
  return px.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtSz(v: number, unit: Unit) {
  if (unit === "usd") {
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return v.toFixed(0);
  }
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  if (v >= 100) return v.toFixed(1);
  if (v >= 1) return v.toFixed(3);
  return v.toFixed(4);
}

export function OrderBookPanel({ feed, coin, whaleMin }: { feed: LiveFeed; coin: string; whaleMin: number }) {
  const [tab, setTab] = useState<"book" | "trades">("book");
  const [unit, setUnit] = useState<Unit>("coin");
  useEffect(() => {
    try {
      if (localStorage.getItem("mako:book:unit") === "usd") setUnit("usd");
      if (localStorage.getItem("mako:book:tab") === "trades") setTab("trades");
    } catch { /* ignore */ }
  }, []);
  const pickUnit = (u: Unit) => {
    setUnit(u);
    try { localStorage.setItem("mako:book:unit", u); } catch { /* ignore */ }
  };
  const pickTab = (t: "book" | "trades") => {
    setTab(t);
    try { localStorage.setItem("mako:book:tab", t); } catch { /* ignore */ }
  };

  return (
    <section className="ds-card-panel flex flex-col overflow-hidden min-h-0">
      <div className="h-9 shrink-0 flex items-center gap-1 px-2 border-b border-border">
        <TabBtn active={tab === "book"} onClick={() => pickTab("book")}>Order book</TabBtn>
        <TabBtn active={tab === "trades"} onClick={() => pickTab("trades")}>Trades</TabBtn>
        <div className="ml-auto flex items-center rounded-full bg-void border border-border p-0.5">
          {(["coin", "usd"] as Unit[]).map((u) => (
            <button
              key={u}
              onClick={() => pickUnit(u)}
              className={cn(
                "h-5 px-2 rounded-full text-[10.5px] font-medium transition-colors",
                unit === u ? "bg-elevated-2 text-txt-primary" : "text-txt-muted hover:text-txt-secondary"
              )}
            >
              {u === "coin" ? coin : "USD"}
            </button>
          ))}
        </div>
      </div>
      {tab === "book" ? <Book feed={feed} coin={coin} unit={unit} /> : <Tape feed={feed} coin={coin} unit={unit} whaleMin={whaleMin} />}
    </section>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-7 px-2.5 rounded-full text-[12px] font-medium transition-colors",
        active ? "bg-elevated-2 text-txt-primary" : "text-txt-muted hover:text-txt-primary"
      )}
    >
      {children}
    </button>
  );
}

/** Rows per side that fit the measured body height. */
function useRowsPerSide(reserve: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(10);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const h = e.contentRect.height - reserve;
      setRows(Math.max(3, Math.min(20, Math.floor(h / ROW_H / 2))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [reserve]);
  return { ref, rows };
}

function Book({ feed, coin, unit }: { feed: LiveFeed; coin: string; unit: Unit }) {
  useLive(feed);
  const book = feed.book;
  const { ref, rows } = useRowsPerSide(ROW_H * 2 + 8); // header + spread row
  const prevRef = useRef<{ coin: string; sizes: Map<number, number> }>({ coin: "", sizes: new Map() });

  const view = useMemo(() => {
    if (!book || !book.bids.length || !book.asks.length) return null;
    const mid = (book.bids[0].px + book.asks[0].px) / 2;
    const val = (l: LiveLevel) => (unit === "usd" ? l.px * l.sz : l.sz);
    const asks = book.asks.slice(0, rows);
    const bids = book.bids.slice(0, rows);
    const cumulative = (side: LiveLevel[]) => {
      const out: number[] = [];
      for (let i = 0; i < side.length; i++) out.push((out[i - 1] ?? 0) + val(side[i]));
      return out;
    };
    const askCum = cumulative(asks);
    const bidCum = cumulative(bids);
    const max = Math.max(askCum[askCum.length - 1] ?? 0, bidCum[bidCum.length - 1] ?? 0, 1e-12);
    const spread = book.asks[0].px - book.bids[0].px;
    return { mid, asks, bids, askCum, bidCum, max, spread, dec: priceDecimals(mid, book.sigFigs), val };
  }, [book, rows, unit]);

  // Which levels changed size since the previous push → flash them.
  const prev = prevRef.current;
  const changed = new Set<number>();
  if (view && prev.coin === coin) {
    for (const l of [...view.asks, ...view.bids]) {
      const p = prev.sizes.get(l.px);
      if (p !== undefined && p !== l.sz) changed.add(l.px);
    }
  }
  useEffect(() => {
    if (!book) return;
    const sizes = new Map<number, number>();
    for (const l of book.asks) sizes.set(l.px, l.sz);
    for (const l of book.bids) sizes.set(l.px, l.sz);
    prevRef.current = { coin, sizes };
  });

  const unitLabel = unit === "usd" ? "USD" : coin;
  return (
    <div ref={ref} className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="h-5 mt-1 shrink-0 grid grid-cols-[1fr_1fr_1fr] px-3 text-[10.5px] text-txt-muted">
        <span>Price</span>
        <span className="text-right">Size ({unitLabel})</span>
        <span className="text-right">Total ({unitLabel})</span>
      </div>
      {!view ? (
        <div className="flex-1 px-3 py-2 flex flex-col gap-1">
          {Array.from({ length: 12 }).map((_, i) => <div key={i} className="h-3.5 skeleton" />)}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col justify-center">
          {/* Asks: worst at top, best ask just above the spread. */}
          {view.asks.map((l, i) => ({ l, cum: view.askCum[i] })).reverse().map(({ l, cum }) => (
            <Row key={`a${l.px}`} side="ask" l={l} cum={cum} max={view.max} dec={view.dec} unit={unit} val={view.val(l)} flash={changed.has(l.px)} />
          ))}
          <div className="h-7 my-0.5 shrink-0 flex items-center justify-between px-3 bg-white/[0.025] border-y border-border">
            <span className="ds-num text-[13px] font-semibold text-txt-primary">{fmtPx(view.mid, view.dec + 1)}</span>
            <span className="ds-num text-[11px] text-txt-muted">
              Spread {fmtPx(view.spread, view.dec)} · {((view.spread / view.mid) * 100).toFixed(3)}%
            </span>
          </div>
          {view.bids.map((l, i) => (
            <Row key={`b${l.px}`} side="bid" l={l} cum={view.bidCum[i]} max={view.max} dec={view.dec} unit={unit} val={view.val(l)} flash={changed.has(l.px)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ side, l, cum, max, dec, unit, val, flash }: {
  side: "bid" | "ask"; l: LiveLevel; cum: number; max: number; dec: number; unit: Unit; val: number; flash: boolean;
}) {
  const bid = side === "bid";
  return (
    <div className="relative shrink-0 grid grid-cols-[1fr_1fr_1fr] items-center px-3 ds-num text-[11.5px]" style={{ height: ROW_H }}>
      <div
        className={cn("absolute inset-y-px right-0 transition-[width] duration-150 ease-out", bid ? "bg-positive/[0.13]" : "bg-negative/[0.13]")}
        style={{ width: `${(cum / max) * 100}%` }}
      />
      {/* Keyed on size so a change remounts the span and replays the flash. */}
      {flash && <div key={l.sz} className={cn("absolute inset-0 book-flash", bid ? "book-flash-bid" : "book-flash-ask")} />}
      <span className={cn("relative", bid ? "text-positive" : "text-negative")}>{fmtPx(l.px, dec)}</span>
      <span className="relative text-right text-txt-primary">{fmtSz(val, unit)}</span>
      <span className="relative text-right text-txt-muted">{fmtSz(cum, unit)}</span>
    </div>
  );
}

function Tape({ feed, coin, unit, whaleMin }: { feed: LiveFeed; coin: string; unit: Unit; whaleMin: number }) {
  useLive(feed);
  const trades = feed.trades;
  const unitLabel = unit === "usd" ? "USD" : coin;
  const ref0 = trades.find((t) => t.px > 0)?.px ?? 0;
  const dec = Math.max(priceDecimals(ref0, 5), 0);
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="h-5 mt-1 shrink-0 grid grid-cols-[1fr_1fr_auto] gap-2 px-3 text-[10.5px] text-txt-muted">
        <span>Price</span>
        <span className="text-right">Size ({unitLabel})</span>
        <span className="text-right w-[52px]">Time</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {trades.length === 0 && <div className="px-3 py-3 text-[12px] text-txt-muted">Waiting for trades…</div>}
        {trades.map((t) => {
          const big = t.usd >= whaleMin;
          return (
            <div
              key={t.key}
              className={cn(
                "grid grid-cols-[1fr_1fr_auto] gap-2 items-center px-3 ds-num text-[11.5px] animate-fade-up",
                big && (t.side === 1 ? "bg-positive/[0.12] font-semibold" : "bg-negative/[0.12] font-semibold")
              )}
              style={{ height: ROW_H }}
            >
              <span className={t.side === 1 ? "text-positive" : "text-negative"}>{fmtPx(t.px, dec)}</span>
              <span className="text-right text-txt-primary">{fmtSz(unit === "usd" ? t.usd : t.sz, unit)}</span>
              <span className="text-right w-[52px] text-txt-muted">{new Date(t.t).toLocaleTimeString([], { hour12: false })}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
