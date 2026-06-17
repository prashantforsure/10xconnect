import { env } from "@10xconnect/config";
import { type ColumnType, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import type { AppExtraTables } from "./app-tables";
import type { Database } from "./database.types";

type PublicTables = Database["public"]["Tables"];

/**
 * Kysely tables derived from the generated Supabase types so there is a single
 * schema source of truth. For each column we build a Kysely
 * `ColumnType<Select, Insert, Update>` from the generated Row/Insert/Update
 * shapes: columns that are optional in `Insert` (defaults like id, timestamps,
 * jsonb defaults) become optional on insert, and selects return the Row type.
 */
type GeneratedDB = {
  [Table in keyof PublicTables]: {
    [Column in keyof PublicTables[Table]["Row"]]: ColumnType<
      PublicTables[Table]["Row"][Column],
      Column extends keyof PublicTables[Table]["Insert"]
        ? PublicTables[Table]["Insert"][Column]
        : never,
      Column extends keyof PublicTables[Table]["Update"]
        ? PublicTables[Table]["Update"][Column]
        : never
    >;
  };
};

/**
 * The Kysely database interface: generated tables plus app tables not yet in the
 * generated types (see app-tables.ts). Intersection keeps the override explicit
 * and easy to remove once types are regenerated.
 */
export type DB = GeneratedDB & AppExtraTables;

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
