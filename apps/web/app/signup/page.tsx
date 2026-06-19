import Link from "next/link";

import { signInWithGoogle, signup } from "@/app/auth/actions";
import {
  AuthShell,
  Banner,
  Field,
  GoogleButton,
  OrDivider,
  SubmitButton,
} from "@/app/auth/auth-ui";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <AuthShell title="Create account">
      <Banner error={error} message={message} />
      <form action={signInWithGoogle}>
        <GoogleButton />
      </form>
      <OrDivider />
      <form action={signup}>
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="new-password" />
        <SubmitButton>Sign up</SubmitButton>
      </form>
      <div className="mt-4 text-sm text-muted-foreground">
        <Link href="/login" className="font-medium transition-colors hover:text-primary">
          Already have an account? Log in
        </Link>
      </div>
    </AuthShell>
  );
}
