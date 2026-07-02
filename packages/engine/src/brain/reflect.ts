// Approve / discard an AI draft, and reflect after approval.
//
// Approve = the human accepts (optionally edits) the suggestion → enqueue a
// conversation_reply action (the Phase 1 safety-spine path; the worker sends it),
// mark the draft approved, then REFLECT: persist a new fact (only when the
// classifier flagged new info — token/work saving) and update relationship_state
// (intent_score, ai_turn_count, last_ai_reply_at, summary).

import type { EngineDeps } from "../types";

import { upsertFact } from "./kb";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export interface ApproveResult {
  status: "approved" | "not_found";
  actionId?: string;
}

/**
 * Approve a pending draft: enqueue the reply through the safety spine, mark the
 * draft approved, and reflect. `editedBody` overrides the suggested text.
 * `authoredBy` marks who is sending: "human" (a person approved/edited the draft
 * — the default) or "ai" (the autonomy dial auto-sent it with no human in the
 * loop). It rides the reply action config → stamps messages.authored_by so the
 * inbox can show a "sent by AI" chip and analytics can count autonomous replies.
 */
export async function approveDraft(
  deps: EngineDeps,
  input: { workspaceId: string; draftId: string; editedBody?: string; authoredBy?: "human" | "ai" },
): Promise<ApproveResult> {
  const { db } = deps;
  const draft = await db
    .selectFrom("message_drafts")
    .select(["id", "conversation_id as conversationId", "lead_id as leadId", "campaign_id as campaignId", "body", "reasoning", "status"])
    .where("workspace_id", "=", input.workspaceId)
    .where("id", "=", input.draftId)
    .executeTakeFirst();
  if (!draft || draft.status !== "pending") return { status: "not_found" };

  const body = (input.editedBody ?? draft.body ?? "").trim();
  if (!body) return { status: "not_found" };

  const convo = await db
    .selectFrom("conversations")
    .select(["id", "channel", "account_id as accountId"])
    .where("id", "=", draft.conversationId)
    .executeTakeFirst();
  if (!convo?.accountId) return { status: "not_found" };

  // Enqueue the reply (Phase 1 conversation_reply path → worker sends via spine).
  const idempotencyKey = `reply:${draft.conversationId}:${draft.id}`;
  await db
    .insertInto("actions")
    .values({
      workspace_id: input.workspaceId,
      account_id: convo.accountId,
      lead_id: draft.leadId,
      type: "message",
      status: "pending",
      idempotency_key: idempotencyKey,
      scheduled_at: new Date().toISOString(),
      config: JSON.stringify({
        kind: "conversation_reply",
        conversationId: draft.conversationId,
        body,
        channel: convo.channel,
        authoredBy: input.authoredBy ?? "human",
      }),
    })
    .onConflict((oc) => oc.column("idempotency_key").doNothing())
    .execute();

  await db.updateTable("message_drafts").set({ status: "approved", body }).where("id", "=", draft.id).execute();

  await reflect(deps, {
    workspaceId: input.workspaceId,
    leadId: draft.leadId,
    campaignId: draft.campaignId,
    reasoning: draft.reasoning,
  });

  return { status: "approved", actionId: idempotencyKey };
}

/** Discard a pending draft (human will handle the thread manually). */
export async function discardDraft(
  deps: EngineDeps,
  input: { workspaceId: string; draftId: string },
): Promise<{ status: "discarded" | "not_found" }> {
  const res = await deps.db
    .updateTable("message_drafts")
    .set({ status: "discarded" })
    .where("workspace_id", "=", input.workspaceId)
    .where("id", "=", input.draftId)
    .where("status", "=", "pending")
    .returning("id")
    .executeTakeFirst();
  return { status: res ? "discarded" : "not_found" };
}

/**
 * Reflect on an approved turn: persist a fact (only when new info was flagged)
 * and advance the relationship (intent_score, ai_turn_count, last_ai_reply_at,
 * summary). Updating relationship_state is cheap; the embedding work (fact) is
 * gated on hasNewInfo to save tokens.
 */
export async function reflect(
  deps: EngineDeps,
  input: { workspaceId: string; leadId: string | null; campaignId: string | null; reasoning: unknown },
): Promise<void> {
  const { db } = deps;
  if (!input.leadId) return;
  const r = asObject(input.reasoning);
  const intentDelta = typeof r.intentDelta === "number" ? r.intentDelta : 0;
  const intent = typeof r.intent === "string" ? r.intent : "other";
  const topic = typeof r.topic === "string" ? r.topic : "general";
  const question = typeof r.question === "string" ? r.question : "";
  const hasNewInfo = r.hasNewInfo === true;

  if (hasNewInfo && question) {
    await upsertFact(db, deps.embeddingAdapter, {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      campaignId: input.campaignId,
      topic,
      body: question,
      source: "conversation",
    });
  }

  const rel = await db
    .selectFrom("relationship_state")
    .select(["intent_score", "ai_turn_count"])
    .where("lead_id", "=", input.leadId)
    .executeTakeFirst();
  const nowIso = new Date().toISOString();
  const nextTurns = (rel?.ai_turn_count ?? 0) + 1;
  const nextScore = clamp((rel?.intent_score ?? 0) + intentDelta, 0, 100);
  const summary = `Engaged via AI; last intent: ${intent}; intent score ${nextScore}; ${nextTurns} AI turn(s).`;

  await db
    .insertInto("relationship_state")
    .values({
      lead_id: input.leadId,
      workspace_id: input.workspaceId,
      campaign_id: input.campaignId,
      intent_score: nextScore,
      ai_turn_count: nextTurns,
      last_ai_reply_at: nowIso,
      summary,
    })
    .onConflict((oc) =>
      oc.column("lead_id").doUpdateSet({
        intent_score: nextScore,
        ai_turn_count: nextTurns,
        last_ai_reply_at: nowIso,
        summary,
        updated_at: nowIso,
      }),
    )
    .execute();
}
