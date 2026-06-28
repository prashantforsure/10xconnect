// Phase 5 Test Gate (DB-backed) — Variable registry + per-prospect preview + AI
// prompt templates. Runs against the dev Postgres with a deterministic, profile-
// varying text adapter that COUNTS calls (so we can assert "no second LLM call"
// when dispatch reuses the cache).
//
// Proves: the resolver fills variables + fallback/on_missing (no empty brackets);
// preview produces distinct per-contact output from real profile data; the cached
// preview is reused at dispatch with NO second LLM call; editing the prompt
// invalidates the cache; and prompt templates save/load by scope with run_count.
//
// Run: pnpm --filter @10xconnect/engine test:integration

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  type ChannelAdapter,
  type MessageBody,
  renderMessageBody,
  resolveContactVariables,
  type TextGenerationAdapter,
} from "@10xconnect/core";

import { previewNode, resolvePersonalizedMessage } from "./personalization";
import { listTemplates, saveTemplate, useTemplate } from "./templates";
import { seedWorkspace } from "./testing/seed-workspace";
import type { EngineDeps } from "./types";

/** Profile-varying, call-counting text adapter (reads Company out of the prompt). */
function varyingText(counter: { text: number }): TextGenerationAdapter {
  return {
    generate: async (input) => {
      counter.text += 1;
      const company = /Company:\s*(.+)/.exec(input.prompt)?.[1]?.split("\n")[0]?.trim();
      const role = /Role:\s*(.+)/.exec(input.prompt)?.[1]?.split("\n")[0]?.trim();
      return `saw what you're building at ${(company ?? role ?? "your space").toLowerCase()}`;
    },
  };
}

function deps(db: EngineDeps["db"], over: Partial<EngineDeps> = {}): EngineDeps {
  return {
    db,
    adapter: {} as ChannelAdapter,
    config: { minSpacingMs: 1000, jitterMs: 0, ignoreWorkingHours: true, batchSize: 50 },
    now: () => new Date("2026-06-28T12:00:00.000Z"),
    modelLabel: "mock",
    ...over,
  };
}

async function seedCampaign(db: EngineDeps["db"], workspaceId: string) {
  const c = await db
    .insertInto("campaigns")
    .values({ workspace_id: workspaceId, name: "Camp", status: "draft" })
    .returning("id")
    .executeTakeFirstOrThrow();
  return c.id;
}

async function seedNode(db: EngineDeps["db"], workspaceId: string, campaignId: string, body: MessageBody) {
  const n = await db
    .insertInto("sequence_nodes")
    .values({ workspace_id: workspaceId, campaign_id: campaignId, kind: "action", type: "send_message", config: JSON.stringify({ messageBody: body }) })
    .returning("id")
    .executeTakeFirstOrThrow();
  return n.id;
}

async function seedLead(db: EngineDeps["db"], workspaceId: string, enrichment: Record<string, unknown>) {
  const l = await db
    .insertInto("leads")
    .values({ workspace_id: workspaceId, linkedin_url: `https://linkedin.com/in/lead-${randomUUID()}`, enrichment: JSON.stringify(enrichment), tags: [], connection_degree: 1, enrich_status: "enriched" })
    .returning("id")
    .executeTakeFirstOrThrow();
  return l.id;
}

const AI_BODY: MessageBody = { v: 1, segments: [{ type: "ai", prompt: "Write a short, specific opener." }] };

test("resolver fills variables and applies fallback / on_missing (no empty brackets)", async () => {
  // Pure check (no DB), included in the gate for completeness.
  const r = resolveContactVariables({ enrichment: { firstName: "Dana" }, customColumns: {} });
  assert.equal(r.values.firstName, "Dana");
  assert.equal(r.values.jobTitle, "your role", "fallback applied for a missing field");
  const body: MessageBody = {
    v: 1,
    segments: [
      { type: "text", text: "Hey " },
      { type: "variable", key: "firstName" },
      { type: "text", text: ". Saw your post " },
      { type: "variable", key: "lastPost" },
      { type: "text", text: ". Quick question?" },
    ],
  };
  const out = renderMessageBody(body, r.values, { policyByKey: r.policy });
  assert.equal(out, "Hey Dana. Quick question?");
  assert.ok(!out.includes("{"), "empty lastPost produced NO empty brackets");
});

test("preview produces DIFFERENT output per contact from real profile data", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const counter = { text: 0 };
    const campaignId = await seedCampaign(db, workspaceId);
    const nodeId = await seedNode(db, workspaceId, campaignId, AI_BODY);
    const aId = await seedLead(db, workspaceId, { firstName: "Dana", company: "Acme Robotics" });
    const bId = await seedLead(db, workspaceId, { firstName: "Wei", company: "Globex Health" });

    const preview = await previewNode(deps(db, { textAdapter: varyingText(counter) }), {
      workspaceId,
      campaignId,
      nodeId,
      config: { messageBody: AI_BODY },
      leadIds: [aId, bId],
    });
    assert.equal(preview.results.length, 2);
    const [a, b] = preview.results;
    assert.notEqual(a.text, b.text, "distinct per-contact output");
    assert.match(a.text, /acme robotics/);
    assert.match(b.text, /globex health/);
    assert.ok(!a.text.includes("{") && !b.text.includes("{"), "no empty brackets");
  } finally {
    await w.cleanup();
  }
});

test("cached preview is reused at dispatch — NO second LLM call", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const counter = { text: 0 };
    const campaignId = await seedCampaign(db, workspaceId);
    const nodeId = await seedNode(db, workspaceId, campaignId, AI_BODY);
    const leadId = await seedLead(db, workspaceId, { firstName: "Dana", company: "Acme" });
    const lead = await db.selectFrom("leads").select(["id", "workspace_id", "linkedin_url", "email", "enrichment", "tags", "custom_columns", "connection_degree"]).where("id", "=", leadId).executeTakeFirstOrThrow();

    const d = deps(db, { textAdapter: varyingText(counter) });
    // PREVIEW: generates once, writes the cache.
    const first = await resolvePersonalizedMessage(d, { workspaceId, campaignId, nodeId, config: { messageBody: AI_BODY }, lead });
    assert.equal(first.cached, false);
    assert.equal(counter.text, 1);

    // DISPATCH (same resolution path): reuses the cache, no second generate.
    const second = await resolvePersonalizedMessage(d, { workspaceId, campaignId, nodeId, config: { messageBody: AI_BODY }, lead });
    assert.equal(second.cached, true, "cache hit");
    assert.equal(second.text, first.text, "same resolved text");
    assert.equal(counter.text, 1, "NO second LLM call at dispatch");

    // The cache row carries the metered token count.
    const row = await db.selectFrom("preview_cache").select(["resolved_text", "tokens"]).where("node_id", "=", nodeId).where("contact_id", "=", leadId).executeTakeFirstOrThrow();
    assert.equal(row.resolved_text, first.text);
    // The AI generation metered into budget_ledger.
    const usage = await db.selectFrom("llm_usage").select("kind").where("conversation_id", "is", null).where("lead_id", "=", leadId).executeTakeFirstOrThrow();
    assert.equal(usage.kind, "personalization");
  } finally {
    await w.cleanup();
  }
});

test("editing a prompt invalidates the cache (new version → fresh generation)", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const counter = { text: 0 };
    const campaignId = await seedCampaign(db, workspaceId);
    const nodeId = await seedNode(db, workspaceId, campaignId, AI_BODY);
    const leadId = await seedLead(db, workspaceId, { firstName: "Dana", company: "Acme" });
    const lead = await db.selectFrom("leads").select(["id", "workspace_id", "linkedin_url", "email", "enrichment", "tags", "custom_columns", "connection_degree"]).where("id", "=", leadId).executeTakeFirstOrThrow();

    const d = deps(db, { textAdapter: varyingText(counter) });
    const v1 = await resolvePersonalizedMessage(d, { workspaceId, campaignId, nodeId, config: { messageBody: AI_BODY }, lead });
    assert.equal(counter.text, 1);

    // Edit the prompt → a new prompt_version → the old cache row is not read.
    const edited: MessageBody = { v: 1, segments: [{ type: "ai", prompt: "Write a WARMER, different opener." }] };
    const v2 = await resolvePersonalizedMessage(d, { workspaceId, campaignId, nodeId, config: { messageBody: edited }, lead });
    assert.notEqual(v2.promptVersion, v1.promptVersion, "prompt version changed");
    assert.equal(v2.cached, false, "cache invalidated by the edit");
    assert.equal(counter.text, 2, "a fresh generation ran for the new prompt");
  } finally {
    await w.cleanup();
  }
});

test("prompt templates save/load by scope and run_count increments on use", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId, userId } = w;
    const mine = await saveTemplate(db, { workspaceId, userId, name: "My opener", body: "Write a hook about {{Company name}}", variables: ["companyName"], scope: "private" });
    assert.equal(mine.runCount, 0);
    await saveTemplate(db, { workspaceId, userId, name: "Shared FAQ", body: "Answer about {{Headline}}", scope: "community" });

    const privateList = await listTemplates(db, { workspaceId, scope: "private" });
    assert.ok(privateList.some((t) => t.id === mine.id), "loads by private scope");
    assert.ok(!privateList.some((t) => t.name === "Shared FAQ"), "community template not in private scope");

    const communityList = await listTemplates(db, { workspaceId, scope: "community" });
    assert.ok(communityList.some((t) => t.name === "Shared FAQ"), "loads by community scope");

    const used = await useTemplate(db, { workspaceId, id: mine.id });
    assert.equal(used.runCount, 1, "run_count increments on use");
    const reload = await listTemplates(db, { workspaceId, scope: "private" });
    assert.equal(reload.find((t) => t.id === mine.id)?.runCount, 1);
  } finally {
    await w.cleanup();
  }
});
