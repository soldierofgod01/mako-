import Dome from "@/components/Dome"
import Shot from "@/components/Shot"
import CoinWall from "@/components/CoinWall"
import Waitlist from "@/components/Waitlist"
import Features from "@/components/Features"

export default function Home() {
  return (
    <main>
      <header className="nav">
        <div className="nav-in">
          <a href="#top" className="brand" aria-label="Mako home">
            <img src="/mako-star.webp" alt="" width={34} height={34} />
            <span className="wordmark">MAKO</span>
          </a>
          <a href="#join" className="nav-cta">Join the waitlist</a>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-in">
          <h1 className="headline">
            The order flow terminal
            {" "}<br />
            that reads Hyperliquid for you
          </h1>
          <p className="sub">
            Every terminal shows you the data. Mako reads the flow, the funding and the crowd on Hyperliquid and tells you what it means.
          </p>
          <div id="join" className="join">
            <Waitlist id="email-hero" />
          </div>
          <p className="built">
            Built on <strong>Hyperliquid</strong>
          </p>
        </div>
        <div className="dome-anchor">
          <Dome />
        </div>
        <div className="shot-wrap">
          <Shot />
        </div>
      </section>

      <Features />

      <section className="markets" id="markets">
        <h2 className="h2">
          Every Hyperliquid perp,
          {" "}<br />
          read for you
        </h2>
        <p className="sub sub-sm">Majors, memes and the newest listings. Open any coin and see who’s in control, where funding is leaning and how the crowd is positioned.</p>
        <CoinWall />
      </section>

      <footer className="foot">
        <div className="foot-in">
          <span className="brand">
            <img src="/mako-star.webp" alt="" width={24} height={24} />
            <span className="wordmark">MAKO</span>
          </span>
          <p>Market information, not financial advice. Trading perpetuals carries a high risk of loss.</p>
          <span>© {new Date().getFullYear()} Mako</span>
        </div>
      </footer>
    </main>
  )
}
