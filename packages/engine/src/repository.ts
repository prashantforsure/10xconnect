// Kysely query helpers shared by the dispatch loop, campaign runner, and inbound
// processor. All queries are workspace-scoped by the caller (service role bypasses
// RLS — scoping is enforced here, defense-in-depth per CLAUDE.md §3).

import type { DB } from "@10xconnect/db";
import type { Kysely } from "kysely";

import type { LeadRow, LeadStateRow, SequenceNodeRow } from "./types";

export async function loadGraph(
  db: Kysely<DB>,
  campaignId: string,
): Promise<{ nodes: SequenceNodeRow[]; byId: Map<string, SequenceNodeRow>; rootId: string | null }> {
  const nodes = (await db
    .selectFrom("sequence_nodes")
    .select([
      "id",
      "campaign_id",
      "workspace_id",
      "kind",
      "type",
      "config",
      "next_node_id",
      "true_node_id",
      "false_node_id",
      "delay_days",
    ])
    .where("campaign_id", "=", campaignId)
    .orderBy("created_at", "asc")
    .execute()) as SequenceNodeRow[];

  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Root = a node not referenced as a target by any edge; earliest created wins.
  const targeted = new Set<string>();
  for (const n of nodes) {
    for (const edge of [n.next_node_id, n.true_node_id, n.false_node_id]) {
      if (edge) {
        targeted.add(edge);
      }
    }
  }
  const root = nodes.find((n) => !targeted.has(n.id)) ?? nodes[0] ?? null;
  return { nodes, byId, rootId: root?.id ?? null };
}

export async function getLead(
  db: Kysely<DB>,
  workspaceId: string,
  leadId: string,
): Promise<LeadRow | undefined> {
  return (await db
    .selectFrom("leads")
    .select([
      "id",
      "workspace_id",
      "linkedin_url",
      "email",
      "enrichment",
      "tags",
      "custom_columns",
      "connection_degree",
    ])
    .where("workspace_id", "=", workspaceId)
    .where("id", "=", leadId)
    .executeTakeFirst()) as LeadRow | undefined;
}

export async function getLeadState(
  db: Kysely<DB>,
  campaignId: string,
  leadId: string,
): Promise<LeadStateRow | undefined> {
  return (await db
    .selectFrom("lead_campaign_state")
    .select([
      "id",
      "workspace_id",
      "lead_id",
      "campaign_id",
      "current_node_id",
      "status",
      "history",
    ])
    .where("campaign_id", "=", campaignId)
    .where("lead_id", "=", leadId)
    .executeTakeFirst()) as LeadStateRow | undefined;
}

/** Start of the current UTC day — the window the governor counts within. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Count successful actions of a type for an account TODAY, across all campaigns
 * (the rate governor aggregates per account, not per campaign — CLAUDE.md §6).
 */
export async function countActionsToday(
  db: Kysely<DB>,
  accountId: string,
  type: string,
  now: Date,
): Promise<number> {
  const { count } = await db
    .selectFrom("actions")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("account_id", "=", accountId)
    .where("type", "=", type)
    .where("status", "=", "success")
    .where("executed_at", ">=", startOfUtcDay(now).toISOString())
    .executeTakeFirstOrThrow();
  return Number(count);
}

/**
 * Has the lead (the recipient) ever sent us an inbound message? Drives the
 * "never_messaged" send condition (CLAUDE.md §7): only send if the recipient has
 * never messaged. Counts inbound messages across the lead's conversations.
 */
export async function leadHasInboundMessage(
  db: Kysely<DB>,
  workspaceId: string,
  leadId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom("messages as m")
    .innerJoin("conversations as c", "c.id", "m.conversation_id")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("c.workspace_id", "=", workspaceId)
    .where("c.lead_id", "=", leadId)
    .where("m.direction", "=", "inbound")
    .executeTakeFirst();
  return Number(row?.count ?? 0) > 0;
}

/** Has an inbound event of `type` been recorded for this lead in this campaign? */
export async function hasLeadEvent(
  db: Kysely<DB>,
  workspaceId: string,
  leadId: string,
  type: string,
  sinceIso?: string,
): Promise<boolean> {
  let q = db
    .selectFrom("lead_events")
    .select("id")
    .where("workspace_id", "=", workspaceId)
    .where("lead_id", "=", leadId)
    .where("type", "=", type);
  if (sinceIso) {
    q = q.where("occurred_at", ">=", sinceIso);
  }
  const row = await q.executeTakeFirst();
  return Boolean(row);
}
