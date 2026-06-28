// LLM metering wrapper (Phase 3) — the ONE place an AI draft call goes through,
// so every token + dollar is logged. It:
//   1. runs the generation (preferring the adapter's real token usage),
//   2. appends an llm_usage row (cost-per-CONVERSATION + a routing-tier audit),
//   3. upserts the per-campaign/day budget_ledger rollup (the budget governor's
//      source of truth), and
//   4. fires the one-time SOFT alert when spend crosses alert_at_pct of the cap.
// The HARD stop is enforced upstream (budget.ts) BEFORE the call — we never spend
// to discover we're over budget.

import { type BudgetConfig, estimateUsage, estimateUsd, type TokenUsage } from "@10xconnect/core";
import { sql } from "kysely";

import type { EngineDeps } from "../types";

import { utcDay } from "./window";

export interface MeterContext {
  workspaceId: string;
  campaignId: string | null;
  conversationId: string | null;
  leadId: string | null;
  /** Routing tier — 'draft' (expensive) today; classify is free/deterministic. */
  kind: string;
  /** Model id for pricing + the usage log. */
  model: string;
  /** Campaign budget (for the soft-alert crossing check). */
  budget?: BudgetConfig;
  now: Date;
}

/**
 * Generate text through the metered path. Returns the generated string (a drop-in
 * for textAdapter.generate). Records usage as a side effect; metering failures
 * never block the reply (logged, swallowed).
 */
export async function meteredGenerate(
  deps: EngineDeps,
  ctx: MeterContext,
  input: { prompt: string; system?: string; maxTokens?: number; temperature?: number },
): Promise<string> {
  if (!deps.textAdapter) throw new Error("meteredGenerate: no text adapter");

  // Prefer real provider usage; fall back to a deterministic estimate.
  let text: string;
  let usage: TokenUsage;
  if (deps.textAdapter.generateWithUsage) {
    const res = await deps.textAdapter.generateWithUsage(input);
    text = res.text;
    usage = res.usage ?? estimateUsage(input, res.text);
  } else {
    text = await deps.textAdapter.generate(input);
    usage = estimateUsage(input, text);
  }

  try {
    await record(deps, ctx, usage);
  } catch (err) {
    deps.log?.(`metering: failed to record usage for conversation ${ctx.conversationId}: ${String(err)}`);
  }
  return text;
}

async function record(deps: EngineDeps, ctx: MeterContext, usage: TokenUsage): Promise<void> {
  const usd = estimateUsd(usage, ctx.model);

  // Per-call log (cost-per-conversation, model-routing audit).
  await deps.db
    .insertInto("llm_usage")
    .values({
      workspace_id: ctx.workspaceId,
      campaign_id: ctx.campaignId,
      conversation_id: ctx.conversationId,
      lead_id: ctx.leadId,
      kind: ctx.kind,
      model: ctx.model,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      usd,
    })
    .execute();

  if (!ctx.campaignId) return; // no campaign → no budget rollup

  const window = utcDay(ctx.now);
  // Atomic upsert-increment; RETURNING gives the post-increment totals so we can
  // detect the soft-alert crossing edge.
  const rolled = await deps.db
    .insertInto("budget_ledger")
    .values({
      campaign_id: ctx.campaignId,
      window,
      workspace_id: ctx.workspaceId,
      tokens_used: usage.totalTokens,
      usd_used: usd,
    })
    .onConflict((oc) =>
      oc.columns(["campaign_id", "window"]).doUpdateSet({
        tokens_used: sql`budget_ledger.tokens_used + excluded.tokens_used`,
        usd_used: sql`budget_ledger.usd_used + excluded.usd_used`,
        updated_at: ctx.now.toISOString(),
      }),
    )
    .returning(["usd_used", "soft_alerted"])
    .executeTakeFirst();

  // Soft alert: spend just crossed alert_at_pct of the cap (emit once).
  const cap = ctx.budget?.dailyUsdCap ?? null;
  const pct = ctx.budget?.alertAtPct ?? 0.8;
  if (rolled && cap && cap > 0 && !rolled.soft_alerted) {
    const newTotal = Number(rolled.usd_used);
    const prevTotal = newTotal - usd;
    const threshold = cap * pct;
    if (prevTotal < threshold && newTotal >= threshold) {
      await deps.db
        .updateTable("budget_ledger")
        .set({ soft_alerted: true })
        .where("campaign_id", "=", ctx.campaignId)
        .where("window", "=", window)
        .execute();
      await emitBudgetNotification(deps, ctx, "ai_budget_warning", {
        title: "AI budget alert",
        body: `This campaign's AI replies have used ${Math.round(pct * 100)}% of today's $${cap} budget.`,
      });
    }
  }
}

/** Raise an in-app notification to the workspace (budget warning / exhausted). */
export async function emitBudgetNotification(
  deps: EngineDeps,
  ctx: { workspaceId: string },
  type: "ai_budget_warning" | "ai_budget_exceeded",
  msg: { title: string; body: string },
): Promise<void> {
  await deps.db
    .insertInto("notifications")
    .values({ workspace_id: ctx.workspaceId, type, title: msg.title, body: msg.body })
    .execute();
}
