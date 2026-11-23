// Who gets into the beta.
// - Emails in MAKO_ADMIN_EMAILS (comma-separated env var) always get in.
// - Anyone else needs public metadata { "approved": true } on their Clerk
//   user. Set it when inviting (Clerk → Users → Invitations → metadata) or
//   on an existing user (Clerk → Users → user → Metadata → Public).
// Being on the makoapp.xyz waitlist does NOT grant access.
import type { User } from "@clerk/nextjs/server";

export function hasAccess(user: User): boolean {
  if (user.publicMetadata?.approved === true) return true;
  const admins = (process.env.MAKO_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return user.emailAddresses.some(
    (e) => e.verification?.status === "verified" && admins.includes(e.emailAddress.toLowerCase())
  );
}
