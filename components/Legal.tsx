import Link from "next/link"

// Shared shell for the legal pages: same nav and footer as the home page, a narrow reading column.

export const CONTACT_EMAIL = "[contact email]"
export const UPDATED = "24 November 2026"

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main>
      <header className="nav">
        <div className="nav-in">
          <Link href="/" className="brand" aria-label="Mako home">
            <img src="/mako-star.webp" alt="" width={34} height={34} />
            <span className="wordmark">MAKO</span>
          </Link>
          <Link href="/#join" className="nav-cta">Join the waitlist</Link>
        </div>
      </header>
      <article className="legal">
        <h1 className="legal-title">{title}</h1>
        <p className="legal-updated">Last updated {UPDATED}</p>
        {children}
      </article>
      <LegalFooter />
    </main>
  )
}

export function LegalFooter() {
  return (
    <footer className="foot">
      <div className="foot-in">
        <span className="brand">
          <img src="/mako-star.webp" alt="" width={24} height={24} />
          <span className="wordmark">MAKO</span>
        </span>
        <p>Market information, not financial advice. Trading perpetuals carries a high risk of loss.</p>
        <nav className="foot-links" aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/cookies">Cookies</Link>
          <Link href="/risk">Risk</Link>
        </nav>
        <span>© {new Date().getFullYear()} Mako</span>
      </div>
    </footer>
  )
}
