import { headers } from "next/headers";
import { NextResponse } from "next/server";

// TEMPORARY diagnostic — DELETE after confirming OAuth origin resolution.
// Reachable without auth (/auth/* is public in middleware). Exposes no secrets;
// APP_URL / host are the public domain. Visit /auth/debug-origin in prod.
export async function GET(): Promise<NextResponse> {
  const h = await headers();
  return NextResponse.json({
    nodeEnv: process.env.NODE_ENV ?? null,
    appUrl: process.env.APP_URL ?? null,
    siteUrlEnv: process.env.SITE_URL ?? null,
    nextPublicSiteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
    header_x_forwarded_host: h.get("x-forwarded-host"),
    header_host: h.get("host"),
    header_x_forwarded_proto: h.get("x-forwarded-proto"),
  });
}
