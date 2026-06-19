// Inbound event processing (CLAUDE.md §2/§5/§7). Webhook + mock-simulated events
// flow through here: persisted idempotently to lead_events (provider_event_id is
// the dedup key), then acted on — a reply AUTO-STOPS the lead's sequences and
// lands in the inbox; invite_accepted/opens feed condition nodes + analytics; an
// account status change drives restriction → auto-pause.

import type { InboundEvent } from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import type { Kysely } from "kysely";

import { flagAccountIncident } from "./restrictions";

export interface InboundDeps {
  db: Kysely<DB>;
  log?: (msg: string) => void;
}

interface ResolvedAccount {
  id: string;
  workspaceId: string;
}

/** Resolve the event's account (echoed our id, or the provider handle) to ours. */
async function resolveAccount(
  db: Kysely<DB>,
  eventAccountId: string,
): Promise<ResolvedAccount | null> {
  const row = await db
    .selectFrom("sending_accounts")
    .select(["id", "workspace_id"])
    .where((eb) =>
      eb.or([eb("id", "=", eventAccountId), eb("provider_account_id", "=", eventAccountId)]),
    )
    .executeTakeFirst();
  return row ? { id: row.id, workspaceId: row.workspace_id } : null;
}

async function resolveLeadId(
  db: Kysely<DB>,
  workspaceId: string,
  lead: { leadId?: string; linkedinUrl?: string; providerId?: string; email?: string } | undefined,
): Promise<string | null> {
  if (!lead) {
    return null;
  }
  if (lead.leadId) {
    return lead.leadId;
  }
  const q = db.selectFrom("leads").select("id").where("workspace_id", "=", workspaceId);
  if (lead.linkedinUrl) {
    const row = await q.where("linkedin_url", "=", lead.linkedinUrl).executeTakeFirst();
    if (row) {
      return row.id;
    }
  }
  if (lead.email) {
    const row = await db
      .selectFrom("leads")
      .select("id")
      .where("workspace_id", "=", workspaceId)
      .where("email", "=", lead.email)
      .executeTakeFirst();
    if (row) {
      return row.id;
    }
  }
  return null;
}

/** lead_events.type for an inbound event. */
function eventType(event: InboundEvent): string {
  return event.type;
}

/**
 * Process one inbound event. Idempotent: a replayed provider_event_id is a no-op.
 * Returns what happened (for logging/tests).
 */
export async function processInboundEvent(
  deps: InboundDeps,
  event: InboundEvent,
): Promise<{ status: "processed" | "duplicate" | "unresolved" }> {
  const account = await resolveAccount(deps.db, event.accountId);
  if (!account) {
    deps.log?.(`inbound: unresolved account ${event.accountId} (event ${event.id})`);
    return { status: "unresolved" };
  }
  const leadId = await resolveLeadId(
    deps.db,
    account.workspaceId,
    "lead" in event ? event.lead : undefined,
  );

  // Idempotent insert — the unique (workspace, provider_event_id) guards replays.
  const inserted = await deps.db
    .insertInto("lead_events")
    .values({
      workspace_id: account.workspaceId,
      lead_id: leadId,
      account_id: account.id,
      type: eventType(event),
      provider_event_id: event.id,
      channel: event.channel,
      occurred_at: event.occurredAt,
      metadata: JSON.stringify(metadataOf(event)),
    })
    .onConflict((oc) => oc.columns(["workspace_id", "provider_event_id"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  if (!inserted) {
    return { status: "duplicate" };
  }

  switch (event.type) {
    case "account_status_changed":
      if (event.status === "restricted") {
        await flagAccountIncident(deps.db, account.workspaceId, account.id, "restricted");
      }
      break;
    case "reply":
      if (leadId) {
        await handleReply(deps.db, account, leadId, event);
      }
      break;
    default:
      // invite_accepted / message_opened / email_* — recorded; conditions read them.
      break;
  }
  return { status: "processed" };
}

function metadataOf(event: InboundEvent): Record<string, unknown> {
  if (event.type === "reply") {
    return { body: event.message.body ?? null, voiceRef: event.message.voiceRef ?? null };
  }
  if (event.type === "account_status_changed") {
    return { status: event.status };
  }
  if (event.type === "email_clicked") {
    return { url: event.url ?? null };
  }
  return {};
}

/** A reply auto-stops the lead's active sequences and lands in the inbox. */
async function handleReply(
  db: Kysely<DB>,
  account: ResolvedAccount,
  leadId: string,
  event: Extract<InboundEvent, { type: "reply" }>,
): Promise<void> {
  // Auto-stop: mark active states 'replied' and cancel their pending actions.
  await db
    .updateTable("lead_campaign_state")
    .set({ status: "replied" })
    .where("workspace_id", "=", account.workspaceId)
    .where("lead_id", "=", leadId)
    .where("status", "=", "active")
    .execute();
  await db
    .updateTable("actions")
    .set({ status: "skipped" })
    .where("workspace_id", "=", account.workspaceId)
    .where("lead_id", "=", leadId)
    .where("status", "=", "pending")
    .execute();

  // Land in the inbox: find/create the conversation, append the inbound message.
  const existing = await db
    .selectFrom("conversations")
    .select("id")
    .where("workspace_id", "=", account.workspaceId)
    .where("lead_id", "=", leadId)
    .where("channel", "=", event.channel)
    .executeTakeFirst();
  const conversationId =
    existing?.id ??
    (
      await db
        .insertInto("conversations")
        .values({
          workspace_id: account.workspaceId,
          account_id: account.id,
          lead_id: leadId,
          channel: event.channel,
          pipeline_stage: "in_conversation",
        })
        .returning("id")
        .executeTakeFirstOrThrow()
    ).id;

  await db
    .insertInto("messages")
    .values({
      workspace_id: account.workspaceId,
      conversation_id: conversationId,
      direction: "inbound",
      channel: event.channel,
      body: event.message.body ?? null,
      voice_ref: event.message.voiceRef ?? null,
    })
    .execute();
}
