import Link from "next/link";

import { requestPasswordReset, updatePassword } from "@/app/auth/actions";
import { AuthShell, Banner, Field, SubmitButton } from "@/app/auth/auth-ui";
import { createClient } from "@/lib/supabase/server";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  // After clicking the recovery link, /auth/confirm establishes a session and
  // redirects here. If a session exists, show the "set new password" form;
  // otherwise show the "request reset" form.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return (
      <AuthShell title="Set a new password">
        <Banner error={error} message={message} />
        <form action={updatePassword}>
          <Field label="New password" name="password" type="password" autoComplete="new-password" />
          <SubmitButton>Update password</SubmitButton>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset password">
      <Banner error={error} message={message} />
      <form action={requestPasswordReset}>
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <SubmitButton>Send reset link</SubmitButton>
      </form>
      <div className="mt-4 text-[13px] text-muted-foreground">
        <Link href="/login" className="font-medium text-indigo-text hover:underline">
          Back to log in
        </Link>
      </div>
    </AuthShell>
  );
}
