"use client";
// ════════════════════════════════════════════════════════════════
// Mako's own sign-in screen. Clerk runs the accounts behind it, but
// none of Clerk's UI is used: one panel handles both new and returning
// users (email → 6-digit code), plus Google. No passwords.
// Invite links from the Clerk dashboard (?__clerk_ticket=…) are
// accepted automatically.
// ════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import type { EmailCodeFactor } from "@clerk/shared/types";

type Step = "email" | "code";
type Mode = "signin" | "signup";

function errMsg(e: unknown): string {
  if (isClerkAPIResponseError(e)) {
    const first = e.errors[0];
    return first?.longMessage || first?.message || "Something went wrong.";
  }
  return "Something went wrong. Try again.";
}
const errCode = (e: unknown) => (isClerkAPIResponseError(e) ? e.errors[0]?.code : undefined);

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

// Google sign-in stays hidden until the privacy policy is live (Google
// requires it to publish the OAuth app). Turn on with NEXT_PUBLIC_AUTH_GOOGLE=1.
const GOOGLE_ON = process.env.NEXT_PUBLIC_AUTH_GOOGLE === "1";

const pill =
  "h-10 w-full rounded-full text-[13px] font-medium inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export function AuthCard() {
  const router = useRouter();
  const params = useSearchParams();
  const { isLoaded: inLoaded, signIn, setActive } = useSignIn();
  const { isLoaded: upLoaded, signUp } = useSignUp();
  const ready = inLoaded && upLoaded;

  const [step, setStep] = useState<Step>("email");
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<null | "email" | "code" | "google" | "ticket">(null);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const done = async (sessionId: string | null) => {
    if (!sessionId || !setActive) throw new Error("no session");
    await setActive({ session: sessionId });
    router.replace("/");
  };

  // Invite link from the Clerk dashboard
  const ticket = params.get("__clerk_ticket");
  useEffect(() => {
    if (!ready || !ticket || busy) return;
    (async () => {
      setBusy("ticket");
      try {
        const r = await signUp!.create({ strategy: "ticket", ticket });
        if (r.status === "complete") return done(r.createdSessionId);
        setError("This invite needs more details. Sign in with your email instead.");
      } catch (e) {
        // Already has an account → sign in with the ticket
        try {
          const r = await signIn!.create({ strategy: "ticket", ticket });
          if (r.status === "complete") return done(r.createdSessionId);
        } catch {
          setError(errMsg(e));
        }
      }
      setBusy(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ticket]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!ready || !email.trim()) return;
    setBusy("email");
    setError(null);
    const identifier = email.trim();
    try {
      const r = await signIn!.create({ identifier });
      const factor = r.supportedFirstFactors?.find(
        (f): f is EmailCodeFactor => f.strategy === "email_code"
      );
      if (!factor) throw new Error("no email code");
      await signIn!.prepareFirstFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId });
      setMode("signin");
      setStep("code");
    } catch (err) {
      if (errCode(err) === "form_identifier_not_found") {
        // New user → create the account and verify the email
        try {
          await signUp!.create({ emailAddress: identifier });
          await signUp!.prepareEmailAddressVerification({ strategy: "email_code" });
          setMode("signup");
          setStep("code");
        } catch (err2) {
          setError(errMsg(err2));
        }
      } else {
        setError(errMsg(err));
      }
    }
    setCode("");
    setBusy(null);
  }

  async function verify(e?: React.FormEvent) {
    e?.preventDefault();
    if (!ready || code.length < 6) return;
    setBusy("code");
    setError(null);
    try {
      if (mode === "signin") {
        const r = await signIn!.attemptFirstFactor({ strategy: "email_code", code });
        if (r.status === "complete") return await done(r.createdSessionId);
      } else {
        const r = await signUp!.attemptEmailAddressVerification({ code });
        if (r.status === "complete") return await done(r.createdSessionId);
      }
      setError("Couldn't finish signing in. Try again.");
    } catch (err) {
      setError(errMsg(err));
    }
    setBusy(null);
  }

  async function google() {
    if (!ready) return;
    setBusy("google");
    setError(null);
    try {
      await signIn!.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/",
      });
    } catch (err) {
      setError(errMsg(err));
      setBusy(null);
    }
  }

  return (
    <div className="ds-card-panel w-full max-w-[380px] px-7 pt-8 pb-7">
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static logo */}
      <img src="/mako-star.png" alt="Mako" width={32} height={32} className="w-8 h-8 mx-auto mb-5 object-contain" />

      {busy === "ticket" ? (
        <p className="text-center text-[13px] text-txt-secondary py-6">Accepting your invite…</p>
      ) : step === "email" ? (
        <>
          <h1 className="text-center text-[17px] font-semibold text-txt-primary tracking-[-0.01em]">Sign in to Mako</h1>
          <p className="text-center text-[13px] text-txt-secondary mt-1.5 mb-6">
            {GOOGLE_ON ? "Use Google or get a code by email." : "We\u2019ll email you a 6-digit code."}
          </p>

          {GOOGLE_ON && (
            <>
              <button type="button" onClick={google} disabled={!ready || !!busy} className={`${pill} bg-white text-black hover:bg-white/90`}>
                <GoogleMark />
                {busy === "google" ? "Redirecting…" : "Continue with Google"}
              </button>

              <div className="flex items-center gap-3 my-5">
                <span className="h-px flex-1 bg-white/[0.07]" />
                <span className="text-[11px] text-txt-muted">or</span>
                <span className="h-px flex-1 bg-white/[0.07]" />
              </div>
            </>
          )}

          <form onSubmit={sendCode} className="flex flex-col gap-2.5">
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 w-full rounded-full bg-white/[0.04] ring-1 ring-inset ring-white/[0.08] px-4 text-[13px] text-txt-primary placeholder:text-txt-muted outline-none focus:ring-white/[0.22] transition-shadow"
            />
            <button type="submit" disabled={!ready || !!busy || !email.trim()} className={`${pill} ${GOOGLE_ON ? "bg-white/[0.07] ring-1 ring-inset ring-white/[0.08] text-txt-primary hover:bg-white/[0.1]" : "bg-white text-black hover:bg-white/90"}`}>
              {busy === "email" ? "Sending code…" : "Continue with email"}
            </button>
          </form>
        </>
      ) : (
        <>
          <h1 className="text-center text-[17px] font-semibold text-txt-primary tracking-[-0.01em]">Check your email</h1>
          <p className="text-center text-[13px] text-txt-secondary mt-1.5 mb-6">
            We sent a 6-digit code to <span className="text-txt-primary">{email}</span>
          </p>
          <form onSubmit={verify} className="flex flex-col gap-2.5">
            <input
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v);
              }}
              className="h-12 w-full rounded-full bg-white/[0.04] ring-1 ring-inset ring-white/[0.08] px-4 text-center text-[20px] tracking-[0.5em] ds-mono text-txt-primary placeholder:text-txt-dim outline-none focus:ring-white/[0.22] transition-shadow"
            />
            <button type="submit" disabled={!!busy || code.length < 6} className={`${pill} bg-white text-black hover:bg-white/90`}>
              {busy === "code" ? "Verifying…" : "Continue"}
            </button>
          </form>
          <div className="flex items-center justify-between mt-4 text-[12px]">
            <button type="button" onClick={() => { setStep("email"); setError(null); }} className="text-txt-muted hover:text-txt-primary transition-colors">
              ← Use a different email
            </button>
            <button type="button" onClick={() => sendCode()} disabled={!!busy} className="text-txt-muted hover:text-txt-primary transition-colors disabled:opacity-50">
              Resend code
            </button>
          </div>
        </>
      )}

      {error && <p className="mt-4 text-center text-[12px] text-[#F05A5A] leading-[1.45]">{error}</p>}

      {/* Clerk's bot protection mounts here on sign-up */}
      <div id="clerk-captcha" className="mt-3 flex justify-center empty:hidden" />
    </div>
  );
}
