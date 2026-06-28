// Budget governor (Phase 3) — the HARD stop, checked BEFORE a draft is generated
// (we never spend to find out we're over budget). When a campaign's AI spend for
// the day reaches its cap we:
//   - drop the campaign's autonomy to approve_all (kills any auto-send — the
//     Phase 4 safety interlock), and
//   - raise a one-time "budget exhausted" notification to the owner.
// The turn then escalates to a human instead of drafting. The SOFT alert (at
// alert_at_pct) is emitted by the metering wrapper as spend accrues.

import { autonomyFrom, type BudgetConfig } from "@10xconnect/core";

import type { EngineDeps } from "../types";

import { emitBudgetNotification } from "./metering";
import { utcDay } from "./window";

export type BudgetState = "ok" | "hard";

export interface BudgetCheck {
  state: BudgetState;
  usdUsed: number;
  cap: number | null;
}

/** Read today's spend and decide whether AI drafting is allowed for this campaign. */
export async function checkBudget(
  deps: EngineDeps,
  input: { workspaceId: string; campaignId: string | null; budget: BudgetConfig; now: Date },
): Promise<BudgetCheck> {
  const cap = input.budget.dailyUsdCap;
  if (!input.campaignId || cap == null) return { state: "ok", usdUsed: 0, cap: null };

  const window = utcDay(input.now);
  const row = await deps.db
    .selectFrom("budget_ledger")
    .select(["usd_used", "hard_stopped"])
    .where("campaign_id", "=", input.campaignId)
    .where("window", "=", window)
    .executeTakeFirst();
  const usdUsed = row ? Number(row.usd_used) : 0;

  if (usdUsed < cap) return { state: "ok", usdUsed, cap };

  // Over cap → hard stop. Drop autonomy to approve_all + notify once.
  await dropToApproveAll(deps, input.campaignId);
  if (!row?.hard_stopped) {
    await deps.db
      .insertInto("budget_ledger")
      .values({
        campaign_id: input.campaignId,
        window,
        workspace_id: input.workspaceId,
        hard_stopped: true,
      })
      .onConflict((oc) => oc.columns(["campaign_id", "window"]).doUpdateSet({ hard_stopped: true }))
      .execute();
    await emitBudgetNotification(deps, input, "ai_budget_exceeded", {
      title: "AI budget reached — replies paused",
      body: `This campaign hit its $${cap} daily AI budget. AI replies are paused (approve-all); they resume tomorrow or raise the cap.`,
    });
    deps.log?.(`budget: hard-stop campaign ${input.campaignId} at $${usdUsed.toFixed(4)} (cap $${cap})`);
  }
  return { state: "hard", usdUsed, cap };
}

/** Force a campaign's autonomy back to approve_all (preserving other keys). */
async function dropToApproveAll(deps: EngineDeps, campaignId: string): Promise<void> {
  const c = await deps.db
    .selectFrom("campaigns")
    .select("autonomy")
    .where("id", "=", campaignId)
    .executeTakeFirst();
  const current = autonomyFrom(c?.autonomy);
  if (current.mode === "approve_all") return;
  await deps.db
    .updateTable("campaigns")
    .set({ autonomy: JSON.stringify({ ...current, mode: "approve_all" }) })
    .where("id", "=", campaignId)
    .execute();
}
