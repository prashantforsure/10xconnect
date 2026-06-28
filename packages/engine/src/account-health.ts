// Account-health monitor wiring (Phase 7.4, roadmap Step 20). Gathers the REAL
// safety metrics for a sending account — connection acceptance rate, reply rate,
// restriction/captcha signals — from `actions`, `lead_events`, and `notifications`,
// scores them with the pure core monitor (computeHealth), PERSISTS the score, and
// triggers the acceptance-rate AUTO-THROTTLE (a cap multiplier stored on
// warmup_state, honored by the dispatch rate governor) with a one-time owner
// notification. Acceptance rate is the top restriction predictor (§6).

import { acceptanceThrottle, computeHealth, type HealthInput, type HealthResult } from "@10xconnect/core";
import type { DB, Json } from "@10xconnect/db";
import type { Kysely } from "kysely";

export interface AccountHealthReport extends HealthResult {
  accountId: string;
  input: HealthInput;
  /** The acceptance-rate throttle now in effect for this account. */
  throttle: { factor: number; throttled: boolean; reason?: string };
  windowDays: number;
}

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** Count successful actions of a type for an account within the window. */
async function countActions(
  db: Kysely<DB>,
  workspaceId: string,
  accountId: string,
  type: string,
  sinceIso: string,
): Promise<number> {
  const row = await db
    .selectFrom("actions")
    .select((eb) => eb.fn.countAll<string>().as("c"))
    .where("workspace_id", "=", workspaceId)
    .where("account_id", "=", accountId)
    .where("type", "=", type)
    .where("status", "=", "success")
    .where("created_at", ">=", sinceIso)
    .executeTakeFirst();
  return Number(row?.c ?? 0);
}

async function countEvents(
  db: Kysely<DB>,
  workspaceId: string,
  accountId: string,
  type: string,
  sinceIso: string,
): Promise<number> {
  const row = await db
    .selectFrom("lead_events")
    .select((eb) => eb.fn.countAll<string>().as("c"))
    .where("workspace_id", "=", workspaceId)
    .where("account_id", "=", accountId)
    .where("type", "=", type)
    .where("occurred_at", ">=", sinceIso)
    .executeTakeFirst();
  return Number(row?.c ?? 0);
}

async function countNotifications(
  db: Kysely<DB>,
  workspaceId: string,
  accountId: string,
  type: string,
  sinceIso: string,
): Promise<number> {
  const row = await db
    .selectFrom("notifications")
    .select((eb) => eb.fn.countAll<string>().as("c"))
    .where("workspace_id", "=", workspaceId)
    .where("account_id", "=", accountId)
    .where("type", "=", type)
    .where("created_at", ">=", sinceIso)
    .executeTakeFirst();
  return Number(row?.c ?? 0);
}

/** Gather the real health inputs for an account over the trailing window. */
export async function gatherHealthInput(
  db: Kysely<DB>,
  input: { workspaceId: string; accountId: string; windowDays: number; now: Date },
): Promise<HealthInput> {
  const since = isoDaysAgo(input.now, input.windowDays);
  const { workspaceId, accountId } = input;
  const [connectionRequestsSent, messagesSent, invitesAccepted, replies, restrictionEvents, captchaEvents] =
    await Promise.all([
      countActions(db, workspaceId, accountId, "connection_request", since),
      countActions(db, workspaceId, accountId, "message", since),
      countEvents(db, workspaceId, accountId, "invite_accepted", since),
      countEvents(db, workspaceId, accountId, "reply", since),
      countNotifications(db, workspaceId, accountId, "account_restricted", since),
      countNotifications(db, workspaceId, accountId, "account_checkpoint", since),
    ]);
  return { connectionRequestsSent, messagesSent, invitesAccepted, replies, restrictionEvents, captchaEvents };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Compute + persist account health and trigger the acceptance-rate auto-throttle.
 * Writes health_score, stores the throttle factor on warmup_state (honored by the
 * dispatch governor), and raises a one-time notification when an account newly
 * enters the throttled state. Returns the full report.
 */
export async function computeAccountHealth(
  db: Kysely<DB>,
  input: { workspaceId: string; accountId: string; windowDays?: number; now?: Date },
): Promise<AccountHealthReport> {
  const windowDays = input.windowDays ?? 30;
  const now = input.now ?? new Date();

  const account = await db
    .selectFrom("sending_accounts")
    .select(["id", "warmup_state"])
    .where("workspace_id", "=", input.workspaceId)
    .where("id", "=", input.accountId)
    .executeTakeFirst();
  if (!account) {
    throw new Error("Account not found");
  }

  const healthInput = await gatherHealthInput(db, { ...input, windowDays, now });
  const health = computeHealth(healthInput);
  const throttle = acceptanceThrottle({
    acceptanceRate: health.acceptanceRate,
    connectionRequestsSent: healthInput.connectionRequestsSent,
  });

  const warmup = asObject(account.warmup_state);
  const priorFactor = typeof asObject(warmup.throttle).factor === "number" ? (asObject(warmup.throttle).factor as number) : 1;
  const nextWarmup = {
    ...warmup,
    throttle: { factor: throttle.factor, throttled: throttle.throttled, reason: throttle.reason ?? null, updatedAt: now.toISOString() },
  };

  await db
    .updateTable("sending_accounts")
    .set({ health_score: health.score, warmup_state: JSON.stringify(nextWarmup) as unknown as Json })
    .where("workspace_id", "=", input.workspaceId)
    .where("id", "=", input.accountId)
    .execute();

  // Notify once on transition INTO a throttled state (don't spam every recompute).
  if (throttle.throttled && priorFactor >= 1) {
    const name = await db
      .selectFrom("sending_accounts")
      .select("name")
      .where("id", "=", input.accountId)
      .executeTakeFirst();
    await db
      .insertInto("notifications")
      .values({
        workspace_id: input.workspaceId,
        account_id: input.accountId,
        type: "account_throttled",
        title: `${name?.name ?? "A LinkedIn account"} auto-throttled`,
        body: throttle.reason ?? "Low acceptance rate — sending caps were reduced automatically.",
      })
      .execute();
  }

  return { ...health, accountId: input.accountId, input: healthInput, throttle, windowDays };
}
