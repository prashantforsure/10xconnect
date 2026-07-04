import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { supabaseAnonKey, supabaseUrl } from "./env";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Routes reachable without a session. Everything else requires auth.
// "/connect" covers the Hosted Auth popup landing page (/connect/callback).
// "/developers" is the public API/webhooks/MCP reference — deliberately readable
// without an account (prospective integrators land here before signing up).
const PUBLIC_PATHS = ["/login", "/signup", "/reset-password", "/auth", "/connect", "/developers"];
// Public marketing/legal pages (exact match — "/" must not make everything public).
const PUBLIC_EXACT = new Set(["/", "/pricing", "/privacy", "/terms", "/extension-privacy"]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) {
    return true;
  }
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session cookie and enforces route protection:
 * - unauthenticated users hitting a protected route -> /login
 * - authenticated users hitting /login or /signup -> /
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  // IMPORTANT: getUser() validates the token with Supabase (do not trust getSession()).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
