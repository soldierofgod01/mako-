"use client";
// ════════════════════════════════════════════════════════════════
// Nav rail — 64px, icon + label (Artemis-style). Mako has a handful of
// modules, so a wide sidebar was mostly empty space; the rail gives that
// width back to the chart and tables. Sits on the dark background behind
// the floating cards (Linear/Vercel pattern).
// Search opens the coin finder (also "/" anywhere outside a text field).
// ════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";
import { ScanSearch, BadgeCheck, SquareTerminal, ChartLine, Search } from "lucide-react";
import { CoinFinder } from "./coin-finder";

const modules = [
  { id: "screener", label: "Screener", icon: ScanSearch },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "analytics", label: "Analytics", icon: ChartLine },
  { id: "track", label: "Track", icon: BadgeCheck },
];

function RailItem({ label, icon: Icon, active, onClick, title }: { label: string; icon: typeof Search; active?: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "group w-[52px] flex flex-col items-center gap-1 pt-2 pb-1.5 rounded-[10px] transition-colors duration-100",
        active
          ? "bg-accent/[0.08] ring-1 ring-inset ring-accent/[0.16]"
          : "hover:bg-white/[0.04]"
      )}
    >
      <Icon className={cn("w-[18px] h-[18px]", active ? "text-accent" : "text-txt-muted group-hover:text-txt-primary")} strokeWidth={active ? 2 : 1.75} />
      <span className={cn("text-[10.5px] font-medium leading-none tracking-[-0.01em]", active ? "text-txt-primary" : "text-txt-muted group-hover:text-txt-secondary")}>
        {label}
      </span>
    </button>
  );
}

export function SideNav() {
  const { activeModule, setActiveModule } = useAppStore();
  const [finder, setFinder] = useState(false);

  // "/" opens the coin finder unless you're typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      setFinder(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside className="w-16 shrink-0 flex flex-col items-center bg-transparent py-2">
      {/* Logo */}
      <div className="h-12 flex items-center justify-center shrink-0" title="Mako">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static logo */}
        <img src="/mako-star.png" alt="Mako" width={28} height={28} className="w-7 h-7 object-contain" />
      </div>

      {/* Search */}
      <div className="mt-2 mb-3">
        <RailItem label="Search" icon={Search} onClick={() => setFinder(true)} title="Find a coin  ( / )" />
      </div>
      <span className="w-6 h-px bg-white/[0.07] mb-3" />

      {/* Modules */}
      <nav className="flex flex-col items-center gap-1.5">
        {modules.map((m) => (
          <RailItem key={m.id} label={m.label} icon={m.icon} active={activeModule === m.id} onClick={() => setActiveModule(m.id)} />
        ))}
      </nav>

      {/* Footer: beta tag */}
      <div className="mt-auto pb-1 text-[9px] font-medium uppercase tracking-[0.12em] text-txt-dim">beta</div>

      <CoinFinder open={finder} onClose={() => setFinder(false)} />
    </aside>
  );
}
