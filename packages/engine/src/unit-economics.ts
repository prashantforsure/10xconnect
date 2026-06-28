// Unit-economics dashboard (Phase 7.5). The real cost of outcomes: AI spend (from
// the Phase 3 budget_ledger) divided by what it produced — conversations, qualified
// leads, and BOOKED MEETINGS (the inbox pipeline outcomes). cost-per-booked-meeting
// is the number that decides whether the AI pays for itself. All real, from
// budget_ledger + conversations.pipeline_stage.
//
// Scopes to the whole workspace (overall) OR a single campaign. Per-campaign cost is
// the A/B avatar-testing readout: budget_ledger is keyed by campaign_id (spend is
// directly attributable); conversation outcomes are attributed by joining
// conversations → lead_campaign_state on (lead_id, workspace_id) for that campaign.
// A lead enrolled in two campaigns is attributed to each — fine for A/B disjoint lists.

import type { DB } from "@10xconnect/db";
import type { Kysely } from "kysely";

export interface UnitEconomics {
  totalSpendUsd: number;
  totalTokens: number;
  conversations: number;
  replies: number;
  qualified: number;
  bookedMeetings: number;
  /** Spend ÷ conversations (null when there are no conversations yet). */
  costPerConversationUsd: number | null;
  /** Spend ÷ qualified leads. */
  costPerQualifiedUsd: number | null;
  /** Spend ÷ booked meetings — the headline unit-economics number. */
  costPerBookedMeetingUsd: number | null;
}

function ratio(spend: number, count: number): number | null {
  return count > 0 ? Math.round((spend / count) * 10_000) / 10_000 : null;
}

/**
 * Compute unit economics over an optional trailing window, scoped to the whole
 * workspace or (when `campaignId` is given) a single campaign. Spend is the sum of
 * budget_ledger (per-campaign-day AI spend rollup); outcomes come from conversations
 * (total, qualified, booked) + inbound messages (replies). When scoped to a campaign,
 * conversations/replies are attributed via lead_campaign_state. Postgres `numeric`
 * comes back as a STRING, so spend is coerced with Number().
 */
export async function computeUnitEconomics(
  db: Kysely<DB>,
  input: { workspaceId: string; campaignId?: string; windowDays?: number; now?: Date },
): Promise<UnitEconomics> {
  const now = input.now ?? new Date();
  const sinceWindow =
    input.windowDays != null ? new Date(now.getTime() - input.windowDays * 86_400_000).toISOString().slice(0, 10) : null;
  const sinceTs = input.windowDays != null ? new Date(now.getTime() - input.windowDays * 86_400_000).toISOString() : null;
  const campaignId = input.campaignId;

  // Spend + tokens from the budget ledger (numeric usd → string → Number).
  // budget_ledger is keyed by campaign_id, so per-campaign spend is exact.
  let spendQ = db
    .selectFrom("budget_ledger")
    .select((eb) => [eb.fn.sum<string>("usd_used").as("usd"), eb.fn.sum<string>("tokens_used").as("tokens")])
    .where("workspace_id", "=", input.workspaceId);
  if (campaignId) spendQ = spendQ.where("campaign_id", "=", campaignId);
  if (sinceWindow) spendQ = spendQ.where("window", ">=", sinceWindow);
  const spendRow = await spendQ.executeTakeFirst();
  const totalSpendUsd = Number(spendRow?.usd ?? 0);
  const totalTokens = Number(spendRow?.tokens ?? 0);

  // Conversation outcomes by pipeline stage. Per-campaign: attribute a conversation
  // to a campaign via its lead's lead_campaign_state row (unique per campaign+lead).
  let convQ = campaignId
    ? db
        .selectFrom("conversations as conv")
        .innerJoin("lead_campaign_state as lcs", (join) =>
          join.onRef("lcs.lead_id", "=", "conv.lead_id").onRef("lcs.workspace_id", "=", "conv.workspace_id"),
        )
        .select((eb) => ["conv.pipeline_stage as pipeline_stage", eb.fn.countAll<string>().as("c")])
        .where("conv.workspace_id", "=", input.workspaceId)
        .where("lcs.campaign_id", "=", campaignId)
    : db
        .selectFrom("conversations as conv")
        .select((eb) => ["conv.pipeline_stage as pipeline_stage", eb.fn.countAll<string>().as("c")])
        .where("conv.workspace_id", "=", input.workspaceId);
  if (sinceTs) convQ = convQ.where("conv.created_at", ">=", sinceTs);
  const convRows = await convQ.groupBy("conv.pipeline_stage").execute();

  let conversations = 0;
  let qualified = 0;
  let bookedMeetings = 0;
  for (const r of convRows) {
    const c = Number(r.c);
    conversations += c;
    if (r.pipeline_stage === "qualified") qualified += c;
    if (r.pipeline_stage === "booked") bookedMeetings += c;
  }

  // Replies = inbound messages (engagement volume); same campaign attribution.
  let replyQ = campaignId
    ? db
        .selectFrom("messages as m")
        .innerJoin("conversations as c", "c.id", "m.conversation_id")
        .innerJoin("lead_campaign_state as lcs", (join) =>
          join.onRef("lcs.lead_id", "=", "c.lead_id").onRef("lcs.workspace_id", "=", "c.workspace_id"),
        )
        .select((eb) => eb.fn.countAll<string>().as("c"))
        .where("c.workspace_id", "=", input.workspaceId)
        .where("lcs.campaign_id", "=", campaignId)
        .where("m.direction", "=", "inbound")
    : db
        .selectFrom("messages as m")
        .innerJoin("conversations as c", "c.id", "m.conversation_id")
        .select((eb) => eb.fn.countAll<string>().as("c"))
        .where("c.workspace_id", "=", input.workspaceId)
        .where("m.direction", "=", "inbound");
  if (sinceTs) replyQ = replyQ.where("m.created_at", ">=", sinceTs);
  const replyRow = await replyQ.executeTakeFirst();
  const replies = Number(replyRow?.c ?? 0);

  return {
    totalSpendUsd,
    totalTokens,
    conversations,
    replies,
    qualified,
    bookedMeetings,
    costPerConversationUsd: ratio(totalSpendUsd, conversations),
    costPerQualifiedUsd: ratio(totalSpendUsd, qualified),
    costPerBookedMeetingUsd: ratio(totalSpendUsd, bookedMeetings),
  };
}
