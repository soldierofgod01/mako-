import type { Metadata } from "next"
import { CONTACT_EMAIL, LegalPage } from "@/components/Legal"

export const metadata: Metadata = { title: "Terms of Use · Mako" }

export default function Terms() {
  return (
    <LegalPage title="Terms of Use">
      <p>By using Mako (makoapp.xyz and the Mako app), you agree to these terms.</p>

      <h2>1. Using Mako</h2>
      <p>You must be 18 or over. You’re responsible for making sure that using Mako, and trading crypto, is legal where you live.</p>

      <h2>2. What Mako is</h2>
      <p>
        Mako is a market information tool for Hyperliquid perpetuals. It doesn’t place trades, hold funds or connect to your wallet. Mako is
        in early access, so features may change or stop working, and we may limit or end access at any time.
      </p>

      <h2>3. Not financial advice</h2>
      <p>
        Everything on Mako, including range regimes, order-flow reads and screener results, is general market information, not financial
        advice or a recommendation to trade. Probabilities describe how often something has happened before, not what will happen next.
      </p>
      <p>
        Trading perpetuals with leverage is high risk: you can lose money quickly and positions can be liquidated. Only trade with money you
        can afford to lose. Your trades and their results are your responsibility.
      </p>

      <h2>4. Data accuracy</h2>
      <p>Mako relies on third-party data. We work to keep it accurate but can’t guarantee it is complete, correct or up to date. Always check the exchange before acting.</p>

      <h2>5. Acceptable use</h2>
      <p>Don’t scrape or resell Mako’s data or analysis, disrupt or attack the service, or use it for anything unlawful, including market manipulation.</p>

      <h2>6. Ownership</h2>
      <p>Mako’s software, design, name and logo belong to us. You’re welcome to share screenshots with credit to Mako.</p>

      <h2>7. Liability</h2>
      <p>
        Mako is provided “as is”, without warranties. To the fullest extent the law allows, we aren’t liable for trading losses or any
        indirect or consequential damages from using Mako or relying on its information.
      </p>

      <h2>8. Changes</h2>
      <p>We may update these terms. If you keep using Mako after a change, you accept the updated terms.</p>

      <h2>9. Contact</h2>
      <p><strong>{CONTACT_EMAIL}</strong></p>
    </LegalPage>
  )
}
