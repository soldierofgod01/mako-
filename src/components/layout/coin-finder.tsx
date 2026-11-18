"use client";
// ════════════════════════════════════════════════════════════════
// Coin finder — opened from the rail's Search or by pressing "/".
// Type to filter Hyperliquid perps, ↑/↓ to move, Enter to open the coin
// in the Terminal, Esc to close.
// ════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft, Search } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { TokenIcon } from "@/components/scanner/token-icon";
import { cn } from "@/lib/utils";

interface Market {
  symbol: string;
  coin: string;
  markPrice: number;
  volume24hUsd: number;
  change24hPct?: number;
}

const price = (p: number) =>
  p >= 1000 ? p.toLocaleString("en-US", { maximumFractionDigits: 1 }) : p >= 1 ? p.toFixed(p >= 100 ? 2 : 3) : p >= 0.01 ? p.toFixed(4) : p.toPrecision(4);
const vol = (x: number) => (x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${(x / 1e3).toFixed(0)}K`);

export function CoinFinder({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setBiasCoin, setActiveModule } = useAppStore();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const { data, isError } = useQuery({
    queryKey: ["finder-markets"],
    queryFn: async (): Promise<Market[]> => {
      const r = await fetch("/api/scanner");
      if (!r.ok) throw new Error("markets");
      return (await r.json()).markets ?? [];
    },
    staleTime: 60_000,
    enabled: open,
  });

  const rows = useMemo(() => {
    const s = q.trim().toUpperCase();
    const all = data ?? [];
    if (!s) return all.slice(0, 50);
    // Prefix matches first, then anything containing the query.
    const pre = all.filter((m) => m.coin.toUpperCase().startsWith(s));
    const rest = all.filter((m) => !m.coin.toUpperCase().startsWith(s) && m.coin.toUpperCase().includes(s));
    return [...pre, ...rest].slice(0, 50);
  }, [data, q]);

  const pick = (coin: string) => {
    setBiasCoin(coin);
    setActiveModule("terminal");
    onClose();
  };

  // Reset when (re)opened.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setQ(""); setSel(0); }
  }

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && rows[sel]) { e.preventDefault(); pick(rows[sel].coin); }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center pt-[14vh] bg-black/60 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className="w-[520px] max-w-[92vw] rounded-xl border border-white/[0.09] bg-bg-base shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_60px_-12px_rgba(0,0,0,0.9)] overflow-hidden animate-slide-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 h-[52px] border-b border-border">
          <Search className="w-4 h-4 text-txt-muted shrink-0" />
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={onKey}
            placeholder="Search Hyperliquid perps…"
            className="flex-1 bg-transparent outline-none text-[15px] text-txt-primary placeholder:text-txt-muted"
          />
          <kbd className="text-[10.5px] text-txt-muted border border-border rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[380px] overflow-y-auto py-1.5">
          {isError && <div className="px-4 py-6 text-[13px] text-txt-muted">Couldn&rsquo;t load markets.</div>}
          {!data && !isError && <div className="px-4 py-6 text-[13px] text-txt-muted">Loading markets…</div>}
          {data && rows.length === 0 && <div className="px-4 py-6 text-[13px] text-txt-muted">No market matches &ldquo;{q}&rdquo;.</div>}
          {rows.map((m, i) => (
            <button
              key={m.coin}
              data-i={i}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(m.coin)}
              className={cn("w-full flex items-center gap-3 px-4 h-11 text-left transition-colors", i === sel ? "bg-white/[0.05]" : "")}
            >
              <TokenIcon symbol={m.coin} size={22} />
              <span className="text-[14px] font-semibold text-txt-primary w-24 truncate">{m.coin}</span>
              <span className="ds-num text-[13px] text-txt-secondary flex-1">{price(m.markPrice)}</span>
              <span className="ds-num text-[12px] text-txt-muted w-20 text-right">{vol(m.volume24hUsd)}</span>
              <CornerDownLeft className={cn("w-3.5 h-3.5 shrink-0", i === sel ? "text-txt-muted" : "text-transparent")} />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 px-4 h-9 border-t border-border text-[11px] text-txt-muted">
          <span><kbd className="font-sans">↑↓</kbd> move</span>
          <span><kbd className="font-sans">↵</kbd> open in Terminal</span>
          <span className="ml-auto">Press <kbd className="border border-border rounded px-1">/</kbd> anywhere</span>
        </div>
      </div>
    </div>
  );
}
