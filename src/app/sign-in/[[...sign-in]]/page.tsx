import { SignIn } from "@clerk/nextjs";
import { AuthFrame } from "@/components/auth/auth-frame";

export default function SignInPage() {
  return (
    <AuthFrame>
      <SignIn withSignUp />
    </AuthFrame>
  );
}
