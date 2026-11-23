"use client";
// Account button for the nav rail: initial in a circle → small menu with
// the signed-in email and Sign out. Replaces Clerk's UserButton.
import { useEffect, useRef, useState } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { SignOut } from "@phosphor-icons/react";

export function AccountMenu() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!user) return null;
  const email = user.primaryEmailAddress?.emailAddress ?? "";
  const initial = (user.firstName || email || "?").charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={email}
        aria-label="Account"
        className="w-8 h-8 rounded-full overflow-hidden bg-white/[0.07] ring-1 ring-inset ring-white/[0.1] text-[12px] font-semibold text-txt-primary flex items-center justify-center hover:bg-white/[0.11] transition-colors"
      >
        {user.hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatar from Google
          <img src={user.imageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div className="absolute left-[calc(100%+10px)] bottom-0 z-50 w-[230px] ds-card-panel p-1.5">
          <div className="px-2.5 pt-2 pb-2.5 border-b border-white/[0.06] mb-1">
            <div className="text-[11px] text-txt-muted">Signed in as</div>
            <div className="text-[12.5px] text-txt-primary truncate mt-0.5">{email}</div>
          </div>
          <button
            onClick={() => signOut({ redirectUrl: "/sign-in" })}
            className="w-full h-8 px-2.5 rounded-lg flex items-center gap-2 text-[12.5px] text-txt-secondary hover:text-txt-primary hover:bg-white/[0.05] transition-colors"
          >
            <SignOut size={15} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
