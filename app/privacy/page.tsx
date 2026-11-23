import type { Metadata } from "next"
import { CONTACT_EMAIL, LegalPage } from "@/components/Legal"

export const metadata: Metadata = { title: "Privacy Policy · Mako" }

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains what personal data Mako collects through makoapp.xyz and the Mako app (together, “Mako”), why, and what you
        can do about it. Mako is operated from India. Where this policy says “we” or “us”, it means the operator of Mako.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>The only personal data we ask for is your email address, if you join the waitlist.</li>
        <li>Mako has no accounts, no advertising and no analytics or tracking tools.</li>
        <li>We don’t sell or rent your data, and we don’t share it for marketing.</li>
      </ul>

      <h2>What we collect</h2>
      <h3>Your email address (waitlist)</h3>
      <p>
        When you join the waitlist we store your email address, the time you signed up and where you signed up from (for example, “landing”).
        We use it only to tell you when Mako opens and to send occasional updates about Mako. Every email we send will tell you how to stop
        receiving them.
      </p>
      <h3>Technical data</h3>
      <p>
        Like any website, our hosting provider receives your IP address, browser type and the pages you request when you visit. This is used
        to deliver the site, keep it secure and fix problems, and is kept in short-lived server logs. We don’t use it to identify you.
      </p>
      <h3>Settings stored on your device</h3>
      <p>
        The Mako app remembers your choices (such as chart timeframe, indicators and favourite markets) in your browser’s local storage. This
        stays on your device and is never sent to us. See our <a href="/cookies">Cookie Policy</a>.
      </p>
      <h3>Public market data</h3>
      <p>
        Mako analyses public Hyperliquid market data, including activity of public wallet addresses, to produce aggregate statistics. We
        don’t link this data to you or to any named person.
      </p>

      <h2>Why we’re allowed to use it</h2>
      <p>
        We process your email address because you gave it to us to join the waitlist (your consent). You can withdraw that consent at any
        time, and we’ll delete your address. Technical data is processed because it’s needed to run and secure the site.
      </p>

      <h2>Who we share it with</h2>
      <p>We use a small number of service providers who process data on our behalf:</p>
      <ul>
        <li>a <strong>hosting provider</strong>, which runs the website and app (and sees the technical data described above);</li>
        <li>a <strong>database provider</strong>, which stores the waitlist on servers in Singapore.</li>
      </ul>
      <p>
        When you use the Mako app, your browser also loads market data and images directly from third parties, which therefore see your IP
        address: Hyperliquid (market data and coin icons), Deribit (options data), CoinGecko (market data), jsDelivr (coin icons) and Google
        Fonts (typefaces). Their own privacy policies apply to those requests.
      </p>
      <p>We may also disclose data if the law requires it.</p>

      <h2>International transfers</h2>
      <p>
        Our providers may process data outside India, including in Singapore and the United States. We only use providers that protect data
        to a standard consistent with this policy.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your email address until Mako launches and for as long as you stay subscribed to updates. If you ask us to delete it, or
        unsubscribe, we delete it. Server logs are kept only briefly by our hosting provider.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask us to tell you what personal data we hold about you, correct it, or delete it, and you can withdraw your consent at any
        time. You can also nominate someone to exercise these rights on your behalf. To do any of this, or to raise a complaint, email{" "}
        <strong>{CONTACT_EMAIL}</strong>. We aim to reply within 30 days. If you’re unhappy with our answer, you may complain to the Data
        Protection Board of India or your local data protection authority.
      </p>

      <h2>Security</h2>
      <p>
        We take reasonable steps to protect your data: the waitlist can only be added to from the website, never read from it, and access to
        it is restricted. No system is perfectly secure, and if a breach affects your data we will tell you as the law requires.
      </p>

      <h2>Children</h2>
      <p>Mako is for adults. We don’t knowingly collect data from anyone under 18. If you believe a child has joined the waitlist, contact us and we’ll delete it.</p>

      <h2>Changes</h2>
      <p>If we change this policy we’ll update the date above, and we’ll email the waitlist about any important change before it takes effect.</p>

      <h2>Contact</h2>
      <p>Questions or requests: <strong>{CONTACT_EMAIL}</strong>.</p>
    </LegalPage>
  )
}
