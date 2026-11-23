import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { InviteOnly } from "@/components/auth/invite-only";
import { hasAccess } from "@/lib/access";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!hasAccess(user)) return <InviteOnly email={user.primaryEmailAddress?.emailAddress} />;
  return <AppShell />;
}
