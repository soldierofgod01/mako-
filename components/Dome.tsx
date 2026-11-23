"use client"
import { useEffect, useRef } from "react"

// "Horizon Glow" (21st.dev, arch mode): a backlit radial dome rising from the bottom
// centre over a parchment band, with grain. Animated: dome radius swells by
// 1 + sin(spin*0.8)*amt*0.07 and the backlight by 1 + sin(spin*0.8)*amt*0.35,
// both exactly 0 at t = 0 so nothing snaps when motion starts.

const PARCHMENT = "#F7F4EC"
const AMT = 0.3
const DIR = 1
const SPEED = 1.0

type Stop = [number, string]
const MAIN: Stop[] = [
  [0, "#6950fa"],
  [0.204, "#4D2FF9"],
  [0.411, "#5667FF"],
  [0.618, "#78B8F9"],
  [0.825, "#FFFFFF"],
  [0.853, "rgba(255,255,255,0)"],
]

function ellipse(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cy: number, rx: number, ry: number, stops: Stop[]) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(rx, ry)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  for (const [p, c] of stops) g.addColorStop(p, c)
  ctx.fillStyle = g
  ctx.fillRect(-cx / rx, -cy / ry, w / rx, h / ry)
  ctx.restore()
}

export default function Dome() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext("2d")
    if (!ctx) return

    // grain tile (120px fractal-ish noise), blended with overlay at 21%
    const tile = document.createElement("canvas")
    tile.width = tile.height = 120
    const tctx = tile.getContext("2d")!
    const img = tctx.createImageData(120, 120)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
    tctx.putImageData(img, 0, 0)

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let w = 0, h = 0, dpr = 1, raf = 0
    let pattern: CanvasPattern | null = null
    const resize = () => {
      dpr = Math.min(1.5, window.devicePixelRatio || 1)
      const b = cv.getBoundingClientRect()
      w = b.width
      h = b.height
      cv.width = Math.max(1, Math.round(w * dpr))
      cv.height = Math.max(1, Math.round(h * dpr))
      pattern = ctx.createPattern(tile, "repeat")
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(cv)

    const start = performance.now()
    const draw = (ms: number) => {
      const t = (ms - start) / 1000
      const ph = t * SPEED
      const spin = ph * DIR
      const swell = 1 + Math.sin(spin * 0.8) * AMT * 0.07
      const back = 1 + Math.sin(spin * 0.8) * AMT * 0.35

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalCompositeOperation = "source-over"
      ctx.globalAlpha = 1
      ctx.fillStyle = PARCHMENT
      ctx.fillRect(0, 0, w, h)

      const cx = w * 0.5, cy = h * 0.7
      // Soft halo, then the dome, then the backlight on top so its swell stays visible.
      ellipse(ctx, w, h, cx, cy, w * 0.53 * swell, h * 0.29 * swell, [
        [0, `rgba(86,103,255,${0.143 * back})`],
        [0.8, "rgba(86,103,255,0)"],
      ])
      ellipse(ctx, w, h, cx, cy, w * 1.0 * swell, h * 0.5 * swell, MAIN)
      ellipse(ctx, w, h, cx, cy, w * 0.42 * swell, h * 0.19 * swell, [
        [0, `rgba(139,120,251,${Math.min(1, 0.396 * back)})`],
        [0.38, `rgba(77,47,249,${0.154 * back})`],
        [0.72, "rgba(77,47,249,0)"],
      ])

      if (pattern) {
        ctx.globalCompositeOperation = "overlay"
        ctx.globalAlpha = 0.21
        ctx.fillStyle = pattern
        ctx.fillRect(0, 0, w, h)
      }
      if (!reduce) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])
  return <canvas ref={ref} className="dome" aria-hidden="true" />
}
