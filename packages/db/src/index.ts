import { env } from "@10xconnect/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

export type { Database, Json } from "./database.types";
export { createDb, type DB } from "./kysely";
export type {
  ApiKeyPermission,
  AppExtraTables,
  DeliveryStatus,
  DeliveryTargetKind,
  ImportJobRow,
  ImportJobsTable,
  ImportSource,
  ImportStatus,
  IntegrationEventType,
  PromptTemplateScope,
  WebhookStatus,
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

/** Private Storage bucket for composer media (attachments + voice recordings). */
export const CAMPAIGN_MEDIA_BUCKET = "campaign-media";

/**
 * Dispatch-time attachment URL resolver (engine's `resolveAttachmentUrl` hook):
 * compose-time signed URLs expire after 1h, so the engine mints a FRESH signed
 * URL from the stored storage ref right before the transport fetches the bytes.
 * Returns undefined when Supabase isn't configured (bare tests / mock setups) —
 * the engine then falls back to the stored URL. The resolver itself never throws.
 */
export function createAttachmentUrlResolver():
  | ((ref: string) => Promise<string | null>)
  | undefined {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return undefined;
  }
  const storage = createServiceClient().storage.from(CAMPAIGN_MEDIA_BUCKET);
  return async (ref: string): Promise<string | null> => {
    try {
      const { data } = await storage.createSignedUrl(ref, 3600);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  };
}
