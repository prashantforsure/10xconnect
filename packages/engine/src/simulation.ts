// Per-workspace SIMULATION (test) mode — a hard technical guardrail so a workspace
// can exercise the FULL pipeline (enrollment → dispatch → rate governor → state →
// analytics → inbox) WITHOUT any real provider call reaching a prospect. The
// transport adapter (mock|unipile) is a single GLOBAL env var (packages/adapters
// factory), so on a production deployment there is otherwise no per-workspace way
// to test safely — this closes that gap (CLAUDE.md §2: safety over volume).
//
// Resolution (resolveSimulation / isWorkspaceSimulated):
//   1. workspaces.settings.simulation_mode, if an explicit boolean, WINS — a
//      developer can force a real send (false); any workspace can opt in (true).
//   2. otherwise default to whether the workspace OWNER's email is on the developer
//      allowlist (isDeveloperEmail) — developer workspaces are safe by default,
//      real customer workspaces send for real by default.
//
// Enforced at EVERY real-provider call site in the dispatch path (executor send,
// conversation-reply send, activity-variable profile read) — a leak in any one
// breaks the guarantee.

import { isDeveloperEmail } from "@10xconnect/config";
import type { ActionResult } from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import type { Kysely } from "kysely";

/** providerRef stamped on a short-circuited send so persisted results are filterable. */
export const SIMULATED_PROVIDER_REF = "SIMULATED";

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * PURE resolution of simulation mode (unit-testable without a DB): an explicit
 * `settings.simulation_mode` boolean wins; otherwise a developer-owned workspace
 * defaults to simulated.
 */
export function resolveSimulation(settings: unknown, ownerEmail: string | null | undefined): boolean {
  const explicit = asObject(settings).simulation_mode;
  if (typeof explicit === "boolean") {
    return explicit;
  }
  return isDeveloperEmail(ownerEmail ?? null);
}

/** Is this workspace in simulation/test mode (no real provider calls)? */
export async function isWorkspaceSimulated(db: Kysely<DB>, workspaceId: string): Promise<boolean> {
  const row = await db
    .selectFrom("workspaces")
    .leftJoin("profiles", "profiles.id", "workspaces.owner_id")
    .select(["workspaces.settings as settings", "profiles.email as ownerEmail"])
    .where("workspaces.id", "=", workspaceId)
    .executeTakeFirst();
  if (!row) {
    return false;
  }
  return resolveSimulation(row.settings, row.ownerEmail);
}

/**
 * Synthetic success for a short-circuited (simulated) send: the SAME success
 * contract the real adapter returns, tagged providerRef "SIMULATED" so persisted
 * actions.result / messages carry the marker for analytics + inbox filtering.
 */
export function simulatedActionResult(idempotencyKey: string, at: Date = new Date()): ActionResult {
  return {
    status: "success",
    idempotencyKey,
    providerRef: SIMULATED_PROVIDER_REF,
    deduplicated: false,
    at: at.toISOString(),
  };
}
