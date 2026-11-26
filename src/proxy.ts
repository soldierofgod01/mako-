// ════════════════════════════════════════════════════════════════
// Auth gate (Clerk). Next 16 calls this file "proxy" (was "middleware").
// • Pages need a signed-in user; whether that user is *approved* for the
//   beta is checked in app/page.tsx (it shows the invite-only screen).
// • /api data routes need a signed-in AND approved user. Sign-up is open
//   (email code), so "signed in" alone would let anyone pull the data.
// • /api/track/market and /api/track/tick stay open: Supabase pg_cron calls
//   them with x-track-token, which Postgres itself verifies before writing.
// • The order-flow recorder (GitHub Actions) no longer calls Mako's API;
//   it builds the wallet cohorts itself (recorder/record.ts).
// ════════════════════════════════════════════════════════════════
import { clerkClient, clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasAccess } from "@/lib/access";

const isAuthPage = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/sso-callback(.*)"]);
const isCronApi = createRouteMatcher(["/api/track/market", "/api/track/tick"]);
const isApi = createRouteMatcher(["/api(.*)", "/trpc(.*)"]);

// Approval lookups hit Clerk's API, and every open tab polls several routes,
// so cache the answer per user on this instance. Approving or revoking a
// tester takes effect within these windows.
const APPROVED_TTL = 5 * 60_000;
const DENIED_TTL = 60_000;
const g = globalThis as unknown as { __makoApproved?: Map<string, { ok: boolean; at: number }> };
const approved = (g.__makoApproved ??= new Map());

async function isApproved(userId: string): Promise<boolean> {
  const hit = approved.get(userId);
  if (hit && Date.now() - hit.at < (hit.ok ? APPROVED_TTL : DENIED_TTL)) return hit.ok;
  try {
    const user = await (await clerkClient()).users.getUser(userId);
    const ok = hasAccess(user);
    approved.set(userId, { ok, at: Date.now() });
    if (approved.size > 5000) approved.clear();
    return ok;
  } catch (e) {
    // Clerk unreachable: keep a recent yes rather than locking testers out.
    console.error("proxy: approval lookup failed", String(e).slice(0, 160));
    return hit?.ok ?? false;
  }
}

export default clerkMiddleware(
  async (auth, req) => {
    if (isAuthPage(req) || isCronApi(req)) return;
    if (isApi(req)) {
      const { userId } = await auth();
      if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
      if (!(await isApproved(userId))) return NextResponse.json({ error: "Beta access required" }, { status: 403 });
      return;
    }
    await auth.protect();
  },
  // Send signed-out users to Mako's own sign-in page, not Clerk's hosted one.
  { signInUrl: "/sign-in", signUpUrl: "/sign-in" }
);

export const config = {
  matcher: [
    // Skip Next internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
