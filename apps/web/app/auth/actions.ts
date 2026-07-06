"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { siteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// Live request origin (proto+host) — correct on prod + localhost automatically,
// so auth redirects work on every domain without a build-time env var.
// Falls back to NEXT_PUBLIC_SITE_URL when there's no request context.
async function resolveSiteUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return siteUrl();
}

function withError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function withMessage(path: string, message: string): never {
  redirect(`${path}?message=${encodeURIComponent(message)}`);
}

export async function login(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    withError("/login", error.message);
  }
  redirect("/");
}

export async function signup(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${await resolveSiteUrl()}/auth/confirm?next=/` },
  });

  if (error) {
    withError("/signup", error.message);
  }
  withMessage("/login", "Check your email to confirm your account, then log in.");
}

export async function requestPasswordReset(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await resolveSiteUrl()}/auth/confirm?next=/reset-password`,
  });

  if (error) {
    withError("/reset-password", error.message);
  }
  withMessage("/reset-password", "If that email exists, a reset link is on its way.");
}

export async function updatePassword(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    withError("/reset-password", error.message);
  }
  withMessage("/", "Your password has been updated.");
}

export async function signInWithGoogle(): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await resolveSiteUrl()}/auth/callback?next=/` },
  });

  if (error) {
    withError("/login", error.message);
  }
  if (data.url) {
    // Hand off to Google's consent screen.
    redirect(data.url);
  }
  withError("/login", "Could not start Google sign-in");
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
