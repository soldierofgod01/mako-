"use client";
import { useEffect, useRef, useState } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { fmtUsd } from "@/lib/bias/engine";
import type { CohortSide, LiqLevel } from "@/lib/cohorts/cohorts";
import type { OrderflowState } from "@/lib/hooks/use-orderflow";
import { cn } from "@/lib/utils";
import { fmtPrice } from "@/lib/bias/format";
import type { VolState } from "@/lib/vol/use-vol";
import { VolPanel } from "./vol-panel";
import { CostBasisPanel, PulsePanel } from "./pulse-panel";

// ════════════════════════════════════════════════════════════════
// Bottom panel — secondary context in tabs, like an exchange terminal's
// positions/orders strip. Drag the top edge to resize; collapse to a bar.
// ════════════════════════════════════════════════════════════════

type TabId = "pulse" | "basis" | "vol" | "cohorts" | "liqs" | "prints";
const TABS: { id: TabId; label: string }[] = [
  { id: "pulse", label: "Market pulse" },
  { id: "basis", label: "Trader cost basis" },
  { id: "vol", label: "Volatility" },
  { id: "cohorts", label: "Sharps vs donors" },
  { id: "liqs", label: "Liquidation levels" },
  { id: "prints", label: "Large prints" },
];
const MIN_H = 140;
const MAX_H = 460;
const DEFAULT_H = 210;
const usd = (x: number) => fmtUsd(x).replace("+", "");

export function BottomPanel({ of, vol, coin }: { of: OrderflowState; vol: VolState; coin: string }) {
  const [tab, setTab] = useState<TabId>("vol");
  const [open, setOpen] = useState(true);
  const [h, setH] = useState(DEFAULT_H);
  useEffect(() => {
    try {
      const t = localStorage.getItem("mako:bottom:tab") as TabId | null;
      if (t && TABS.some((x) => x.id === t)) setTab(t);
      if (localStorage.getItem("mako:bottom:open") === "0") setOpen(false);
      const sh = Number(localStorage.getItem("mako:bottom:h"));
      if (sh >= MIN_H && sh <= MAX_H) setH(sh);
    } catch { /* ignore */ }
  }, []);
  const persist = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

  // Drag-to-resize from the top edge.
  const drag = useRef<{ y: number; h: number } | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      setH(Math.max(MIN_H, Math.min(MAX_H, drag.current.h + (drag.current.y - e.clientY))));
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = "";
      setH((v) => { persist("mako:bottom:h", String(v)); return v; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);

  return (
    <section className="ds-card-panel shrink-0 flex flex-col overflow-hidden relative" style={{ height: open ? h : 40 }}>
      {open && (
        <div
          onPointerDown={(e) => { drag.current = { y: e.clientY, h }; document.body.style.cursor = "row-resize"; }}
          className="absolute top-0 inset-x-0 h-1.5 cursor-row-resize z-10 hover:bg-white/[0.06]"
          title="Drag to resize"
        />
      )}
      <div className="h-10 shrink-0 flex items-center gap-1 px-2 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); persist("mako:bottom:tab", t.id); if (!open) { setOpen(true); persist("mako:bottom:open", "1"); } }}
            className={cn(
              "h-7 px-3 rounded-full text-[12px] font-medium transition-colors",
              open && tab === t.id ? "bg-elevated-2 text-txt-primary" : "text-txt-muted hover:text-txt-primary"
            )}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => setOpen((v) => { persist("mako:bottom:open", v ? "0" : "1"); return !v; })}
          title={open ? "Collapse" : "Expand"}
          className="ml-auto w-7 h-7 rounded-full flex items-center justify-center text-txt-muted hover:text-txt-primary hover:bg-elevated"
        >
          {open ? <CaretDown size={14} /> : <CaretUp size={14} />}
        </button>
      </div>
      {open && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {tab === "pulse" && <PulsePanel of={of} vol={vol} coin={coin} />}
          {tab === "basis" && <CostBasisPanel of={of} />}
          {tab === "vol" && <VolPanel vol={vol} px={of.lastPx} />}
          {tab === "cohorts" && <Cohorts of={of} />}
          {tab === "liqs" && <Liqs of={of} />}
          {tab === "prints" && <Prints of={of} />}
        </div>
      )}
    </section>
  );
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11.5px] text-txt-muted leading-[1.5]">{children}</p>
);

// ─── Sharps vs donors ───────────────────────────────────────────

function Cohorts({ of }: { of: OrderflowState }) {
  const c = of.cohorts;
  const d = c?.data;
  const div = d?.divergence ?? 0;
  const ageMin = c ? Math.max(0, Math.round((Date.now() - c.updatedAt) / 60_000)) : 0;
  if (!c) return <div className="m-4 h-[88px] skeleton" />;
  return (
    <div className="px-4 py-3 grid grid-cols-[180px_1fr_1fr] gap-6 items-start">
      <div>
        <div className="text-[11.5px] text-txt-muted">Divergence</div>
        <div className={cn("ds-num text-[22px] font-semibold leading-tight", div >= 20 ? "text-positive" : div <= -20 ? "text-negative" : "text-txt-primary")}>
          {d ? `${div > 0 ? "+" : ""}${div}` : "—"}
        </div>
        <Note>Positive = winners are longer than losers. Updated {ageMin === 0 ? "just now" : `${ageMin}m ago`}.</Note>
      </div>
      {d ? (
        <>
          <CohortRow label="Sharps" sub={`top ${c.tracked.sharps} profitable wallets`} side={d.sharps} />
          <CohortRow label="Donors" sub={`${c.tracked.donors} biggest losers`} side={d.donors} />
        </>
      ) : (
        <div className="col-span-2 text-[12px] text-txt-muted pt-1">No tracked wallets hold this coin right now.</div>
      )}
    </div>
  );
}

function CohortRow({ label, sub, side }: { label: string; sub: string; side: CohortSide }) {
  const gross = side.longUsd + side.shortUsd;
  const longPct = gross > 0 ? (side.longUsd / gross) * 100 : 50;
  const n = side.longWallets + side.shortWallets;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[12.5px] font-medium text-txt-primary">
          {label} <span className="text-txt-muted font-normal">· {n} wallet{n === 1 ? "" : "s"} · {sub}</span>
        </span>
        <span className="ds-num text-[11.5px] text-txt-secondary">{gross > 0 ? `${Math.round(longPct)}% long` : "no positions"}</span>
      </div>
      <div className="h-2 rounded-full bg-negative/40 overflow-hidden flex">
        <div className="h-full bg-positive/80" style={{ width: `${longPct}%` }} />
      </div>
      <div className="flex justify-between mt-1 ds-num text-[11px] text-txt-muted">
        <span>L {usd(side.longUsd)} · {side.longWallets}</span>
        <span>{side.shortWallets} · S {usd(side.shortUsd)}</span>
      </div>
    </div>
  );
}

// ─── Liquidation levels ─────────────────────────────────────────

function Liqs({ of }: { of: OrderflowState }) {
  const px = of.lastPx ?? 0;
  if (!of.cohorts) return <div className="m-4 h-[60px] skeleton" />;
  const levels = (of.cohorts.data?.liqLevels ?? []).filter((l) => px > 0 && Math.abs(l.px - px) / px <= 0.25);
  const size = (l: LiqLevel) => l.longUsd + l.shortUsd;
  const above = levels.filter((l) => l.px > px).sort((a, b) => size(b) - size(a)).slice(0, 5).sort((a, b) => a.px - b.px);
  const below = levels.filter((l) => l.px <= px).sort((a, b) => size(b) - size(a)).slice(0, 5).sort((a, b) => b.px - a.px);
  return (
    <div className="px-4 py-3">
      {above.length + below.length === 0 ? (
        <div className="text-[12px] text-txt-muted">No tracked liquidations within 25% of price.</div>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          <LiqTable title="Above price" rows={above} px={px} />
          <LiqTable title="Below price" rows={below} px={px} />
        </div>
      )}
      <div className="mt-2"><Note>Where tracked sharps and donors get force-closed. A move into a cluster can accelerate as liquidations fire. Tracked wallets only, not the whole market.</Note></div>
    </div>
  );
}

function LiqTable({ title, rows, px }: { title: string; rows: LiqLevel[]; px: number }) {
  return (
    <div>
      <div className="grid grid-cols-[90px_1fr_64px_80px_44px] text-[10.5px] text-txt-muted h-5 items-center">
        <span>{title}</span><span>Price</span><span className="text-right">Distance</span><span className="text-right">Size</span><span className="text-right">Wallets</span>
      </div>
      {rows.length === 0 && <div className="text-[12px] text-txt-muted h-6 flex items-center">None</div>}
      {rows.map((l, i) => {
        const longSide = l.longUsd >= l.shortUsd;
        const dist = ((l.px - px) / px) * 100;
        return (
          <div key={i} className="grid grid-cols-[90px_1fr_64px_80px_44px] items-center h-6 text-[12px] ds-num">
            <span className={cn("font-medium", longSide ? "text-warning" : "text-[#60A5FA]")}>{longSide ? "Long liqs" : "Short liqs"}</span>
            <span className="text-txt-primary">{fmtPrice(l.px)}</span>
            <span className="text-right text-txt-secondary">{dist > 0 ? "+" : ""}{dist.toFixed(1)}%</span>
            <span className="text-right text-txt-primary">{usd(l.longUsd + l.shortUsd)}</span>
            <span className="text-right text-txt-muted">{l.wallets}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Large prints ───────────────────────────────────────────────

function Prints({ of }: { of: OrderflowState }) {
  if (of.bigPrints.length === 0) {
    return <div className="px-4 py-3 text-[12px] text-txt-muted">No prints ≥ {usd(of.whaleMin)} yet this session.</div>;
  }
  return (
    <div className="px-2 py-1">
      <div className="grid grid-cols-[70px_1fr_1fr_90px] px-2 h-6 items-center text-[10.5px] text-txt-muted">
        <span>Side</span><span>Size</span><span>Price</span><span className="text-right">Time</span>
      </div>
      {of.bigPrints.map((t, i) => (
        <div key={`${t.t}-${i}`} className="grid grid-cols-[70px_1fr_1fr_90px] items-center px-2 h-7 ds-row-hover rounded-md ds-num text-[12px]">
          <span className={cn("font-medium", t.side === 1 ? "text-positive" : "text-negative")}>{t.side === 1 ? "Buy" : "Sell"}</span>
          <span className="text-txt-primary">{usd(t.usd)}</span>
          <span className="text-txt-secondary">{fmtPrice(t.px)}</span>
          <span className="text-right text-txt-muted">{new Date(t.t).toLocaleTimeString([], { hour12: false })}</span>
        </div>
      ))}
    </div>
  );
}
