"use client"
import { useState } from "react"
import { FALLBACK, Market, useMarkets } from "./useMarkets"

// Hyperliquid's own coin icons cover its whole market list; k-prefixed (1000x) markets retry without the k.
const srcs = (name: string) => {
  const bare = name.replace(/^k(?=[A-Z])/, "")
  return [`https://app.hyperliquid.xyz/coins/${name}.svg`, ...(bare !== name ? [`https://app.hyperliquid.xyz/coins/${bare}.svg`] : [])]
}

function Icon({ name }: { name: string }) {
  const list = srcs(name)
  const [i, setI] = useState(0)
  if (i >= list.length) return <span className="coin-letter" aria-hidden="true">{name.replace(/^k(?=[A-Z])/, "").slice(0, 1)}</span>
  return <img className="coin-icon" src={list[i]} alt="" width={28} height={28} decoding="async" onError={() => setI(i + 1)} />
}

function Pill({ m }: { m: Market }) {
  const live = m.volume > 0
  return (
    <div className="coin">
      <Icon name={m.name} />
      <span className="coin-name">{m.name}</span>
      {live && (
        <span className={`coin-chg num ${m.change >= 0 ? "up" : "down"}`}>
          {m.change >= 0 ? "+" : ""}
          {(m.change * 100).toFixed(1)}%
        </span>
      )}
    </div>
  )
}

export default function CoinWall() {
  const markets = useMarkets()
  const list = (markets && markets.length >= 24 ? [...markets].sort((a, b) => b.volume - a.volume) : FALLBACK).slice(0, 48)
  const rows = [0, 1, 2, 3].map((r) => list.filter((_, i) => i % 4 === r))
  return (
    <div className="wall" aria-label="Hyperliquid markets by 24h volume">
      {rows.map((row, r) => (
        <div key={r} className={`wall-row ${r % 2 ? "rev" : ""}`}>
          <div className="wall-track">
            {[...row, ...row].map((m, i) => (
              <Pill key={`${m.name}-${i}`} m={m} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
