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
          <div className="nav-right">
            <a href="https://app.makoapp.xyz" className="nav-login">Log in</a>
            <a href="#join" className="nav-cta">Join the waitlist</a>
          </div>
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
            Built on
            <svg className="hl-mark" viewBox="2 5 20 14" aria-hidden="true">
              <path fill="currentColor" d="M21 11.937a9.4 9.4 0 0 1-.901 4.112c-.867 1.863-2.947 3.387-4.846 1.765-1.55-1.322-1.837-4.005-4.157-4.398-3.07-.361-3.145 3.092-5.15 3.482-2.236.44-2.978-3.206-2.945-4.862s.487-3.984 2.43-3.984c2.236 0 2.386 3.283 5.224 3.105 2.81-.186 2.86-3.602 4.696-5.064 1.585-1.264 3.448-.337 4.381 1.184.865 1.406 1.245 3.057 1.265 4.66z" />
            </svg>
            <strong>Hyperliquid</strong>
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
