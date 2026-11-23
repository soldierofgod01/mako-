"use client"
import { useEffect, useState } from "react"

export type Market = { name: string; change: number; volume: number }

// Shown before the live list loads (and if Hyperliquid can't be reached).
export const FALLBACK: Market[] = [
  "BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "SUI", "AVAX", "LINK", "BNB", "AAVE", "ENA",
  "PUMP", "FARTCOIN", "WIF", "TAO", "ADA", "LTC", "NEAR", "APT", "ARB", "OP", "TIA", "INJ",
  "SEI", "TRX", "ONDO", "JUP", "PENGU", "KAITO", "TRUMP", "BERA", "WLD", "LDO", "CRV", "PENDLE",
  "MKR", "UNI", "DOT", "ATOM", "FIL", "ETC", "BCH", "XLM", "HBAR", "ICP", "RUNE", "POPCAT",
].map((name) => ({ name, change: 0, volume: 0 }))

let cache: Promise<Market[]> | null = null

function load(): Promise<Market[]> {
  if (!cache) {
    cache = fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    })
      .then((r) => r.json())
      .then(([meta, ctxs]: [{ universe: { name: string; isDelisted?: boolean }[] }, { markPx: string; prevDayPx: string; dayNtlVlm: string }[]]) =>
        meta.universe
          .map((u, i) => ({ u, c: ctxs[i] }))
          .filter(({ u, c }) => !u.isDelisted && c && +c.prevDayPx > 0)
          .map(({ u, c }) => ({ name: u.name, change: +c.markPx / +c.prevDayPx - 1, volume: +c.dayNtlVlm })),
      )
      .catch((e) => {
        cache = null
        throw e
      })
  }
  return cache
}

export function useMarkets() {
  const [markets, setMarkets] = useState<Market[] | null>(null)
  useEffect(() => {
    let alive = true
    load()
      .then((m) => alive && setMarkets(m))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return markets
}
