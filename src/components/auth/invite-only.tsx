"use client";
import { SignOutButton } from "@clerk/nextjs";
import { AuthFrame } from "./auth-frame";

// Shown to signed-in users who haven't been approved for the beta.
export function InviteOnly({ email }: { email?: string }) {
  return (
    <AuthFrame>
      <div className="ds-card-panel w-full max-w-[400px] px-8 py-9 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static logo */}
        <img src="/mako-star.png" alt="Mako" width={36} height={36} className="w-9 h-9 mx-auto mb-5 object-contain" />
        <div className="text-[17px] font-semibold text-txt-primary mb-2">Mako is invite-only right now</div>
        <p className="text-[13px] text-txt-secondary leading-[1.55] mb-6">
          You&apos;re signed in{email ? <> as <span className="text-txt-primary">{email}</span></> : null}, but this account
          doesn&apos;t have beta access yet. We&apos;ll let you know when it opens up.
        </p>
        <div className="flex items-center justify-center gap-2">
          <a
            href="https://makoapp.xyz"
            className="h-9 px-4 inline-flex items-center rounded-full bg-white text-black text-[13px] font-medium hover:bg-white/90 transition-colors"
          >
            Back to makoapp.xyz
          </a>
          <SignOutButton redirectUrl="/sign-in">
            <button className="h-9 px-4 inline-flex items-center rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/[0.08] text-txt-secondary text-[13px] font-medium hover:text-txt-primary hover:bg-white/[0.09] transition-colors">
              Sign out
            </button>
          </SignOutButton>
        </div>
      </div>
    </AuthFrame>
  );
}
