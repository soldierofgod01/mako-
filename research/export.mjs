// Export recorder tables + HL history to research-data/ (committed back to this branch).
import { writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
const URL_ = "https://ishdsajdymoltebgrtoz.supabase.co/rest/v1";
const KEY = process.env.SUPABASE_ANON_KEY;
const HL = "https://api.hyperliquid.xyz/info";
const COINS = "BTC,ETH,HYPE,SOL,ZEC,XRP,DOGE,LIT,NEAR,XMR,PUMP,VVV,kPEPE,AAVE,UNI,ZRO,XPL,ENA,WLD,ASTER".split(",");
mkdirSync("research-data", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sel(table, cols, filter) {
  const out = []; const page = 1000;
  for (let off = 0; ; off += page) {
    const r = await fetch(`${URL_}/${table}?select=${cols}&${filter}&order=t.asc,coin.asc&limit=${page}&offset=${off}`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) throw new Error(`${table} ${r.status} ${await r.text()}`);
    const j = await r.json(); out.push(...j);
    if (j.length < page) break;
  }
  return out;
}
const csv = (rows, cols) => cols.join(",") + "\n" + rows.map((r) => cols.map((c) => (r[c] ?? "")).join(",")).join("\n");
const save = (name, text) => { writeFileSync(`research-data/${name}.gz`, gzipSync(text)); console.log(name, text.length); };

const bars = await sel("flow_bars", "t,coin,buy_usd,sell_usd,trades,o,h,l,c", "t=gte.2026-11-01");
save("flow_bars.csv", csv(bars, ["t","coin","buy_usd","sell_usd","trades","o","h","l","c"]));
for (const hz of ["15m", "1h", "5m"]) {
  const b = await sel("flow_bias", "t,coin,raw,score,direction,coverage,px,mid,sig", `horizon=eq.${hz}`);
  const keys = ["d","a","o","w","b","f","c"];
  const rows = b.map((r) => { const o = { ...r }; for (const k of keys) o["s_" + k] = r.sig?.[k] ?? ""; return o; });
  save(`flow_bias_${hz}.csv`, csv(rows, ["t","coin","raw","score","direction","coverage","px","mid", ...keys.map((k) => "s_" + k)]));
}
async function info(body) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    await sleep(2000 * (i + 1));
  }
  throw new Error("HL failed " + JSON.stringify(body));
}
const now = Date.now();
for (const iv of ["1m", "5m", "15m", "1h"]) {
  const span = { "1m": 5000 * 6e4, "5m": 5000 * 3e5, "15m": 5000 * 9e5, "1h": 5000 * 36e5 }[iv];
  const rows = [];
  for (const coin of COINS) {
    const k = await info({ type: "candleSnapshot", req: { coin, interval: iv, startTime: now - span, endTime: now } });
    for (const c of k) rows.push({ t: c.t, coin, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, n: c.n });
    await sleep(300);
  }
  save(`candles_${iv}.csv`, csv(rows, ["t","coin","o","h","l","c","v","n"]));
}
const fr = [];
for (const coin of COINS) {
  let start = now - 210 * 864e5;
  while (start < now) {
    const k = await info({ type: "fundingHistory", coin, startTime: start });
    if (!k.length) break;
    for (const f of k) fr.push({ t: f.time, coin, rate: f.fundingRate, premium: f.premium });
    start = k[k.length - 1].time + 1;
    if (k.length < 500) break;
    await sleep(300);
  }
}
save("funding.csv", csv(fr, ["t","coin","rate","premium"]));
