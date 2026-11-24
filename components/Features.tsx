"use client"
import { useRef } from "react"
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion"

// Scroll-linked feature rows (adapted from 21st.dev "parallax scroll feature section"):
// as a row scrolls into view its text rises into place and its screenshot wipes in
// from the left (the clip extends 140px past the image so its shadow isn't cut).
// Tall shots sit beside the copy and alternate sides; wide shots run full width under it.
// Reduced motion shows everything static.

type Feature = { title: string; body: string; img: string; w: number; h: number; alt: string; wide?: boolean }

const FEATURES: Feature[] = [
  {
    title: "Will the range break or hold?",
    body: "Mako reads price and volatility on any Hyperliquid perp and tells you how likely the range is to break, against how often it usually does.",
    img: "/f-regime.webp",
    w: 336,
    h: 327,
    alt: "Mako range regime card on BTC reading Range likely holds: 41% chance the 4h range breaks, against a usual 72%",
  },
  {
    title: "Every perp, screened for the setups that matter.",
    body: "Price, volume, open interest and funding across every Hyperliquid perp, sortable in one place. Presets surface squeezes, crowded longs and unusual volume for you.",
    img: "/f-screener.webp",
    w: 1120,
    h: 559,
    alt: "Mako Screener listing Hyperliquid perps with price, 24h chart, returns, volume, relative volume, volatility and open interest",
    wide: true,
  },
  {
    title: "The numbers behind the move.",
    body: "See whether a move has real positioning behind it. Market pulse shows what's unusual right now, Volatility tracks implied and realised vol, and Cost basis shows where top Hyperliquid traders break even and how many are underwater.",
    img: "/f-analytics.webp",
    w: 1120,
    h: 424,
    alt: "Mako Analytics for BTC with Overview, Market pulse, Volatility and Cost basis tabs: price, open interest, funding, volume, sharps vs donors and cumulative returns by session",
    wide: true,
  },
]

function Row({ f, reverse }: { f: Feature; reverse: boolean }) {
  const cls = f.wide ? "feat feat-wide" : `feat ${reverse ? "feat-rev" : ""}`
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] })
  const y = useTransform(scrollYProgress, [0, 1], [50, 0])
  const opacity = useTransform(scrollYProgress, [0, 0.7], [0, 1])
  const clipPath = useTransform(scrollYProgress, [0, 0.7], ["inset(-140px 100% -140px -140px)", "inset(-140px -140px -140px -140px)"])

  return (
    <div ref={ref} className={cls}>
      <motion.div className="feat-copy" style={reduce ? undefined : { y }}>
        <h3 className="feat-title">{f.title}</h3>
        <p className="feat-body">{f.body}</p>
      </motion.div>
      <motion.figure className="feat-shot" style={reduce ? undefined : { opacity, clipPath }}>
        <img src={f.img} alt={f.alt} width={f.w} height={f.h} loading="lazy" style={{ maxWidth: f.w }} />
      </motion.figure>
    </div>
  )
}

export default function Features() {
  return (
    <section className="features" aria-label="What Mako does">
      {FEATURES.map((f, i) => (
        <Row key={f.img} f={f} reverse={i % 2 === 1} />
      ))}
    </section>
  )
}
