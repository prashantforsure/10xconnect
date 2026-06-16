import Link from "next/link";

import { login } from "@/app/auth/actions";
import { AuthShell, Banner, Field, SubmitButton } from "@/app/auth/auth-ui";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <AuthShell title="Log in">
      <Banner error={error} message={message} />
      <form action={login}>
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
        <SubmitButton>Log in</SubmitButton>
      </form>
      <div className="mt-4 flex justify-between text-sm text-gray-600">
        <Link href="/signup" className="hover:text-indigo-600">
          Create account
        </Link>
        <Link href="/reset-password" className="hover:text-indigo-600">
          Forgot password?
        </Link>
      </div>
    </AuthShell>
  );
}
