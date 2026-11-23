"use client";
import { fmtUsd } from "@/lib/bias/engine";
import { fmtPrice } from "@/lib/bias/format";
import type { VolState } from "@/lib/vol/use-vol";
import { cn } from "@/lib/utils";
import { TimeChart, type SeriesSpec } from "@/components/analytics/charts";
import { XYChart } from "@/components/analytics/mini-chart";

// ════════════════════════════════════════════════════════════════
// Volatility tab — implied vs realised vol, skew, term structure and what
// the options market's Greeks add up to (dealer gamma, flip, max pain).
// Every number gets one plain-English line: interpretation, not a chain.
// ════════════════════════════════════════════════════════════════

const usd = (x: number) => fmtUsd(x).replace("+", "");
const pts = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(1)}`;
/** Strikes without trailing zeros (78, 1.35, 64,000). */
const fmtStrike = (k: number) => (k >= 1000 ? k.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(+k.toPrecision(6)));
const fmtExp = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

type Tone = "pos" | "neg" | "warn" | undefined;

export function VolPanel({ vol, px }: { vol: VolState; px: number | null }) {
  const s = vol.surface;
  const spot = px ?? s?.spot ?? null;
  const iv = vol.dvolNow ?? s?.atm30 ?? null;
  const ivLabel = vol.dvolNow != null ? "DVOL" : "ATM IV · 30d";
  const rv30 = vol.rv?.d30 ?? null;

  if (vol.loading && !s && !vol.rv) {
    return <div className="p-4 grid grid-cols-4 gap-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[72px] skeleton" />)}</div>;
  }

  const tiles: { label: string; value: string; sub?: string; read: string; tone?: Tone }[] = [];

  // Implied
  if (iv != null) {
    tiles.push({
      label: ivLabel,
      value: iv.toFixed(1),
      sub: vol.dvolNow != null ? "Deribit 30-day implied vol index" : "Interpolated from the chain",
      read: `Options price a ~${(iv / Math.sqrt(365)).toFixed(1)}% daily move (1σ).`,
    });
  }
  // Realised
  if (vol.rv) {
    tiles.push({
      label: "Realised vol",
      value: rv30 != null ? rv30.toFixed(1) : "—",
      sub: `24h ${vol.rv.d1?.toFixed(1) ?? "—"} · 7d ${vol.rv.d7?.toFixed(1) ?? "—"} · 30d`,
      read:
        vol.rv.d1 != null && rv30 != null
          ? vol.rv.d1 > rv30 * 1.25 ? "Last 24h is moving well above its 30-day pace." : vol.rv.d1 < rv30 * 0.75 ? "Last 24h is quieter than its 30-day pace — compression." : "Moving at its usual 30-day pace."
          : "Hyperliquid 1h candles, annualised.",
    });
  }
  // IV − RV
  if (iv != null && rv30 != null) {
    const sp = iv - rv30;
    tiles.push({
      label: "IV − RV",
      value: pts(sp),
      sub: `${ivLabel} vs 30d realised`,
      tone: sp > 5 ? "warn" : sp < -5 ? "pos" : undefined,
      read: sp > 5 ? "Options price more movement than is being delivered — vol is rich." : sp < -5 ? "Options are cheap vs what price is actually doing." : "Implied ≈ realised — vol fairly priced.",
    });
  }
  if (s) {
    if (s.skew25 != null) {
      tiles.push({
        label: "25Δ skew · 30d",
        value: pts(s.skew25),
        sub: "Call IV − put IV, vol points",
        tone: s.skew25 < -3 ? "neg" : s.skew25 > 3 ? "pos" : undefined,
        read: s.skew25 < -3 ? "Puts bid over calls — the market is paying for downside protection." : s.skew25 > 3 ? "Calls bid over puts — demand for upside." : "Balanced — no strong hedging lean either way.",
      });
    }
    if (s.front && s.back && s.back.expiry !== s.front.expiry) {
      const inv = s.front.atmIv - s.back.atmIv;
      tiles.push({
        label: "Term structure",
        value: `${s.front.atmIv.toFixed(1)} → ${s.back.atmIv.toFixed(1)}`,
        sub: `${fmtExp(s.front.expiry)} → ${fmtExp(s.back.expiry)} ATM IV`,
        tone: inv > 2 ? "warn" : undefined,
        read: inv > 2 ? "Inverted — near-term stress or an event being priced." : inv < -2 ? "Upward sloping — calm near term." : "Flat — no near-term premium.",
      });
    }
    if (s.putCallOi != null) {
      tiles.push({
        label: "Put / call OI",
        value: s.putCallOi.toFixed(2),
        sub: `${usd(s.totalOi * (spot ?? s.spot))} open interest`,
        read: s.putCallOi > 1.1 ? "More puts than calls open — positioned defensively." : s.putCallOi < 0.7 ? "Call-heavy — positioned for upside." : "Roughly balanced positioning.",
      });
    }
    // Dealer long/short gamma is NOT shown: tested Nov 2026, the usual "customers buy puts,
    // sell calls" assumption was ~50/50 on Deribit and backwards on near-dated flow. Only the
    // unsigned concentration (straight from open interest) is shown until tape-based
    // positioning exists.
    if (spot) {
      const near = s.gex.filter((g) => Math.abs(g.strike - spot) / spot <= 0.1).sort((a, b) => b.abs - a.abs);
      const top = near[0];
      if (top) {
        const dist = ((top.strike - spot) / spot) * 100;
        tiles.push({
          label: "Gamma concentration",
          value: fmtStrike(top.strike),
          sub: `${usd(top.abs)} per 1% · ${dist > 0 ? "+" : ""}${dist.toFixed(1)}% from price`,
          read: "Strike with the most option gamma near price — where hedging flows are heaviest.",
        });
      }
    }
    if (s.maxPain && spot) {
      const dist = ((s.maxPain.strike - spot) / spot) * 100;
      tiles.push({
        label: `Max pain · ${fmtExp(s.maxPain.expiry)}`,
        value: fmtStrike(s.maxPain.strike),
        sub: `${dist > 0 ? "+" : ""}${dist.toFixed(1)}% from price`,
        read: "Strike where most options expire worthless. Pull matters most in the final day.",
      });
    }
  }

  return (
    <div className="p-3 flex flex-col gap-3 h-full">
    <div className="flex gap-3 shrink-0">
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <CoverageLine vol={vol} />
        <div className="flex-1 grid grid-cols-2 xl:grid-cols-4 auto-rows-fr gap-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border border-border bg-[#0C0C0F] px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] text-txt-secondary truncate">{t.label}</span>
                <span className={cn("ds-num text-[17px] font-semibold whitespace-nowrap",
                  t.tone === "pos" ? "text-positive" : t.tone === "neg" ? "text-negative" : t.tone === "warn" ? "text-warning" : "text-txt-primary")}>
                  {t.value}
                </span>
              </div>
              {t.sub && <div className="ds-num text-[12px] text-txt-muted mt-0.5 truncate">{t.sub}</div>}
              <p className="text-[13px] text-[#C2C2C8] leading-[1.45] mt-1">{t.read}</p>
            </div>
          ))}
        </div>
      </div>
      {s && spot && <GexBars vol={vol} spot={spot} />}
    </div>
    <VolCharts vol={vol} />
    </div>
  );
}

// ─── Charts (Analytics) ─────────────────────────────────────────

const IV_C = "#B26BFF", RV_C = "#4C8DFF", CALL_C = "#2BD4D9", PUT_C = "#F0643C";

function ChartBox({ title, sub, legend, children }: { title: string; sub?: string; legend?: { label: string; color: string; dashed?: boolean }[]; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-[#0C0C0F] px-3 pt-2.5 pb-2 min-w-0 min-h-0 flex flex-col">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-txt-primary">{title}</span>
        {sub && <span className="text-[12px] text-txt-muted truncate">{sub}</span>}
      </div>
      <div className="mt-2 flex-1 min-h-0 relative">{children}</div>
      {legend && (
        <div className="mt-1.5 flex items-center gap-4">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 text-[12px] text-txt-secondary">
              <span className="w-3 h-[2px] rounded" style={{ background: l.color }} />{l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function VolCharts({ vol }: { vol: VolState }) {
  const s = vol.surface;
  const ivSeries = vol.dvol && vol.dvol.length > 2 ? vol.dvol.filter((p) => p.t >= vol.dvol![vol.dvol!.length - 1].t - 30 * 86_400_000) : null;
  const rvSeries = vol.rvSeries && vol.rvSeries.length > 2 ? vol.rvSeries : null;
  const ivrv: SeriesSpec[] = [];
  if (ivSeries) ivrv.push({ kind: "line", color: IV_C, data: ivSeries });
  if (rvSeries) ivrv.push({ kind: "line", color: RV_C, data: rvSeries });
  const term = s?.term.filter((p) => p.days <= 200) ?? [];
  const smile = s?.smile;
  const fmtK = (k: number) => (k >= 1000 ? `${(k / 1000).toFixed(k >= 10000 ? 0 : 1)}k` : String(+k.toPrecision(3)));
  const cols = [ivrv.length > 0, term.length >= 3, !!smile].filter(Boolean).length;
  if (!cols) return null;
  return (
    <div className={cn("flex-1 min-h-[280px] grid gap-3 grid-cols-1", cols >= 3 ? "xl:grid-cols-3" : cols === 2 ? "xl:grid-cols-2" : "")}>
      {ivrv.length > 0 && (
        <ChartBox
          title={ivSeries ? "Implied vs realised" : "Realised vol"}
          sub="last 30 days · annualised %"
          legend={[...(ivSeries ? [{ label: vol.dvolNow != null ? "DVOL (implied)" : "Implied", color: IV_C }] : []), { label: "Realised 30d", color: RV_C }]}
        >
          <div className="absolute inset-0"><TimeChart series={ivrv} format={(v) => v.toFixed(0)} /></div>
        </ChartBox>
      )}
      {term.length >= 3 && (
        <ChartBox title="Term structure" sub="ATM implied vol by expiry">
          <XYChart
            series={[{ label: "ATM IV", color: IV_C, pts: term.map((p) => ({ x: p.days, y: p.atmIv })) }]}
            xFormat={(d) => `${Math.round(d)}d`}
            yFormat={(v) => v.toFixed(1)}
            vlines={[{ x: 30, label: "30d" }]}
            xLabel="Expiry in"
          />
        </ChartBox>
      )}
      {smile && (
        <ChartBox title="Smile" sub={`IV by strike · ${fmtExp(smile.expiry)} expiry`} legend={[{ label: "OTM puts", color: PUT_C }, { label: "OTM calls", color: CALL_C }]}>
          <XYChart
            series={[
              // Out-of-the-money side only (puts below price, calls above) — the standard smile.
              { label: "Put IV", color: PUT_C, pts: smile.pts.filter((p) => p.put != null && p.strike <= smile.fwd).map((p) => ({ x: p.strike, y: p.put! })) },
              { label: "Call IV", color: CALL_C, pts: smile.pts.filter((p) => p.call != null && p.strike >= smile.fwd).map((p) => ({ x: p.strike, y: p.call! })) },
            ]}
            xFormat={fmtK}
            yFormat={(v) => v.toFixed(1)}
            vlines={[{ x: smile.fwd, label: "price" }]}
            xLabel="Strike"
          />
        </ChartBox>
      )}
    </div>
  );
}

function CoverageLine({ vol }: { vol: VolState }) {
  const txt =
    vol.coverage === "full" ? `Deribit ${vol.coin} options · full chain`
      : vol.coverage === "thin" ? `Deribit ${vol.coin}_USDC options · thin market, IV and gamma are noisier`
        : `${vol.coin} has no listed options — realised vol only`;
  return (
    <div className="flex items-center gap-2 text-[12px] text-txt-secondary">
      <span className={cn("w-1.5 h-1.5 rounded-full", vol.error ? "bg-negative" : vol.coverage === "full" ? "bg-positive" : vol.coverage === "thin" ? "bg-warning" : "bg-txt-muted")} />
      {vol.error ? "Couldn't reach Deribit from this network" : txt}
      {vol.updatedAt && <span className="text-txt-muted">· updated {new Date(vol.updatedAt).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" })}</span>}
    </div>
  );
}

/** Option gamma by strike near price (calls + puts, no dealer direction assumed). */
function GexBars({ vol, spot }: { vol: VolState; spot: number }) {
  const s = vol.surface!;
  const near = s.gex.filter((g) => Math.abs(g.strike - spot) / spot <= 0.1 && g.abs > 0);
  const rows = near
    .sort((a, b) => b.abs - a.abs)
    .slice(0, 14)
    .sort((a, b) => b.strike - a.strike);
  const max = Math.max(...rows.map((r) => r.abs), 1);
  const spotIdx = rows.findIndex((r) => r.strike < spot);
  return (
    <div className="w-[260px] shrink-0 rounded-lg border border-border bg-[#0C0C0F] px-3 py-2.5 flex flex-col">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] text-txt-secondary">Gamma by strike · ±10%</span>
        <span className="text-[12px] text-txt-muted">$ per 1%</span>
      </div>
      <div className="mt-1.5 flex flex-col">
        {rows.map((r, i) => (
          <div key={r.strike}>
            {i === spotIdx && (
              <div className="flex items-center gap-1.5 my-0.5">
                <span className="flex-1 h-px bg-border-strong" />
                <span className="ds-num text-[11.5px] text-txt-primary">{fmtPrice(spot)}</span>
                <span className="flex-1 h-px bg-border-strong" />
              </div>
            )}
            <div className="grid grid-cols-[64px_1fr_52px] items-center h-[19px] gap-1.5 ds-num text-[12px]">
              <span className="text-right text-txt-secondary">{fmtStrike(r.strike)}</span>
              <div className="relative h-2">
                <div className="absolute inset-y-0 left-0 rounded-sm bg-[#A78BFA]/60" style={{ width: `${(r.abs / max) * 100}%` }} />
              </div>
              <span className="text-right text-txt-secondary">{usd(r.abs)}</span>
            </div>
          </div>
        ))}
        {rows.length === 0 && <span className="text-[13px] text-txt-secondary mt-1">No meaningful gamma near price.</span>}
      </div>
      <p className="mt-auto pt-2 text-[12px] text-txt-muted leading-[1.4]">
        Gamma from open interest, calls and puts combined. Which side dealers hold isn&rsquo;t public, so no direction is shown.
      </p>
    </div>
  );
}
