// Integrations outbox (Phase B). The engine EMITS domain events as DB rows —
// it never does HTTP. An in-API poller (DeliveryService) fans events out to the
// workspace's webhooks + Slack connection and delivers with retries/signing.
//
// Two hard rules:
//  1. NEVER throws — a broken outbox must never fail a dispatch tick or inbound
//     processing (account safety > integrations). Errors are logged and eaten.
//  2. Idempotent — dedupe_key is unique per workspace; re-running a seam
//     (webhook replay, dispatch retry) inserts ON CONFLICT DO NOTHING.

import type { DB, IntegrationEventType } from "@10xconnect/db";
import type { Kysely } from "kysely";

export type { IntegrationEventType } from "@10xconnect/db";

export interface IntegrationEventInput {
  workspaceId: string;
  type: IntegrationEventType;
  /** Unique per workspace — natural keys like `reply:${providerEventId}`. */
  dedupeKey: string;
  /** Event `data` (the envelope id/type/created_at wrap happens at delivery). */
  payload: Record<string, unknown>;
}

/** Lead identity for event payloads: { id, name, linkedin_url } (PII — documented). */
export async function leadEventSummary(
  db: Kysely<DB>,
  workspaceId: string,
  leadId: string,
): Promise<{ id: string; name: string | null; linkedin_url: string | null }> {
  const row = await db
    .selectFrom("leads")
    .select(["id", "linkedin_url", "email", "enrichment"])
    .where("workspace_id", "=", workspaceId)
    .where("id", "=", leadId)
    .executeTakeFirst();
  if (!row) {
    return { id: leadId, name: null, linkedin_url: null };
  }
  const e =
    row.enrichment && typeof row.enrichment === "object" && !Array.isArray(row.enrichment)
      ? (row.enrichment as Record<string, unknown>)
      : {};
  const name =
    [e.firstName, e.lastName]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .join(" ") || null;
  return { id: row.id, name: name ?? row.email, linkedin_url: row.linkedin_url };
}

export async function emitIntegrationEvent(
  db: Kysely<DB>,
  input: IntegrationEventInput,
  log?: (message: string) => void,
): Promise<void> {
  try {
    await db
      .insertInto("integration_events")
      .values({
        workspace_id: input.workspaceId,
        type: input.type,
        dedupe_key: input.dedupeKey,
        payload: JSON.stringify(input.payload),
      })
      .onConflict((oc) => oc.columns(["workspace_id", "dedupe_key"]).doNothing())
      .execute();
  } catch (error) {
    log?.(`integration event emit failed (${input.type}): ${(error as Error).message}`);
  }
}
