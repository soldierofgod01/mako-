import type { ReactNode } from "react";
import { ShaderBackground } from "@/components/ui/poba-shade";

// Shared backdrop for the sign-in screens: animated shader behind,
// content centred on top.
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen w-screen overflow-hidden bg-void">
      <ShaderBackground className="absolute inset-0 h-full w-full" />
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 py-10">
        {children}
        <p className="mt-5 text-[11px] text-txt-muted">
          Mako is in private beta ·{" "}
          <a href="https://makoapp.xyz/#join" className="text-txt-secondary hover:text-txt-primary underline-offset-2 hover:underline transition-colors">
            Join the waitlist
          </a>
        </p>
      </div>
    </div>
  );
}
