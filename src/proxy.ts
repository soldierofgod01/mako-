// ════════════════════════════════════════════════════════════════
// Auth gate (Clerk). Next 16 calls this file "proxy" (was "middleware").
// Every page needs a signed-in user; whether that user is *approved*
// for the beta is checked in app/page.tsx.
// /api stays public for now: the order-flow recorder (GitHub Actions)
// calls /api/cohorts without a session, and the data is Hyperliquid's
// public data anyway.
// ════════════════════════════════════════════════════════════════
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/sso-callback(.*)", "/api(.*)"]);

export default clerkMiddleware(
  async (auth, req) => {
    if (!isPublic(req)) await auth.protect();
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
