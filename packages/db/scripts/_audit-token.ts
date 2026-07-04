// AUDIT TOOLING (throwaway — never commit): Supabase password-grant sign-in;
// prints ONLY the access token (no secrets echoed).
// Usage: pnpm --filter @10xconnect/db exec tsx scripts/_audit-token.ts <email> <password>

import { env } from "@10xconnect/config";

const email = process.argv[2];
const password = process.argv[3];
if (!email || !password) {
  console.error("usage: tsx scripts/_audit-token.ts <email> <password>");
  process.exit(1);
}

async function main(): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY missing");
  }
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string; msg?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`sign-in failed (${res.status}): ${body.error_description ?? body.msg ?? "?"}`);
  }
  console.log(body.access_token);
}

main().catch((e: unknown) => {
  console.error("audit-token failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
