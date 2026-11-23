import type { Metadata } from "next"
import { CONTACT_EMAIL, LegalPage } from "@/components/Legal"

export const metadata: Metadata = { title: "Cookie Policy · Mako" }

export default function Cookies() {
  return (
    <LegalPage title="Cookie Policy">
      <h2>We don’t use cookies</h2>
      <p>
        makoapp.xyz and the Mako app don’t set cookies, and we don’t use analytics, advertising or tracking tools of any kind. That’s why
        there’s no cookie banner.
      </p>

      <h2>What we do store on your device</h2>
      <p>
        The Mako app uses your browser’s <strong>local storage</strong> to remember your settings between visits. This data stays in your
        browser, is never sent to us, and isn’t used to track you. It includes:
      </p>
      <ul>
        <li>Chart settings: timeframe, chart type, price scale and which indicators are on</li>
        <li>Layout: which panels are open, panel sizes and selected tabs</li>
        <li>Screener: favourite markets, column order and hidden columns, display units</li>
        <li>The coin you last viewed</li>
        <li>A short buffer of recent public market trades, so charts can resume where they left off</li>
      </ul>
      <p>
        These are strictly necessary for the app to work the way you set it up, so they don’t require consent. You can clear them at any
        time in your browser’s settings (usually under “site data”). The app will simply go back to its defaults.
      </p>

      <h2>Third-party content</h2>
      <p>
        The app loads market data, coin icons and fonts directly from third parties (see the{" "}
        <a href="/privacy">Privacy Policy</a>). These requests don’t set cookies for us, but those providers receive your IP address as part
        of any normal web request.
      </p>

      <h2>If this changes</h2>
      <p>If we ever add cookies or analytics, we’ll update this page first and ask for your consent where the law requires it.</p>

      <h2>Contact</h2>
      <p>Questions: <strong>{CONTACT_EMAIL}</strong>.</p>
    </LegalPage>
  )
}
