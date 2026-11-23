import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { AuthFrame } from "@/components/auth/auth-frame";

export default function SignInPage() {
  return (
    <AuthFrame>
      <Suspense>
        <AuthCard />
      </Suspense>
    </AuthFrame>
  );
}
