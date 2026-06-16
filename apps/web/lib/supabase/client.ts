import { createBrowserClient } from "@supabase/ssr";

import { supabaseAnonKey, supabaseUrl } from "./env";

/** Supabase client for use in Client Components (browser). */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
