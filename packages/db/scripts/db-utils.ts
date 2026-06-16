import { env } from "@10xconnect/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client, type ClientConfig } from "pg";

export function requireDatabaseUrl(): string {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Add your Supabase Postgres connection string " +
        "(Session pooler / direct, port 5432) to the repo-root .env.",
    );
  }
  return env.DATABASE_URL;
}

/** A pg Client configured with SSL for Supabase hosts. */
export function createPgClient(connectionString = requireDatabaseUrl()): Client {
  const isSupabase = /supabase\.(co|com)/.test(connectionString);
  const config: ClientConfig = { connectionString };
  if (isSupabase) {
    config.ssl = { rejectUnauthorized: false };
  }
  return new Client(config);
}

/** Service-role Supabase client (admin API + RLS bypass). */
export function createAdminClient(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
