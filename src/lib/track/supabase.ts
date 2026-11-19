// Minimal Supabase REST client (no SDK). Uses the public anon key: the
// table is read-only to anon via RLS, and the only write path is the
// token-checked `track_ingest` function.

// Public by design: the anon key can only read track_snapshots (RLS) and call
// track_ingest, which rejects any call without the secret stored in Postgres.
const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://ishdsajdymoltebgrtoz.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzaGRzYWpkeW1vbHRlYmdydG96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4OTY3MDMsImV4cCI6MjA5MTQ3MjcwM30.x3FY72qlOqaPLc4r2QiW_QkfRW-bc5oMooPQ53U_tII";

export async function supabaseRpc<T = unknown>(fn: string, args: object): Promise<T> {
  const url = SUPABASE_URL;
  const key = SUPABASE_ANON_KEY;
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`supabase ${fn} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

/** Read a table through PostgREST (tables with a public-read RLS policy only). */
export async function supabaseSelect<T = unknown>(table: string, query: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`supabase ${table} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}
