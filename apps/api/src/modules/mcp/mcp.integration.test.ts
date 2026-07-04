// Test gate — MCP server (integrations Phase D). Constructs the REAL services
// manually (the repo's test pattern — tsx/esbuild emits no decorator metadata,
// so Nest DI can't boot under the test runner) and mounts the REAL
// McpController on a bare express app, then speaks JSON-RPC over Streamable
// HTTP exactly like an MCP client:
//   1. AUTH      — no/bad key → 401 JSON-RPC error; GET → 405.
//   2. INIT      — initialize handshake succeeds.
//   3. TOOLS     — tools/list exposes the read+write set for an "all" key.
//   4. CALL      — tools/call list_campaigns returns the seeded campaign.
//   5. SCOPE     — the key only sees ITS workspace's campaigns.
//   6. READ-ONLY — a read_only key's tools/list has NO mutating tools.
//
// Run: pnpm --filter @10xconnect/api test:integration

import "reflect-metadata";

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { createChannelAdapter } from "@10xconnect/adapters";
import { createDb, createServiceClient, type DB } from "@10xconnect/db";
import express from "express";
import type { Kysely } from "kysely";

import { ApiKeyAuthService } from "../../auth/api-key-auth.service";
import { SecretCipher } from "../../common/crypto/secret-cipher";
import { AccountsService } from "../accounts.module";
import { AnalyticsService } from "../analytics.module";
import { ApiKeysService } from "../api-keys.module";
import { CampaignRunService } from "../campaigns/campaign-run.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import { ConversationsService } from "../conversations.module";
import { WebhooksService } from "../webhooks.module";

import { McpController } from "./mcp.module";
import { McpToolsService } from "./mcp-tools.service";

let db: Kysely<DB>;
let baseUrl: string;
let httpServer: ReturnType<express.Express["listen"]>;
const admin = createServiceClient();
const cleanupUsers: string[] = [];

interface Seeded {
  workspaceId: string;
  campaignName: string;
  allKey: string;
  readOnlyKey: string;
}

async function seedTenant(): Promise<Seeded> {
  const suffix = randomUUID();
  const created = await admin.auth.admin.createUser({
    email: `mcp-${suffix}@10xconnect.test`,
    password: `Pw-${suffix}!`,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("failed to create seed user");
  }
  cleanupUsers.push(created.data.user.id);
  const ws = await db
    .insertInto("workspaces")
    .values({ name: `MCP ${suffix}`, owner_id: created.data.user.id })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db
    .insertInto("memberships")
    .values({ workspace_id: ws.id, user_id: created.data.user.id, role: "owner" })
    .execute();
  const campaignName = `MCP Campaign ${suffix.slice(0, 8)}`;
  await db
    .insertInto("campaigns")
    .values({ workspace_id: ws.id, name: campaignName, status: "draft" })
    .execute();
  const keys = new ApiKeysService(db);
  const allKey = await keys.create(ws.id, { name: "mcp-all" });
  const readOnlyKey = await keys.create(ws.id, { name: "mcp-ro", permission: "read_only" });
  return { workspaceId: ws.id, campaignName, allKey: allKey.key, readOnlyKey: readOnlyKey.key };
}

async function rpc(
  key: string | null,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/v1/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  // enableJsonResponse → plain JSON; tolerate an SSE-framed body just in case.
  const jsonText = text.startsWith("event:")
    ? (text.split("\n").find((l) => l.startsWith("data:")) ?? "data: {}").slice(5)
    : text;
  return { status: res.status, json: JSON.parse(jsonText || "{}") as Record<string, unknown> };
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  },
};

function toolNames(json: Record<string, unknown>): string[] {
  const result = json.result as { tools?: Array<{ name: string }> } | undefined;
  return (result?.tools ?? []).map((t) => t.name);
}

before(async () => {
  db = createDb();

  // Manual wiring (mirrors the Nest module graph, minus DI).
  const adapter = createChannelAdapter();
  const cipher = new SecretCipher(randomBytes(32).toString("hex"));
  const engineDeps = {
    db,
    adapter,
    config: { minSpacingMs: 1000, jitterMs: 0, ignoreWorkingHours: true, batchSize: 50 },
    now: () => new Date(),
  };
  const campaigns = new CampaignsService(db);
  const tools = new McpToolsService(
    db,
    new AccountsService(db, adapter, cipher),
    campaigns,
    new CampaignRunService(db, engineDeps, campaigns),
    new ConversationsService(db, adapter),
    new AnalyticsService(db),
    new WebhooksService(db, cipher),
  );
  const controller = new McpController(new ApiKeyAuthService(db), tools);

  const appx = express();
  appx.use(express.json());
  appx.post("/api/v1/mcp", (req, res) => void controller.handle(req, res));
  appx.all("/api/v1/mcp", (_req, res) => controller.methodNotAllowed(res));
  httpServer = appx.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("test server failed to bind");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  for (const userId of cleanupUsers) {
    await admin.auth.admin.deleteUser(userId);
  }
  await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
  await db?.destroy();
});

test("mcp: auth, initialize, tools, scoping, read-only gating", async () => {
  const tenantA = await seedTenant();
  const tenantB = await seedTenant();

  // --- 1. AUTH ---------------------------------------------------------------
  const noKey = await rpc(null, INITIALIZE);
  assert.equal(noKey.status, 401, "no key → 401");
  const badKey = await rpc("10xc_not-a-real-key", INITIALIZE);
  assert.equal(badKey.status, 401, "bad key → 401");
  const get = await fetch(`${baseUrl}/api/v1/mcp`, {
    headers: { authorization: `Bearer ${tenantA.allKey}` },
  });
  assert.equal(get.status, 405, "GET → 405 (stateless server)");

  // --- 2. INITIALIZE -----------------------------------------------------------
  const init = await rpc(tenantA.allKey, INITIALIZE);
  assert.equal(init.status, 200, "initialize succeeds");
  const initResult = init.json.result as { serverInfo?: { name?: string } };
  assert.equal(initResult.serverInfo?.name, "10xconnect");

  // --- 3. TOOLS/LIST (all key) --------------------------------------------------
  const list = await rpc(tenantA.allKey, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(list.status, 200);
  const names = toolNames(list.json);
  for (const expected of [
    "list_accounts",
    "list_campaigns",
    "get_campaign_analytics",
    "search_leads",
    "list_conversations",
    "pause_campaign",
    "send_reply",
    "create_webhook",
  ]) {
    assert.ok(names.includes(expected), `tools include ${expected}`);
  }

  // --- 4. TOOLS/CALL list_campaigns -----------------------------------------------
  const call = await rpc(tenantA.allKey, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "list_campaigns", arguments: {} },
  });
  assert.equal(call.status, 200);
  const callResult = call.json.result as { content?: Array<{ text?: string }>; isError?: boolean };
  assert.ok(!callResult.isError, "tool call succeeded");
  const text = callResult.content?.[0]?.text ?? "";
  assert.ok(text.includes(tenantA.campaignName), "returns tenant A's campaign");

  // --- 5. SCOPE: tenant A's key never sees tenant B ---------------------------------
  assert.ok(!text.includes(tenantB.campaignName), "tenant B's campaign is invisible to A's key");

  // --- 6. READ-ONLY: mutating tools absent --------------------------------------
  const roList = await rpc(tenantA.readOnlyKey, { jsonrpc: "2.0", id: 4, method: "tools/list" });
  const roNames = toolNames(roList.json);
  assert.ok(roNames.includes("list_campaigns"), "read tools available to read_only key");
  for (const mutating of ["pause_campaign", "resume_campaign", "send_reply", "create_webhook"]) {
    assert.ok(!roNames.includes(mutating), `${mutating} hidden from read_only key`);
  }
});
