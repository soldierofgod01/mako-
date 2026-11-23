import type { ReactNode } from "react";

// Shared backdrop for the sign-in screens.
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-void px-4 py-10">
      {children}
      <p className="mt-5 text-[11px] text-txt-muted">Mako is in private beta · access by invite</p>
    </div>
  );
}
