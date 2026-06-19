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
  | "lead_finder"
  // Manually-entered LinkedIn profile URLs (also backs "import selected
  // connections", which feeds the same pipeline). Column is `text`, no migration.
  | "profile_urls";

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

export type ImportSourceStatus = "active" | "paused";

/** Recurring "live import" source definitions (continuous/auto-refresh import). */
export interface ImportSourcesTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  source: ColumnType<ImportSource, ImportSource, ImportSource>;
  params: WithDefault<Json>;
  list_id: NullableWithDefault<string>;
  campaign_id: NullableWithDefault<string>;
  interval_minutes: WithDefault<number>;
  status: WithDefault<ImportSourceStatus>;
  last_run_at: NullableWithDefault<string>;
  next_run_at: WithDefault<string>;
  last_job_id: NullableWithDefault<string>;
  created_by: NullableWithDefault<string>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

// ---------------------------------------------------------------------------
// MVP M0 tables (orchestration brain, sequence engine, inbox, AI).
// ---------------------------------------------------------------------------

export type ChannelType = "linkedin" | "email";

export interface LeadEventsTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  lead_id: NullableWithDefault<string>;
  account_id: NullableWithDefault<string>;
  campaign_id: NullableWithDefault<string>;
  type: ColumnType<string, string, string>;
  provider_event_id: NullableWithDefault<string>;
  channel: WithDefault<ChannelType>;
  occurred_at: WithDefault<string>;
  metadata: WithDefault<Json>;
  created_at: WithDefault<string>;
}

export interface SavedResponsesTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  title: ColumnType<string, string, string>;
  body: ColumnType<string, string, string>;
  created_by: NullableWithDefault<string>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

export interface AiPromptsTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  name: ColumnType<string, string, string>;
  template: ColumnType<string, string, string>;
  is_default: WithDefault<boolean>;
  run_count: WithDefault<number>;
  created_by: NullableWithDefault<string>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

export interface AiPromptFavoritesTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  user_id: ColumnType<string, string, string>;
  prompt_ref: ColumnType<string, string, string>;
  created_at: WithDefault<string>;
}

export interface DoNotContactTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  linkedin_url: NullableWithDefault<string>;
  email: NullableWithDefault<string>;
  reason: NullableWithDefault<string>;
  created_by: NullableWithDefault<string>;
  created_at: WithDefault<string>;
}

export interface NotificationsTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  type: ColumnType<string, string, string>;
  title: ColumnType<string, string, string>;
  body: NullableWithDefault<string>;
  account_id: NullableWithDefault<string>;
  read: WithDefault<boolean>;
  created_at: WithDefault<string>;
}

export type AccountLinkRequestType = "create" | "reconnect";
export type AccountLinkRequestStatus = "pending" | "completed" | "expired";

/** Pending hosted-auth (provider-hosted connect) requests, keyed by a one-time token. */
export interface AccountLinkRequestsTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  token: ColumnType<string, string, string>;
  type: ColumnType<AccountLinkRequestType, AccountLinkRequestType, AccountLinkRequestType>;
  reconnect_provider_account_id: NullableWithDefault<string>;
  country: ColumnType<string, string, string>;
  status: WithDefault<AccountLinkRequestStatus>;
  expires_at: ColumnType<string, string, string>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

/** Extra Kysely tables intersected into DB (see kysely.ts). */
export interface AppExtraTables {
  import_jobs: ImportJobsTable;
  import_sources: ImportSourcesTable;
  lead_events: LeadEventsTable;
  saved_responses: SavedResponsesTable;
  ai_prompts: AiPromptsTable;
  ai_prompt_favorites: AiPromptFavoritesTable;
  do_not_contact: DoNotContactTable;
  notifications: NotificationsTable;
  account_link_requests: AccountLinkRequestsTable;
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
