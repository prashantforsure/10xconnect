import type { ColumnType } from "kysely";

import type { Json } from "./database.types";

/**
 * Tables introduced by app migrations that are not yet reflected in the
 * generated `database.types.ts` (which mirrors `supabase gen types`). They live
 * here so Phase 3 can use them through Kysely WITHOUT editing the generated
 * types file (which is edited concurrently by other work). When the types are
 * next regenerated, fold these into database.types.ts and delete this file.
 *
 * The `DB` type in kysely.ts intersects these in, so they are first-class Kysely
 * tables everywhere the shared client is used.
 */

export type ImportStatus = "pending" | "running" | "completed" | "failed";

export type ImportSource =
  | "csv"
  | "linkedin_search"
  | "sales_navigator"
  | "event"
  | "post"
  | "group"
  | "list"
  | "lead_finder";

/** Column with a DB default → optional on insert, present on select. */
type WithDefault<T> = ColumnType<T, T | undefined, T>;
/** Nullable column with a DB default. */
type NullableWithDefault<T> = ColumnType<T | null, T | null | undefined, T | null>;

export interface ImportJobsTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  source: ColumnType<ImportSource, ImportSource, ImportSource>;
  status: WithDefault<ImportStatus>;
  list_id: NullableWithDefault<string>;
  campaign_id: NullableWithDefault<string>;
  params: WithDefault<Json>;
  total_count: WithDefault<number>;
  created_count: WithDefault<number>;
  duplicate_count: WithDefault<number>;
  failed_count: WithDefault<number>;
  error: NullableWithDefault<string>;
  created_by: NullableWithDefault<string>;
  started_at: NullableWithDefault<string>;
  finished_at: NullableWithDefault<string>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

/** Extra Kysely tables intersected into DB (see kysely.ts). */
export interface AppExtraTables {
  import_jobs: ImportJobsTable;
}

/** Plain SELECT shape of an import_jobs row (for API view mapping). */
export interface ImportJobRow {
  id: string;
  workspace_id: string;
  source: ImportSource;
  status: ImportStatus;
  list_id: string | null;
  campaign_id: string | null;
  params: Json;
  total_count: number;
  created_count: number;
  duplicate_count: number;
  failed_count: number;
  error: string | null;
  created_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}
