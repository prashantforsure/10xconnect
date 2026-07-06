// Service-role Supabase access for the e2e harness — creates and tears down a
// throwaway workspace (auth user -> handle_new_user trigger mirrors the profile
// -> workspace + owner membership), exactly like
// packages/engine/src/testing/seed-workspace.ts but retaining the credentials so
// the browser can log in through the real UI. Service-role bypasses RLS; these
// helpers NEVER run in app/runtime code — test-only.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadDotenv } from "dotenv";

import { CONTEXT_PATH } from "./config";

let dotenvLoaded = false;
/** Load the repo-root .env (walk up from cwd) once, mirroring @10xconnect/config. */
function ensureEnv(): void {
  if (dotenvLoaded) {
    return;
  }
  dotenvLoaded = true;
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return;
    }
    dir = parent;
  }
}

function requireEnv(name: string, ...fallbacks: string[]): string {
  ensureEnv();
  for (const key of [name, ...fallbacks]) {
    const value = process.env[key];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  throw new Error(
    `e2e: missing env var ${name}. The suite needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY ` +
      `in the repo-root .env to seed a throwaway workspace.`,
  );
}

let cached: SupabaseClient | null = null;
export function serviceClient(): SupabaseClient {
  if (cached) {
    return cached;
  }
  const url = requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  cached = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return cached;
}

export interface SeededContext {
  userId: string;
  workspaceId: string;
  email: string;
  password: string;
}

/** Create a throwaway auth user + workspace + owner membership. */
export async function seedWorkspace(): Promise<SeededContext> {
  const admin = serviceClient();
  const id = randomUUID();
  const email = `e2e-${id}@10xconnect.test`;
  const password = `Pw-${id}!`;

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("e2e: createUser failed");
  }
  const userId = created.data.user.id;

  // handle_new_user already created this user's personal workspace + owner
  // membership; reuse it (renamed) rather than inserting a second workspace.
  const ws = await admin
    .from("workspaces")
    .update({ name: `E2E ${id}` })
    .eq("owner_id", userId)
    .select("id")
    .single();
  if (ws.error || !ws.data) {
    await admin.auth.admin.deleteUser(userId);
    throw ws.error ?? new Error("e2e: workspace lookup failed");
  }
  const workspaceId = ws.data.id as string;

  return { userId, workspaceId, email, password };
}

/** Delete the seed user; the FK cascade removes the workspace + all scoped rows. */
export async function deleteWorkspaceUser(userId: string): Promise<void> {
  const admin = serviceClient();
  await admin.auth.admin.deleteUser(userId);
}

/**
 * Insert an integration_events row directly (bypassing the engine) so the
 * outbound-webhook delivery poller fans it out — used to prove a real event
 * reaches a webhook, without triggering any LinkedIn/adapter activity.
 */
export async function insertIntegrationEvent(
  workspaceId: string,
  type: string,
  payload: unknown,
): Promise<string> {
  const admin = serviceClient();
  const row = await admin
    .from("integration_events")
    .insert({
      workspace_id: workspaceId,
      type,
      dedupe_key: `e2e-${type}-${randomUUID()}`,
      payload,
    })
    .select("id")
    .single();
  if (row.error || !row.data) {
    throw row.error ?? new Error("e2e: integration_events insert failed");
  }
  return row.data.id as string;
}

/**
 * Seed an API key row directly (service-role) so a spec can exercise the public
 * API / MCP endpoint without driving the UI. Mirrors ApiKeysService.create +
 * hashApiKey (sha256 hex of the plaintext, 12-char display prefix). Returns the
 * plaintext `10xc_…` key — used by the MCP e2e to hit the live server.
 */
export async function seedApiKey(
  workspaceId: string,
  permission: "all" | "read_only" = "all",
): Promise<string> {
  const admin = serviceClient();
  const key = `10xc_${randomBytes(24).toString("hex")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const row = await admin.from("api_keys").insert({
    workspace_id: workspaceId,
    hash,
    name: `e2e-${permission}`,
    permission,
    prefix: key.slice(0, 12),
  });
  if (row.error) {
    throw row.error;
  }
  return key;
}

/** Read the seeded context written by global-setup. */
export function loadContext(): SeededContext {
  if (!existsSync(CONTEXT_PATH)) {
    throw new Error(`e2e: context file missing at ${CONTEXT_PATH} — did global-setup run?`);
  }
  return JSON.parse(readFileSync(CONTEXT_PATH, "utf8")) as SeededContext;
}
