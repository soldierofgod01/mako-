import { redirect } from "next/navigation";

// One screen handles both sign-in and sign-up. Keep the query string so
// Clerk invite links (?__clerk_ticket=…) still work.
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === "string") sp.set(k, v);
  }
  const qs = sp.toString();
  redirect(qs ? `/sign-in?${qs}` : "/sign-in");
}
