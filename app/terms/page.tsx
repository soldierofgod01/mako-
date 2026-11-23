import type { Metadata } from "next"
import { CONTACT_EMAIL, LegalPage } from "@/components/Legal"

export const metadata: Metadata = { title: "Terms of Use · Mako" }

export default function Terms() {
  return (
    <LegalPage title="Terms of Use">
      <p>
        These terms apply to your use of makoapp.xyz and the Mako app (together, “Mako”). By using Mako you agree to them. If you don’t
        agree, please don’t use Mako.
      </p>

      <h2>1. Who can use Mako</h2>
      <p>
        You must be at least 18 and able to enter a binding agreement. You’re responsible for making sure that using Mako, and trading
        crypto assets and derivatives, is legal where you live.
      </p>

      <h2>2. What Mako is</h2>
      <p>
        Mako is a market information and analytics tool for Hyperliquid perpetual futures. It does not execute trades, hold funds, connect to
        your wallet or manage money. Mako is in early access: features may change, break or be removed, and access may be limited or ended at
        any time.
      </p>

      <h2>3. Not financial advice</h2>
      <p>
        Nothing on Mako is financial, investment, legal or tax advice, or a recommendation to trade. All decisions are yours. Please read our{" "}
        <a href="/risk">Risk Disclosure</a>.
      </p>

      <h2>4. Data and accuracy</h2>
      <p>
        Mako relies on third-party data sources, including Hyperliquid, Deribit and CoinGecko. We do our best to show accurate, timely
        information, but we don’t guarantee that any data, signal or statistic is complete, accurate, current or available. Always check
        prices and positions on the exchange before acting.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>scrape, copy or resell Mako’s data or analysis in bulk, or build a competing product from it;</li>
        <li>overload, disrupt, attack or try to gain unauthorised access to Mako or its infrastructure;</li>
        <li>reverse engineer Mako, except where the law allows it;</li>
        <li>use Mako for anything unlawful, including market manipulation.</li>
      </ul>

      <h2>6. Intellectual property</h2>
      <p>
        Mako’s software, design, name, logo and original content belong to us. You may use Mako for your own trading and share screenshots
        with credit to Mako. Market data belongs to its respective sources.
      </p>

      <h2>7. No warranty</h2>
      <p>
        Mako is provided “as is” and “as available”, without warranties of any kind, express or implied, including fitness for a particular
        purpose, accuracy or uninterrupted availability, to the fullest extent the law allows.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        To the fullest extent the law allows, we are not liable for any trading losses, lost profits, or indirect, incidental or consequential
        damages arising from your use of, or inability to use, Mako or any information on it. While Mako is free, our total liability for any
        claim is limited to ₹1,000. Nothing in these terms limits liability that cannot be limited by law.
      </p>

      <h2>9. Indemnity</h2>
      <p>You agree to cover any claims, losses or costs that arise from your breach of these terms or your misuse of Mako.</p>

      <h2>10. Paid features</h2>
      <p>Mako is currently free. If we introduce paid plans, separate terms covering price, billing and refunds will apply to them, and we’ll tell you before you’re charged anything.</p>

      <h2>11. Ending access</h2>
      <p>You can stop using Mako at any time. We may suspend or end access for anyone who breaks these terms, or discontinue Mako altogether.</p>

      <h2>12. Changes to these terms</h2>
      <p>We may update these terms. We’ll change the date above, and for important changes we’ll give notice on the site or by email. Continuing to use Mako after a change means you accept the new terms.</p>

      <h2>13. Governing law</h2>
      <p>These terms are governed by the laws of India, and the courts of India have jurisdiction over any dispute, without affecting any mandatory consumer rights you have where you live.</p>

      <h2>14. Contact</h2>
      <p>Questions about these terms: <strong>{CONTACT_EMAIL}</strong>.</p>
    </LegalPage>
  )
}
