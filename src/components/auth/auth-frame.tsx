import type { ReactNode } from "react";

// Shared backdrop for the sign-in / sign-up pages.
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-void px-4 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static logo */}
      <img src="/mako-star.png" alt="Mako" width={36} height={36} className="w-9 h-9 mb-6 object-contain" />
      {children}
      <p className="mt-6 text-[11px] text-txt-muted">Mako is in private beta · access by invite</p>
    </div>
  );
}
