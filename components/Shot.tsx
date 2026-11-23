"use client"
import { useEffect, useState } from "react"

// The terminal screenshot. Drop the real image at public/terminal.webp.
// Until it exists, nothing is shown (the frame only appears once the image loads).
export default function Shot() {
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading")
  useEffect(() => {
    const img = new Image()
    img.onload = () => setState("ok")
    img.onerror = () => setState("missing")
    img.src = "/terminal.webp"
  }, [])
  if (state !== "ok") return null
  return (
    <figure className="shot">
      <img src="/terminal.webp" alt="The Mako terminal on BTC: live chart, order book and a range regime reading Breakout likely, 87%" width={1200} height={584} />
    </figure>
  )
}
