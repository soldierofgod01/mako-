"use client";
// ════════════════════════════════════════════════════════════════
// Theme tuner (temporary, design review only). Opens with ?tune in the URL.
// Live-edits the floating-panel colours through CSS variables so shades
// can be judged on the real app. Settings persist per browser; "Copy"
// gives the values to bake into globals.css. Remove once the shade is set.
// ════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";

interface T { l: number; h: number; s: number; void: number; edge: number; hi: number }

const DEFAULT: T = { l: 4.9, h: 240, s: 12, void: 1.6, edge: 0.07, hi: 0.045 };
const PRESETS: { name: string; t: T }[] = [
  { name: "Current", t: DEFAULT },
  { name: "Graphite", t: { l: 8, h: 220, s: 6, void: 2, edge: 0.08, hi: 0.05 } },
  { name: "Slate", t: { l: 8.5, h: 222, s: 16, void: 2.5, edge: 0.08, hi: 0.05 } },
  { name: "Warm", t: { l: 8, h: 30, s: 6, void: 2, edge: 0.075, hi: 0.05 } },
  { name: "Zinc", t: { l: 10, h: 240, s: 4, void: 3, edge: 0.08, hi: 0.06 } },
  { name: "Lifted", t: { l: 12, h: 228, s: 8, void: 3, edge: 0.09, hi: 0.07 } },
];
const KEY = "mako:tuner:v1";

function hsl(h: number, s: number, l: number) {
  // → hex, so the values can be pasted straight into globals.css
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

function vars(t: T) {
  return {
    "--color-bg-base": hsl(t.h, t.s, t.l),
    "--color-surface-0": hsl(t.h, t.s, t.l),
    "--color-panel": hsl(t.h, t.s, t.l + 1.6),
    "--color-elevated": hsl(t.h, t.s, t.l + 3.4),
    "--color-elevated-2": hsl(t.h, t.s, t.l + 5.2),
    "--color-surface-1": hsl(t.h, t.s, t.l + 2.4),
    "--color-surface-2": hsl(t.h, t.s, t.l + 4),
    "--color-surface-3": hsl(t.h, t.s, t.l + 5.6),
    "--color-void": hsl(t.h, Math.min(t.s, 10), t.void),
    "--card-edge": `rgba(255,255,255,${t.edge})`,
    "--card-highlight": `rgba(255,255,255,${t.hi})`,
  } as Record<string, string>;
}

export function ThemeTuner() {
  const [on, setOn] = useState(false);
  const [open, setOpen] = useState(true);
  const [t, setT] = useState<T>(DEFAULT);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const enabled = new URLSearchParams(window.location.search).has("tune");
    let saved: T | null = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of URL/localStorage on mount
    if (enabled) setOn(true);
    if (saved) setT(saved);
  }, []);

  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    const v = vars(t);
    for (const [k, val] of Object.entries(v)) root.style.setProperty(k, val);
    try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* ignore */ }
  }, [t, on]);

  if (!on) return null;
  const v = vars(t);
  const set = (k: keyof T) => (e: React.ChangeEvent<HTMLInputElement>) => setT({ ...t, [k]: Number(e.target.value) });
  const copy = () => {
    const txt = Object.entries(v).map(([k, val]) => `${k}: ${val};`).join("\n");
    navigator.clipboard?.writeText(txt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  const row = (label: string, k: keyof T, min: number, max: number, step: number, fmt?: (n: number) => string) => (
    <label key={k} className="block">
      <span className="flex justify-between text-[11px] text-txt-muted"><span>{label}</span><span className="ds-num text-txt-secondary">{fmt ? fmt(t[k]) : t[k]}</span></span>
      <input type="range" min={min} max={max} step={step} value={t[k]} onChange={set(k)} className="w-full accent-[#33FFA3]" />
    </label>
  );

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-[268px] rounded-xl border border-white/15 bg-[#1A1B1F] shadow-[0_20px_50px_-10px_rgba(0,0,0,0.9)] text-txt-primary">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-3 h-9 text-[12px] font-semibold">
        <span className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-[4px] border border-white/20" style={{ background: v["--color-bg-base"] }} />
          Panel shade
        </span>
        <span className="ds-num text-[11px] text-txt-muted">{v["--color-bg-base"]} {open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2.5">
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button key={p.name} onClick={() => setT(p.t)} className="h-6 px-2 rounded-md text-[11px] bg-white/[0.06] hover:bg-white/[0.12] flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: hsl(p.t.h, p.t.s, p.t.l) }} />
                {p.name}
              </button>
            ))}
          </div>
          {row("Panel lightness", "l", 2, 16, 0.25, (n) => `${n}%`)}
          {row("Tint (hue)", "h", 0, 360, 1, (n) => `${n}°`)}
          {row("Tint strength", "s", 0, 30, 1, (n) => `${n}%`)}
          {row("Background (gaps)", "void", 0, 8, 0.25, (n) => `${n}%`)}
          {row("Edge", "edge", 0, 0.2, 0.005, (n) => n.toFixed(3))}
          {row("Top highlight", "hi", 0, 0.15, 0.005, (n) => n.toFixed(3))}
          <div className="flex gap-1.5 pt-1">
            <button onClick={copy} className="flex-1 h-7 rounded-md text-[11.5px] font-medium bg-[#33FFA3] text-black">{copied ? "Copied" : "Copy values"}</button>
            <button onClick={() => setT(DEFAULT)} className="h-7 px-2.5 rounded-md text-[11.5px] bg-white/[0.08] hover:bg-white/[0.14]">Reset</button>
          </div>
        </div>
      )}
    </div>
  );
}
