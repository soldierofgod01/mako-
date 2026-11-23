import type { Metadata } from "next"
import { CONTACT_EMAIL, LegalPage } from "@/components/Legal"

export const metadata: Metadata = { title: "Risk Disclosure · Mako" }

export default function Risk() {
  return (
    <LegalPage title="Risk Disclosure">
      <h2>Mako is information, not advice</h2>
      <p>
        Everything Mako shows, including range regimes, order-flow reads, screener presets, volatility figures and any other signal or
        statistic, is general market information. It is not financial, investment, legal or tax advice, and it is not a recommendation to buy,
        sell or hold anything. It doesn’t take your circumstances into account. Mako is not a registered investment adviser or research
        analyst.
      </p>

      <h2>Perpetual futures are high risk</h2>
      <ul>
        <li>Leverage magnifies losses as well as gains. You can lose more than you expect, very quickly, and your positions can be liquidated.</li>
        <li>Crypto markets are volatile, trade around the clock and can move sharply with no warning.</li>
        <li>Funding payments, fees and slippage can add up to significant costs.</li>
        <li>Exchanges, including decentralised ones, carry technical, smart-contract, liquidity and counterparty risks.</li>
        <li>Crypto assets and derivatives are lightly regulated or unregulated in many countries, and may not be legal where you live.</li>
      </ul>

      <h2>Signals and statistics have limits</h2>
      <ul>
        <li>Probabilities describe how often something has happened before, not what will happen next. A “likely” outcome can still fail.</li>
        <li>Past performance and historical statistics don’t guarantee future results.</li>
        <li>Data can be delayed, incomplete or wrong, and models can stop working when market conditions change.</li>
      </ul>

      <h2>Your responsibility</h2>
      <p>
        Only trade with money you can afford to lose. Make your own decisions, do your own research, and consider speaking to a qualified,
        licensed adviser. You are solely responsible for your trades and their results.
      </p>

      <h2>Contact</h2>
      <p>Questions: <strong>{CONTACT_EMAIL}</strong>.</p>
    </LegalPage>
  )
}
