import { env } from "@10xconnect/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

export type { Database, Json } from "./database.types";
export { createDb, type DB } from "./kysely";
export type {
  AppExtraTables,
  ImportJobRow,
  ImportJobsTable,
  ImportSource,
  ImportStatus,
  PromptTemplateScope,
  WorkflowTemplateScope,
} from "./app-tables";

/** Row type helper, e.g. `Tables<"leads">`. */
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

/** Insert type helper, e.g. `TablesInsert<"leads">`. */
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

/** Enum type helper, e.g. `Enums<"campaign_status">`. */
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];

export type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Service-role Supabase client for server/worker use. Bypasses RLS — only ever
 * use this on the server, never in the browser.
 */
export function createServiceClient(): TypedSupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the service client",
    );
  }
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
