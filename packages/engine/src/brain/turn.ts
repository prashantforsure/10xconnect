// The conversation turn pipeline (Phase 2 draft + Phase 3 governors + Phase 4
// hot-lead handoff & autonomy dial). On a prospect reply:
//   PRE-GATE (Phase 3, ZERO model calls) → skip trash / closed / opt-out / cap.
//   BUDGET gate (Phase 3) → hard-stop if the daily AI budget is spent.
//   classify (cheap, deterministic).
//   HOT-LEAD detection (Phase 4) → buying signal / high intent / pricing / legal /
//     competitor → hand to a human with a summary (stage=hot_lead, important,
//     PAUSE AI, notify). Never auto-sends money/legal/buying turns.
//   "are you AI?" → a fixed honest disclosure (never model-improvised).
//   retrieve KB + facts → decide → ground-guard → draft (metered).
//   AUTONOMY dial (Phase 4) → approve_all leaves a draft; auto_easy auto-sends a
//     grounded, confident, in-policy answer; full_auto sends within the caps.
// The grounding guard is absolute: a factual question with no relevant chunk
// escalates; we never invent a fact.

import {
  AI_IDENTITY_RESPONSE,
  autonomyFrom,
  budgetFrom,
  buildDraftPrompt,
  buildHandoffSummary,
  classifyInbound,
  decideAction,
  decideAutonomy,
  DEFAULT_CONFIDENCE_THRESHOLD,
  detectAiIdentityQuestion,
  detectHotLead,
  evaluatePreGate,
  GROUNDING_MIN_SIMILARITY,
  guardrailsFrom,
  type HotLeadReason,
  limitsFrom,
  objectiveFrom,
  type PreGateDecision,
  voiceFrom,
} from "@10xconnect/core";
import type { Json } from "@10xconnect/db";

import { addToDoNotContact } from "../suppression";
import type { EngineDeps } from "../types";

import { checkBudget } from "./budget";
import { retrieveChunks, retrieveFacts } from "./kb";
import { meteredGenerate } from "./metering";
import { approveDraft } from "./reflect";

const HISTORY_LIMIT = 8;
// A factual answer this close to a single chunk is a canned-FAQ — return the
// chunk directly (no reasoning-model call). Conservative so paraphrases still
// route through the model.
const FAQ_DIRECT_SIMILARITY = 0.92;

export interface TurnInput {
  conversationId: string;
  campaignId: string | null;
  leadId: string | null;
}

export type TurnOutcome =
  | { status: "skipped"; reason: string }
  | { status: "escalated"; reason: string; draftId: string }
  | { status: "drafted"; draftId: string; confidence: number }
  | { status: "auto_sent"; draftId: string; confidence: number };

function modelOf(deps: EngineDeps): string {
  return deps.modelLabel ?? "mock";
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Run one conversation turn → write a suggested draft, auto-send it, or hand off. */
export async function runConversationTurn(deps: EngineDeps, input: TurnInput): Promise<TurnOutcome> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();

  const convo = await db
    .selectFrom("conversations")
    .select(["id", "workspace_id as workspaceId", "lead_id as leadId", "channel", "account_id as accountId", "pipeline_stage as pipelineStage"])
    .where("id", "=", input.conversationId)
    .executeTakeFirst();
  if (!convo) return { status: "skipped", reason: "conversation missing" };

  const leadId = input.leadId ?? convo.leadId;

  // Campaign brain + limits/budget/autonomy config.
  const campaign = input.campaignId
    ? await db
        .selectFrom("campaigns")
        .select(["objective", "guardrails", "voice", "limits", "budget", "autonomy", "knowledge_base_id as knowledgeBaseId"])
        .where("id", "=", input.campaignId)
        .executeTakeFirst()
    : undefined;
  const objective = objectiveFrom(campaign?.objective);
  const guardrails = guardrailsFrom(campaign?.guardrails);
  const voice = voiceFrom(campaign?.voice);
  const limits = limitsFrom(campaign?.limits);
  const budget = budgetFrom(campaign?.budget);
  const autonomy = autonomyFrom(campaign?.autonomy);
  const threshold = autonomy.confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const knowledgeBaseId = campaign?.knowledgeBaseId ?? null;

  // Conversation history; the newest inbound is the message we're answering.
  const messages = await db
    .selectFrom("messages")
    .select(["direction", "body", "created_at"])
    .where("conversation_id", "=", input.conversationId)
    .orderBy("created_at", "desc")
    .limit(HISTORY_LIMIT)
    .execute();
  const ordered = [...messages].reverse();
  const newestInbound = messages.find((m) => m.direction === "inbound" && m.body);
  if (!newestInbound?.body) return { status: "skipped", reason: "no inbound message" };
  const question = newestInbound.body;

  // Sent-message counts (drafts don't count) + recent inbound for loop detection.
  const directions = await db
    .selectFrom("messages")
    .select(["direction", "body"])
    .where("conversation_id", "=", input.conversationId)
    .orderBy("created_at", "desc")
    .execute();
  const inboundCount = directions.filter((m) => m.direction === "inbound").length;
  const outboundCount = directions.filter((m) => m.direction === "outbound").length;
  const recentInbound = directions.filter((m) => m.direction === "inbound").map((m) => m.body ?? "");

  const rel = leadId
    ? await db
        .selectFrom("relationship_state")
        .select(["stage", "summary", "intent_score as intentScore", "do_not_reply as doNotReply", "ai_turn_count as aiTurnCount", "last_ai_reply_at as lastAiReplyAt"])
        .where("lead_id", "=", leadId)
        .executeTakeFirst()
    : undefined;

  // ----- PRE-GATE (Phase 3): cheapest tier — ZERO model calls -----
  const preGate = evaluatePreGate({
    message: question,
    doNotReply: rel?.doNotReply ?? false,
    aiTurnCount: rel?.aiTurnCount ?? 0,
    lastAiReplyAt: rel?.lastAiReplyAt ?? null,
    pipelineStage: convo.pipelineStage ?? null,
    relationshipStage: rel?.stage ?? null,
    inboundCount,
    outboundCount,
    recentInbound,
    maxAiTurns: limits.maxAiTurns,
    cooldownMinutes: limits.cooldownMinutes,
    now,
  });
  if (preGate.disposition === "skip") {
    deps.log?.(`brain: pre-gate skipped conversation ${input.conversationId} (${preGate.reason})`);
    return { status: "skipped", reason: preGate.reason };
  }
  if (preGate.disposition === "handoff" || preGate.disposition === "stop") {
    return handlePreGateEscalation(deps, { convoId: input.conversationId, workspaceId: convo.workspaceId, leadId, campaignId: input.campaignId, question, preGate, now });
  }

  // ----- BUDGET gate (Phase 3): hard-stop before any spend -----
  const budgetCheck = await checkBudget(deps, { workspaceId: convo.workspaceId, campaignId: input.campaignId, budget, now });
  if (budgetCheck.state === "hard") {
    return escalate(deps, {
      convoId: input.conversationId,
      workspaceId: convo.workspaceId,
      leadId,
      campaignId: input.campaignId,
      reason: "budget_exceeded",
      reasoning: { reason: "budget_exceeded", question, usdUsed: budgetCheck.usdUsed, cap: budgetCheck.cap },
    });
  }

  const classification = classifyInbound(question);

  // ----- HOT-LEAD detection (Phase 4): hand off before any spend -----
  const projectedIntent = clamp((rel?.intentScore ?? 0) + classification.intentDelta, 0, 100);
  const hot = detectHotLead({
    intent: classification.intent,
    projectedIntentScore: projectedIntent,
    message: question,
    escalateOn: guardrails.escalate_on,
  });
  if (hot.hot) {
    return handleHotLead(deps, {
      convo: { id: convo.id, workspaceId: convo.workspaceId },
      leadId,
      campaignId: input.campaignId,
      question,
      reasons: hot.reasons,
      intent: classification.intent,
      sentiment: classification.sentiment,
      intentScore: projectedIntent,
      history: ordered.map((m) => ({ direction: m.direction as "inbound" | "outbound", body: m.body ?? "" })),
      now,
    });
  }

  // ----- "Are you AI?" → fixed honest disclosure (NEVER model-generated) -----
  if (detectAiIdentityQuestion(question)) {
    return commitDraft(deps, {
      convo,
      leadId,
      campaignId: input.campaignId,
      body: AI_IDENTITY_RESPONSE,
      confidence: 1,
      grounded: true,
      inPolicy: true,
      reasoning: { action: "answer", question, intent: classification.intent, tier: "canned_ai_disclosure", hasNewInfo: false },
      autonomyMode: autonomy.mode,
      threshold,
    });
  }

  // Retrieve grounding (only if we have an embedder + KB) and lead facts.
  const chunks =
    knowledgeBaseId && deps.embeddingAdapter
      ? await retrieveChunks(db, deps.embeddingAdapter, knowledgeBaseId, question)
      : [];
  const relevant = chunks.filter((c) => c.similarity >= GROUNDING_MIN_SIMILARITY);
  const facts = leadId && deps.embeddingAdapter ? await retrieveFacts(db, deps.embeddingAdapter, leadId, question) : [];

  const action = decideAction(classification, relevant.length > 0);

  const baseReasoning = {
    action,
    question,
    intent: classification.intent,
    sentiment: classification.sentiment,
    topic: classification.topic,
    isFactualQuestion: classification.isFactualQuestion,
    hasNewInfo: classification.hasNewInfo,
    intentDelta: classification.intentDelta,
    chunkIds: relevant.map((c) => c.id),
    topSimilarity: chunks[0]?.similarity ?? null,
  };

  // Grounding guard / non-draftable actions → escalate (no body, no invented fact).
  const canDraft = action !== "escalate" && action !== "wait";
  if (!canDraft || !deps.textAdapter) {
    const reason = !deps.textAdapter
      ? "no_model"
      : classification.isFactualQuestion && relevant.length === 0
        ? "out_of_knowledge"
        : classification.intent === "not_interested"
          ? "hard_no"
          : "policy";
    return escalate(deps, { convoId: input.conversationId, workspaceId: convo.workspaceId, leadId, campaignId: input.campaignId, reason, reasoning: { ...baseReasoning, reason } });
  }

  // ----- COST LEVER: canned-FAQ path (no reasoning-model call) -----
  if (action === "answer" && (chunks[0]?.similarity ?? 0) >= FAQ_DIRECT_SIMILARITY && relevant[0]) {
    return commitDraft(deps, {
      convo,
      leadId,
      campaignId: input.campaignId,
      body: relevant[0].body,
      confidence: clamp(relevant[0].similarity, 0, 1),
      grounded: true,
      inPolicy: true,
      reasoning: { ...baseReasoning, tier: "canned" },
      autonomyMode: autonomy.mode,
      threshold,
    });
  }

  // ----- Draft (metered reasoning model), grounded strictly in retrieved chunks -----
  const prompt = buildDraftPrompt({
    action,
    lastMessage: question,
    chunks: relevant.map((c) => c.body),
    facts: facts.map((f) => f.body),
    summary: rel?.summary ?? null,
    history: ordered.map((m) => ({ direction: m.direction as "inbound" | "outbound", body: m.body ?? "" })),
    objective,
    guardrails,
    voice,
  });
  let body: string;
  try {
    body = (
      await meteredGenerate(
        deps,
        { workspaceId: convo.workspaceId, campaignId: input.campaignId, conversationId: input.conversationId, leadId, kind: "draft", model: modelOf(deps), budget, now },
        prompt,
      )
    ).trim();
  } catch (err) {
    deps.log?.(`brain: draft generation failed for ${input.conversationId}: ${String(err)}`);
    body = "";
  }
  if (!body) {
    return escalate(deps, { convoId: input.conversationId, workspaceId: convo.workspaceId, leadId, campaignId: input.campaignId, reason: "generation_failed", reasoning: { ...baseReasoning, reason: "generation_failed" } });
  }

  const confidence = relevant.length > 0 ? clamp(relevant[0].similarity, 0, 1) : 0.5;
  return commitDraft(deps, {
    convo,
    leadId,
    campaignId: input.campaignId,
    body,
    confidence,
    grounded: action === "answer" && relevant.length > 0,
    inPolicy: true,
    reasoning: { ...baseReasoning, tier: "draft" },
    autonomyMode: autonomy.mode,
    threshold,
  });
}

interface ConvoRef {
  id: string;
  workspaceId: string;
  channel?: string;
  accountId?: string | null;
}

/**
 * Persist a draft, then apply the autonomy dial: auto-send (approve → enqueue the
 * Phase 1 reply through the safety spine) or leave it pending for human approval.
 */
async function commitDraft(
  deps: EngineDeps,
  input: {
    convo: ConvoRef;
    leadId: string | null;
    campaignId: string | null;
    body: string;
    confidence: number;
    grounded: boolean;
    inPolicy: boolean;
    reasoning: Record<string, unknown>;
    autonomyMode: ReturnType<typeof autonomyFrom>["mode"];
    threshold: number;
  },
): Promise<TurnOutcome> {
  const { db } = deps;
  // Make this the only live draft for the conversation.
  await db.updateTable("message_drafts").set({ status: "discarded" }).where("conversation_id", "=", input.convo.id).where("status", "=", "pending").execute();

  const decision = decideAutonomy({
    mode: input.autonomyMode,
    confidence: input.confidence,
    threshold: input.threshold,
    grounded: input.grounded,
    inPolicy: input.inPolicy,
  });

  const draft = await db
    .insertInto("message_drafts")
    .values({
      workspace_id: input.convo.workspaceId,
      conversation_id: input.convo.id,
      lead_id: input.leadId,
      campaign_id: input.campaignId,
      status: "pending",
      body: input.body,
      confidence: input.confidence,
      reasoning: JSON.stringify({ ...input.reasoning, autonomy: decision.reason }) as unknown as Json,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  if (decision.send) {
    const res = await approveDraft(deps, { workspaceId: input.convo.workspaceId, draftId: draft.id });
    if (res.status === "approved") {
      deps.log?.(`brain: auto-sent draft ${draft.id} (${decision.reason}) on conversation ${input.convo.id}`);
      return { status: "auto_sent", draftId: draft.id, confidence: input.confidence };
    }
    deps.log?.(`brain: auto-send fell back to pending for draft ${draft.id}`);
  }
  deps.log?.(`brain: drafted reply for conversation ${input.convo.id} (${decision.reason})`);
  return { status: "drafted", draftId: draft.id, confidence: input.confidence };
}

/**
 * Hot-lead handoff (Phase 4): mark the relationship hot, flag the thread
 * important, PAUSE the AI, write a deterministic summary package, and notify the
 * human. No model call — the point is to stop spending and get a person involved.
 */
async function handleHotLead(
  deps: EngineDeps,
  input: {
    convo: { id: string; workspaceId: string };
    leadId: string | null;
    campaignId: string | null;
    question: string;
    reasons: HotLeadReason[];
    intent: string;
    sentiment: string;
    intentScore: number;
    history: { direction: "inbound" | "outbound"; body: string }[];
    now: Date;
  },
): Promise<TurnOutcome> {
  const { db } = deps;
  const nowIso = input.now.toISOString();

  // Who they are + key facts (plain reads — no embedding/model call).
  const lead = input.leadId
    ? await db.selectFrom("leads").select(["enrichment", "linkedin_url", "email"]).where("id", "=", input.leadId).executeTakeFirst()
    : undefined;
  const e = asObject(lead?.enrichment);
  const name = [e.firstName, e.lastName].filter(Boolean).join(" ").trim() || (typeof e.headline === "string" ? e.headline : "") || lead?.email || lead?.linkedin_url || "this lead";
  const factRows = input.leadId
    ? await db.selectFrom("facts").select("body").where("lead_id", "=", input.leadId).orderBy("updated_at", "desc").limit(5).execute()
    : [];

  const summary = buildHandoffSummary({
    name,
    headline: typeof e.headline === "string" ? e.headline : null,
    company: typeof e.company === "string" ? e.company : null,
    role: typeof e.role === "string" ? e.role : null,
    intent: input.intent,
    intentScore: input.intentScore,
    reasons: input.reasons,
    facts: factRows.map((f) => f.body),
    recentMessages: input.history,
    lastMessage: input.question,
  });

  // Relationship → hot_lead + PAUSE the AI (do_not_reply) + record the briefing.
  if (input.leadId) {
    await db
      .insertInto("relationship_state")
      .values({
        lead_id: input.leadId,
        workspace_id: input.convo.workspaceId,
        campaign_id: input.campaignId,
        stage: "hot_lead",
        intent_score: input.intentScore,
        sentiment: input.sentiment,
        do_not_reply: true,
        summary: summary.text,
        next_action: summary.nextStep,
        next_action_at: nowIso,
      })
      .onConflict((oc) =>
        oc.column("lead_id").doUpdateSet({
          stage: "hot_lead",
          intent_score: input.intentScore,
          sentiment: input.sentiment,
          do_not_reply: true,
          summary: summary.text,
          next_action: summary.nextStep,
          next_action_at: nowIso,
          updated_at: nowIso,
        }),
      )
      .execute();
  }

  // Flag the thread important + reply-required (the cockpit surfaces it).
  await db.updateTable("conversations").set({ is_important: true, needs_attention: true, updated_at: nowIso }).where("id", "=", input.convo.id).execute();

  // Notify the human with the summary.
  await db
    .insertInto("notifications")
    .values({
      workspace_id: input.convo.workspaceId,
      type: "hot_lead",
      title: `🔥 Hot lead: ${name}`,
      body: `${summary.text.slice(0, 480)}${summary.text.length > 480 ? "…" : ""}`,
    })
    .execute();

  // Supersede any pending draft; write the escalation carrying the summary.
  await db.updateTable("message_drafts").set({ status: "discarded" }).where("conversation_id", "=", input.convo.id).where("status", "=", "pending").execute();
  const draft = await db
    .insertInto("message_drafts")
    .values({
      workspace_id: input.convo.workspaceId,
      conversation_id: input.convo.id,
      lead_id: input.leadId,
      campaign_id: input.campaignId,
      status: "escalated",
      body: null,
      confidence: null,
      reasoning: JSON.stringify({ reason: "hot_lead", reasons: input.reasons, summary: summary.text, nextStep: summary.nextStep, intent: input.intent, intentScore: input.intentScore }) as unknown as Json,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  deps.log?.(`brain: HOT LEAD on conversation ${input.convo.id} (${input.reasons.join(", ")})`);
  return { status: "escalated", reason: "hot_lead", draftId: draft.id };
}

/**
 * Pre-gate handoff/stop → escalate to a human with ZERO model calls. `stop`
 * (opt-out / loop) also suppresses the lead and/or mutes the AI on the thread.
 */
async function handlePreGateEscalation(
  deps: EngineDeps,
  input: { convoId: string; workspaceId: string; leadId: string | null; campaignId: string | null; question: string; preGate: PreGateDecision; now: Date },
): Promise<TurnOutcome> {
  const { db } = deps;
  const reason = input.preGate.reason;

  if (input.preGate.disposition === "stop" && input.leadId) {
    const nowIso = input.now.toISOString();
    await db
      .insertInto("relationship_state")
      .values({ lead_id: input.leadId, workspace_id: input.workspaceId, do_not_reply: true })
      .onConflict((oc) => oc.column("lead_id").doUpdateSet({ do_not_reply: true, updated_at: nowIso }))
      .execute();
    if (reason === "unsubscribe" || reason === "not_interested") {
      const lead = await db.selectFrom("leads").select(["linkedin_url", "email"]).where("id", "=", input.leadId).executeTakeFirst();
      if (lead) await addToDoNotContact(db, input.workspaceId, lead, reason);
    }
  }

  return escalate(deps, { convoId: input.convoId, workspaceId: input.workspaceId, leadId: input.leadId, campaignId: input.campaignId, reason, reasoning: { reason, question: input.question, disposition: input.preGate.disposition } });
}

/** Supersede any pending draft, write an escalation (body null), flag for a human. */
async function escalate(
  deps: EngineDeps,
  input: { convoId: string; workspaceId: string; leadId: string | null; campaignId: string | null; reason: string; reasoning: Record<string, unknown> },
): Promise<TurnOutcome> {
  const { db } = deps;
  await db.updateTable("message_drafts").set({ status: "discarded" }).where("conversation_id", "=", input.convoId).where("status", "=", "pending").execute();
  const draft = await db
    .insertInto("message_drafts")
    .values({
      workspace_id: input.workspaceId,
      conversation_id: input.convoId,
      lead_id: input.leadId,
      campaign_id: input.campaignId,
      status: "escalated",
      body: null,
      confidence: null,
      reasoning: JSON.stringify(input.reasoning) as unknown as Json,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db.updateTable("conversations").set({ needs_attention: true }).where("id", "=", input.convoId).execute();
  deps.log?.(`brain: escalated conversation ${input.convoId} (${input.reason})`);
  return { status: "escalated", reason: input.reason, draftId: draft.id };
}
