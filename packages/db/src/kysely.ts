import { env } from "@10xconnect/config";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import type { Database } from "./database.types";

/**
 * Kysely database interface, derived from the generated Supabase types so there
 * is a single schema source of truth. Keys are snake_case table names; values
 * are the row shapes. (Insert/Update refinement with Generated<> can come later.)
 */
export type DB = {
  [K in keyof Database["public"]["Tables"]]: Database["public"]["Tables"][K]["Row"];
};

/**
 * Creates a Kysely client over a direct Postgres connection (service role).
 * For server/worker use only — bypasses RLS, so callers must scope by
 * workspace_id. Use the transaction pooler (port 6543) for DATABASE_URL in
 * production app/worker processes.
 */
export function createDb(): Kysely<DB> {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for the Kysely client");
  }
  const ssl = /supabase\.(co|com)/.test(env.DATABASE_URL)
    ? { rejectUnauthorized: false }
    : undefined;
  const pool = new Pool({ connectionString: env.DATABASE_URL, ssl, max: 10 });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
