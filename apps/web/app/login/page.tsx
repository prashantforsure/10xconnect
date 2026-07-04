import Link from "next/link";

import { login, signInWithGoogle } from "@/app/auth/actions";
import {
  AuthShell,
  Banner,
  Field,
  GoogleButton,
  OrDivider,
  SubmitButton,
} from "@/app/auth/auth-ui";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <AuthShell title="Log in">
      <Banner error={error} message={message} />
      <form action={signInWithGoogle}>
        <GoogleButton />
      </form>
      <OrDivider />
      <form action={login}>
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
        <SubmitButton>Log in</SubmitButton>
      </form>
      <div className="mt-4 flex justify-between text-[13px] text-muted-foreground">
        <Link href="/signup" className="font-medium text-indigo-text hover:underline">
          Create account
        </Link>
        <Link href="/reset-password" className="text-indigo-text hover:underline">
          Forgot password?
        </Link>
      </div>
    </AuthShell>
  );
}
