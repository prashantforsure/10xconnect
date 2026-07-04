// Multi-account sender rotation (agency parity — HeyReach/Aimfox). A campaign has
// a POOL of LinkedIn senders (the campaign_accounts join table, else the campaign's
// single account_id for backward compatibility). Each lead is stuck to ONE sender
// for its whole sequence — assigned least-loaded at enrollment so load balances
// across the pool while each account keeps its own dedicated proxy + rate governor
// (3 senders x 25 connection requests = 75 daily touches, ban risk isolated).
//
// Why sticky-per-lead: you can't send a connection request from account A and then a
// message from account B to the SAME person — that breaks the LinkedIn relationship.
// So rotation happens ACROSS leads, never within a single lead's sequence.

import type { DB } from "@10xconnect/db";
import type { Kysely } from "kysely";

/** An account in one of these states can still take a NEW lead assignment / send. */
const HEALTHY = new Set(["active", "warming"]);

/** The campaign's ordered sender pool: campaign_accounts rows, else [account_id]. */
export async function getCampaignPool(
  db: Kysely<DB>,
  campaignId: string,
  fallbackAccountId: string | null,
): Promise<string[]> {
  const rows = await db
    .selectFrom("campaign_accounts")
    .select("account_id")
    .where("campaign_id", "=", campaignId)
    .orderBy("created_at", "asc")
    .execute();
  if (rows.length > 0) {
    return rows.map((r) => r.account_id);
  }
  return fallbackAccountId ? [fallbackAccountId] : [];
}

/** Map account id → status for a set of ids (missing rows are absent from the map). */
export async function accountStatuses(db: Kysely<DB>, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom("sending_accounts")
    .select(["id", "status"])
    .where("id", "in", ids)
    .execute();
  return new Map(rows.map((r) => [r.id, r.status]));
}

/** Filter ids to accounts that are active/warming (can take a new lead / send now). */
export function filterHealthy(ids: string[], status: Map<string, string>): string[] {
  return ids.filter((id) => HEALTHY.has(status.get(id) ?? ""));
}

/**
 * The pool members eligible to take a NEW assignment: prefer healthy (active/warming);
 * if every pool member is paused/restricted/disconnected, fall back to the raw pool so
 * the campaign still enrolls (its actions just hold until an account recovers) — this
 * preserves the pre-rotation single-account behavior.
 */
export async function assignablePool(db: Kysely<DB>, poolIds: string[]): Promise<string[]> {
  if (poolIds.length === 0) return [];
  const status = await accountStatuses(db, poolIds);
  const healthy = filterHealthy(poolIds, status);
  if (healthy.length > 0) return healthy;
  return poolIds.filter((id) => status.has(id));
}

/** Current active-lead load per account in a campaign (drives least-loaded balancing). */
export async function currentLoad(
  db: Kysely<DB>,
  campaignId: string,
  poolIds: string[],
): Promise<Map<string, number>> {
  const load = new Map<string, number>(poolIds.map((id) => [id, 0]));
  if (poolIds.length === 0) return load;
  const rows = await db
    .selectFrom("lead_campaign_state")
    .select((eb) => ["account_id as account_id", eb.fn.countAll<string>().as("n")])
    .where("campaign_id", "=", campaignId)
    .where("status", "=", "active")
    .where("account_id", "in", poolIds)
    .groupBy("account_id")
    .execute();
  for (const r of rows) {
    if (r.account_id) load.set(r.account_id, Number(r.n));
  }
  return load;
}

/**
 * Assign `count` new leads across `poolIds` starting from the given per-account load —
 * each lead goes to the currently least-loaded account (ties → pool order). Returns the
 * assigned account id for each of the `count` slots, in order. Pure/unit-testable.
 */
export function balanceAssign(count: number, poolIds: string[], seedLoad: Map<string, number>): string[] {
  if (poolIds.length === 0) return [];
  const load = new Map(poolIds.map((id) => [id, seedLoad.get(id) ?? 0]));
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    let best = poolIds[0];
    let bestLoad = Number.POSITIVE_INFINITY;
    for (const id of poolIds) {
      const l = load.get(id) ?? 0;
      if (l < bestLoad) {
        bestLoad = l;
        best = id;
      }
    }
    out.push(best);
    load.set(best, bestLoad + 1);
  }
  return out;
}

/**
 * Assign a sticky sender to each of `count` newly-enrolled leads, balanced least-loaded
 * across the campaign's assignable pool. Returns [] when the campaign has no pool (the
 * caller then leaves account_id null → engine falls back to campaign.account_id).
 */
export async function assignSendersForEnroll(
  db: Kysely<DB>,
  campaign: { id: string; account_id: string | null },
  count: number,
): Promise<string[]> {
  const pool = await assignablePool(db, await getCampaignPool(db, campaign.id, campaign.account_id));
  if (pool.length === 0) return [];
  const load = await currentLoad(db, campaign.id, pool);
  return balanceAssign(count, pool, load);
}

/**
 * Assign + persist a sticky sender to every state that has none yet, balanced
 * least-loaded across the campaign's pool. Mutates each state's account_id in place
 * (so callers can schedule immediately) and writes one UPDATE per account. No-op when
 * the campaign has no pool (leads keep account_id null → engine uses campaign default).
 */
export async function assignAndPersist(
  db: Kysely<DB>,
  campaign: { id: string; account_id: string | null },
  states: Array<{ id: string; account_id?: string | null }>,
): Promise<void> {
  const unassigned = states.filter((s) => !s.account_id);
  if (unassigned.length === 0) return;
  const assigned = await assignSendersForEnroll(db, campaign, unassigned.length);
  if (assigned.length !== unassigned.length) return;
  const byAccount = new Map<string, string[]>();
  unassigned.forEach((state, i) => {
    state.account_id = assigned[i];
    const list = byAccount.get(assigned[i]) ?? [];
    list.push(state.id);
    byAccount.set(assigned[i], list);
  });
  for (const [acct, stateIds] of byAccount) {
    await db.updateTable("lead_campaign_state").set({ account_id: acct }).where("id", "in", stateIds).execute();
  }
}

/**
 * Pick a healthy sender to REROUTE a lead to when its assigned sender went
 * paused/restricted/disconnected (§6 "reroute across healthy accounts"), excluding the
 * current one. Returns null when no other healthy pool member exists (caller then holds).
 */
export async function pickRerouteSender(
  db: Kysely<DB>,
  campaign: { id: string; account_id: string | null },
  excludeAccountId: string | null,
): Promise<string | null> {
  const pool = await getCampaignPool(db, campaign.id, campaign.account_id);
  const status = await accountStatuses(db, pool);
  const healthy = filterHealthy(pool, status).filter((id) => id !== excludeAccountId);
  if (healthy.length === 0) return null;
  const load = await currentLoad(db, campaign.id, healthy);
  return balanceAssign(1, healthy, load)[0] ?? null;
}
