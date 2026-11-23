import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { AuthFrame } from "@/components/auth/auth-frame";

// Google sends people back here; Clerk finishes the sign-in (or creates
// the account for first-timers) and then forwards to the app.
export default function SSOCallback() {
  return (
    <AuthFrame>
      <p className="text-[13px] text-txt-secondary">Signing you in…</p>
      <AuthenticateWithRedirectCallback
        signInUrl="/sign-in"
        signUpUrl="/sign-in"
        signInFallbackRedirectUrl="/"
        signUpFallbackRedirectUrl="/"
      />
      <div id="clerk-captcha" />
    </AuthFrame>
  );
}
