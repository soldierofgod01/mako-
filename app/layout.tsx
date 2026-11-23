import type { Metadata, Viewport } from "next"
import "@fontsource-variable/newsreader/opsz.css"
import "@fontsource-variable/inter"
import "@fontsource-variable/jetbrains-mono"
import "@fontsource/barlow-condensed/700.css"
import "./globals.css"

export const metadata: Metadata = {
  title: "Mako: the order flow terminal that reads Hyperliquid for you",
  description:
    "Every terminal shows you the data. Mako reads the flow, the funding and the crowd on Hyperliquid and tells you what it means. Join the waitlist.",
  icons: { icon: "/mako-star.webp" },
}

export const viewport: Viewport = { themeColor: "#F7F4EC" }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
