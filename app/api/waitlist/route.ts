import { NextResponse } from "next/server"

// Stores waitlist emails in Supabase (table: waitlist, column: email unique).
// The key only needs insert rights: the table's RLS lets the public (anon) key add
// emails but never read them.
export async function POST(req: Request) {
  let email = ""
  try {
    const body = await req.json()
    email = String(body?.email ?? "").trim().toLowerCase()
  } catch {
    return NextResponse.json({ error: "Send an email address." }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: "That email address doesn’t look right." }, { status: 400 })
  }

  // Defaults are the trackr project's PUBLIC (anon) key, which is safe in code: the
  // waitlist table only lets it insert, never read. Env vars in Vercel override these.
  const url = process.env.SUPABASE_URL || "https://ishdsajdymoltebgrtoz.supabase.co"
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzaGRzYWpkeW1vbHRlYmdydG96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4OTY3MDMsImV4cCI6MjA5MTQ3MjcwM30.x3FY72qlOqaPLc4r2QiW_QkfRW-bc5oMooPQ53U_tII"

  const r = await fetch(`${url}/rest/v1/waitlist`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ email, source: "landing" }),
  })
  // 409 = already on the list; treat it as a success.
  if (!r.ok && r.status !== 409) {
    return NextResponse.json({ error: "Couldn’t save your email. Try again in a minute." }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
