"use client";

import { useState } from "react";

// ─── Token icon: our own copy → Hyperliquid's coin art → open-source set → letter ───
// 1. /coins/<COIN>.svg — icons copied into the app (public/coins, downloaded by
//    the one-off tools/icons job), so we don't depend on third-party hosts.
// 2. app.hyperliquid.xyz/coins/<COIN>.svg — for coins listed after that copy.
//    Case-sensitive coin name.
// 3. cryptocurrency-icons (jsDelivr, pinned npm version). HL k-prefix tokens
//    (kPEPE, kBONK) strip the k for this source.
// 4. Letter circle.
// Pass the HL coin name (e.g. "kPEPE"); any casing works for the fallbacks.

const HL_BASE = "https://app.hyperliquid.xyz/coins";
const OSS_BASE = "https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color";

function ossSlug(symbol: string): string {
  let s = symbol;
  if (/^k[A-Z]/.test(s)) s = s.slice(1);
  return s.toLowerCase();
}

interface Props {
  symbol: string;
  size?: number;
}

export function TokenIcon({ symbol, size = 28 }: Props) {
  const sources = [`/coins/${symbol}.svg`, `${HL_BASE}/${symbol}.svg`, `${OSS_BASE}/${ossSlug(symbol)}.svg`];
  const [idx, setIdx] = useState(0);
  const [key, setKey] = useState(symbol);
  if (key !== symbol) { setKey(symbol); setIdx(0); }

  const ring = "rounded-full shrink-0 ring-1 ring-inset ring-white/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.5)]";

  if (idx >= sources.length) {
    return (
      <div
        className={`${ring} bg-gradient-to-b from-elevated-2 to-elevated flex items-center justify-center`}
        style={{ width: size, height: size }}
      >
        <span className="ds-num font-bold text-txt-secondary" style={{ fontSize: Math.max(9, Math.round(size * 0.48)) }}>
          {symbol.replace(/^k(?=[A-Z])/, "").charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <div className={`${ring} bg-elevated overflow-hidden`} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- external icon hosts, tiny images */}
      <img
        src={sources[idx]}
        alt={symbol}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setIdx((i) => i + 1)}
        className="w-full h-full object-cover"
      />
    </div>
  );
}
