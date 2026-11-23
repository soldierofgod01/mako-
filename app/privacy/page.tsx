import type { Metadata } from "next"
import { CONTACT_EMAIL, LegalPage } from "@/components/Legal"

export const metadata: Metadata = { title: "Privacy Policy · Mako" }

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>This policy explains what personal data Mako (makoapp.xyz and the Mako app) collects, why, and what you can do about it.</p>

      <h2>What we collect and why</h2>
      <ul>
        <li>
          <strong>Your email address</strong>, if you join the waitlist, along with when and where on the site you signed up. We use it
          only to tell you when Mako opens and to send occasional updates about Mako. Every email includes a way to unsubscribe.
        </li>
        <li>
          <strong>Basic technical data</strong> (IP address, browser type, pages requested), which our hosting provider receives whenever
          you visit. It’s used only to run and secure the site, and is kept briefly in server logs.
        </li>
      </ul>
      <p>
        Mako has no accounts, no advertising and no analytics or tracking. We don’t use cookies. The app saves your settings (such as chart
        timeframe and favourite markets) in your own browser; that data never leaves your device.
      </p>

      <h2>Who holds it</h2>
      <p>
        Your data is held by the hosting and database providers we use to run Mako. We don’t sell or rent your data, or share it for
        marketing. We’ll only disclose it if the law requires us to.
      </p>

      <h2>How long we keep it</h2>
      <p>We keep your email address until you unsubscribe or ask us to delete it.</p>

      <h2>Security</h2>
      <p>We take reasonable steps to protect your data, including restricting who can access it. If a breach affects your data, we’ll tell you as the law requires.</p>

      <h2>Age</h2>
      <p>Mako is for people aged 18 and over. We don’t knowingly collect data from anyone younger.</p>

      <h2>Changes</h2>
      <p>If we change this policy, we’ll update the date above and email the waitlist about any important change.</p>

      <h2>Contact</h2>
      <p>
        To unsubscribe, have your data deleted, or ask anything about it, email <strong>{CONTACT_EMAIL}</strong>.
      </p>
    </LegalPage>
  )
}
