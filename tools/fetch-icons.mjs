// Download every HL perp's icon (HL's own art first, cryptocurrency-icons second)
// into coins/<COIN>.svg, with scripts/handlers stripped. Writes coins/_report.json.
import { mkdir, writeFile } from "node:fs/promises";

const HL = "https://api.hyperliquid.xyz/info";
const HL_ICON = "https://app.hyperliquid.xyz/coins";
const OSS = "https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const meta = await (await fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "meta" }) })).json();
const coins = [...new Set(meta.universe.map((a) => a.name))];

function clean(svg) {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, "$1#");
}
async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 404 || r.status === 403) return null;
      if (r.ok) {
        const t = await r.text();
        return /<svg[\s>]/i.test(t) ? t : null;
      }
    } catch {}
    await sleep(500 * (i + 1));
  }
  return null;
}

await mkdir("coins", { recursive: true });
const report = { hl: [], oss: [], missing: [] };
for (const c of coins) {
  let svg = await get(`${HL_ICON}/${c}.svg`);
  let src = "hl";
  if (!svg) { svg = await get(`${OSS}/${c.replace(/^k(?=[A-Z])/, "").toLowerCase()}.svg`); src = "oss"; }
  if (!svg) { report.missing.push(c); continue; }
  await writeFile(`coins/${c}.svg`, clean(svg));
  report[src].push(c);
  await sleep(60);
}
await writeFile("coins/_report.json", JSON.stringify({ at: new Date().toISOString(), total: coins.length, ...Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])), missing: report.missing }, null, 1));
console.log(`total ${coins.length}, hl ${report.hl.length}, oss ${report.oss.length}, missing ${report.missing.length}`);
