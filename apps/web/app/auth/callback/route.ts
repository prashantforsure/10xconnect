import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

// Origin for the post-auth redirect. Mirrors resolveSiteUrl() in ../actions.ts:
// in production trust the explicit runtime env (APP_URL) over request.url, which
// behind Railway's proxy can resolve to an internal/localhost host.
function siteOrigin(request: NextRequest): string {
  const configured = (process.env.APP_URL ?? process.env.SITE_URL)?.trim().replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production" && configured) {
    return configured;
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return configured ?? new URL(request.url).origin;
}

/**
 * OAuth (e.g. Google) redirect target. Supabase appends `code`; we exchange it
 * for a session (PKCE) and then redirect to `next`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const origin = siteOrigin(request);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent("Could not sign in with Google")}`, origin),
  );
}
