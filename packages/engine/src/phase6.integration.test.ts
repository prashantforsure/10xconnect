// Phase 6 Test Gate (DB-backed) — Workflow templates + prompt-to-campaign blueprint.
//
// Proves: saving a workflow template STRIPS all lead/account/resolved data; applying
// it CLONES a fresh DRAFT campaign with 0 contacts and surfaces required_inputs;
// editing the original template does NOT mutate campaigns already cloned from it
// (frozen copy); the generator emits a SCHEMA-VALID full campaign (graph + brain +
// KB seed) and repairs invalid model output; and the clarifying flow collects
// grounding before a campaign can launch.
//
// Run: pnpm --filter @10xconnect/engine test:integration

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  ALLOWED_ACTION_TYPES,
  ALLOWED_CONDITION_TYPES,
  type ChannelAdapter,
  clarifyingQuestions,
  computeRequiredInputs,
  deterministicBlueprint,
  type GenerateIntake,
  launchReadiness,
  type MessageBody,
  parseBlueprint,
} from "@10xconnect/core";

import { startCampaign } from "./campaign-runner";
import { seedWorkspace } from "./testing/seed-workspace";
import type { EngineDeps } from "./types";
import {
  applyWorkflowTemplate,
  getWorkflowTemplate,
  saveWorkflowTemplate,
  updateWorkflowTemplate,
} from "./workflow-templates";

type Db = EngineDeps["db"];

function engineDeps(db: Db): EngineDeps {
  return {
    db,
    adapter: {} as ChannelAdapter,
    config: { minSpacingMs: 1000, jitterMs: 0, ignoreWorkingHours: true, batchSize: 50 },
    now: () => new Date("2026-06-28T12:00:00.000Z"),
    modelLabel: "mock",
  };
}

const WARMED = JSON.stringify({ phase: "active", startedAt: "2020-01-01T00:00:00.000Z" });

const AI_BODY: MessageBody = {
  v: 1,
  segments: [
    { type: "text", text: "Hi " },
    { type: "variable", key: "first_name", fallback: "there" },
    { type: "text", text: ", " },
    { type: "ai", prompt: "Write a short, specific opener about their work." },
  ],
};

const intake: GenerateIntake = {
  offer: "fractional RevOps for seed-stage teams",
  audience: "seed-stage SaaS founders",
  goal: "book intro calls",
  tone: "balanced",
};

async function seedAccount(db: Db, workspaceId: string): Promise<string> {
  const a = await db
    .insertInto("sending_accounts")
    .values({
      workspace_id: workspaceId,
      type: "linkedin",
      connection_method: "extension",
      name: "Test LinkedIn",
      provider_account_id: `prov-${randomUUID()}`,
      proxy_type: "bundled",
      country: "US",
      location: "US",
      status: "active",
      health_score: 100,
      warmup_state: WARMED,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return a.id;
}

async function seedCampaign(db: Db, workspaceId: string, accountId: string | null): Promise<string> {
  const c = await db
    .insertInto("campaigns")
    .values({
      workspace_id: workspaceId,
      name: "Source Campaign",
      status: "draft",
      account_id: accountId,
      objective: JSON.stringify({ goal: "book calls", icp: "founders", success_criteria: "a booked call", cta: "quick call" }),
      guardrails: JSON.stringify({ never_discuss: [], escalate_on: ["pricing"] }),
      autonomy: JSON.stringify({ mode: "auto_easy_escalate_hard", confidence_threshold: 0.7 }),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return c.id;
}

/** Insert a sequence node; returns its uuid. */
async function seedNode(
  db: Db,
  workspaceId: string,
  campaignId: string,
  node: { kind: "action" | "condition"; type: string; config?: Record<string, unknown> },
): Promise<string> {
  const n = await db
    .insertInto("sequence_nodes")
    .values({
      workspace_id: workspaceId,
      campaign_id: campaignId,
      kind: node.kind,
      type: node.type,
      config: JSON.stringify(node.config ?? {}),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return n.id;
}

test("saving a workflow template STRIPS leads / accounts / resolved data", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId, userId } = w;
    const accountId = await seedAccount(db, workspaceId);
    const campaignId = await seedCampaign(db, workspaceId, accountId);

    const audioPath = `${workspaceId}/${campaignId}/${randomUUID()}-voice.webm`;

    // A text-bearing node carrying account refs (incl. CAPITALIZED + alias variants),
    // media (attachments), a RESOLVED per-contact message, and account/resolved data
    // NESTED inside a kept object — none of which may travel with the template.
    await seedNode(db, workspaceId, campaignId, {
      kind: "action",
      type: "send_message",
      config: {
        messageBody: AI_BODY,
        body: "Hi {first_name}",
        aiPrompt: "Write a short, specific opener about their work.",
        senders: [accountId], // ACCOUNT ref — strip
        AccountId: accountId, // capitalized variant — strip (case-insensitive)
        sendingAccountId: accountId, // alias — strip
        attachments: [{ kind: "image", ref: `${workspaceId}/${campaignId}/x.png` }], // media — strip
        resolvedText: "Hi Dana, saw your launch — congrats!", // RESOLVED per-contact — strip
        // structure kept, but its NESTED account/resolved fields must be stripped:
        sendCondition: { type: "never_messaged", from: accountId, resolved: "Hi Dana, congrats!" },
      },
    });
    // A RECORDED voice note: audioRef is a workspace-private storage path — strip it.
    await seedNode(db, workspaceId, campaignId, {
      kind: "action",
      type: "send_voice_note",
      config: { voiceMode: "recorded", durationMs: 20_000, audioRef: audioPath },
    });

    const t = await saveWorkflowTemplate(db, { workspaceId, userId, campaignId, name: "My Workflow", scope: "private" });
    assert.ok(t, "template saved");

    const node = t!.graph[0];
    assert.equal(node.config.senders, undefined, "account senders stripped");
    assert.equal(node.config.AccountId, undefined, "capitalized account key stripped (case-insensitive)");
    assert.equal(node.config.sendingAccountId, undefined, "account alias key stripped");
    assert.equal(node.config.attachments, undefined, "media attachments stripped");
    assert.equal(node.config.resolvedText, undefined, "resolved per-contact text stripped");
    assert.ok(node.config.messageBody, "message SKELETON preserved");
    // sendCondition kept, but its nested account + resolved fields are gone.
    assert.deepEqual(node.config.sendCondition, { type: "never_messaged" }, "nested account/resolved stripped, structure kept");

    const voiceNode = t!.graph[1];
    assert.equal(voiceNode.config.audioRef, undefined, "recorded voice-note storage path stripped");
    assert.equal(voiceNode.config.voiceMode, "recorded", "voice-note structure preserved");

    // The account id AND the private audio path must appear NOWHERE in the template,
    // and brain defaults must not carry the knowledge_base_id / account binding.
    const serialized = JSON.stringify(t);
    assert.equal(serialized.includes(accountId), false, "no account id leaked into the template");
    assert.equal(serialized.includes(audioPath), false, "no private audio path leaked into the template");
    assert.equal(serialized.includes("congrats"), false, "no resolved per-contact text leaked into the template");
    assert.equal("knowledge_base_id" in t!.brainDefaults, false, "no KB id in brain defaults");
    assert.ok(t!.brainDefaults.objective, "brain objective travels with the template");
    assert.ok(t!.cadence.caps && t!.cadence.schedule, "cadence (caps + schedule) travels with the template");
  } finally {
    await w.cleanup();
  }
});

test("applying a template CLONES a fresh draft with 0 contacts and surfaces required_inputs", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId, userId } = w;
    const accountId = await seedAccount(db, workspaceId);
    const campaignId = await seedCampaign(db, workspaceId, accountId);

    // A small branching workflow: connection → invite_accepted? → message (AI) / voice note.
    const connId = await seedNode(db, workspaceId, campaignId, { kind: "action", type: "send_connection_request" });
    const condId = await seedNode(db, workspaceId, campaignId, { kind: "condition", type: "invite_accepted" });
    const msgId = await seedNode(db, workspaceId, campaignId, {
      kind: "action",
      type: "send_message",
      config: { messageBody: AI_BODY, senders: [accountId] },
    });
    const voiceId = await seedNode(db, workspaceId, campaignId, {
      kind: "action",
      type: "send_voice_note",
      config: { voiceMode: "ai_clone", durationMs: 20_000 },
    });
    // Wire: conn.next → cond ; cond.true → msg ; msg.next → voice.
    await db.updateTable("sequence_nodes").set({ next_node_id: condId }).where("id", "=", connId).execute();
    await db.updateTable("sequence_nodes").set({ true_node_id: msgId }).where("id", "=", condId).execute();
    await db.updateTable("sequence_nodes").set({ next_node_id: voiceId }).where("id", "=", msgId).execute();

    const t = await saveWorkflowTemplate(db, { workspaceId, userId, campaignId, name: "Branching", scope: "workspace" });
    const applied = await applyWorkflowTemplate(db, { workspaceId, templateId: t!.id, name: "Cloned Campaign" });
    assert.ok(applied, "applied");

    // Fresh campaign: draft, NO account binding, NO knowledge base, 0 contacts.
    const camp = await db
      .selectFrom("campaigns")
      .select(["id", "name", "status", "account_id", "knowledge_base_id"])
      .where("id", "=", applied!.campaignId)
      .executeTakeFirstOrThrow();
    assert.equal(camp.status, "draft");
    assert.equal(camp.account_id, null, "no sender account — the user supplies it");
    assert.equal(camp.knowledge_base_id, null, "no knowledge base — the user supplies it");
    assert.notEqual(camp.id, campaignId, "a brand-new campaign");

    const contacts = await db
      .selectFrom("lead_campaign_state")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("campaign_id", "=", applied!.campaignId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(contacts.c), 0, "0 contacts enrolled");

    // Graph cloned with edges intact (4 nodes, the condition forks to the message).
    const nodes = await db
      .selectFrom("sequence_nodes")
      .select(["id", "type", "kind", "next_node_id", "true_node_id"])
      .where("campaign_id", "=", applied!.campaignId)
      .execute();
    assert.equal(nodes.length, 4, "all nodes cloned");
    const cond = nodes.find((n) => n.type === "invite_accepted");
    const msg = nodes.find((n) => n.type === "send_message");
    assert.ok(cond && msg && cond.true_node_id === msg.id, "condition true-branch edge preserved");
    // Cloned node ids are fresh (none equal the source node ids).
    const sourceIds = new Set([connId, condId, msgId, voiceId]);
    assert.ok(nodes.every((n) => !sourceIds.has(n.id)), "clone uses fresh node ids");

    // required_inputs surfaced: sender + contacts always; grounding (AI) + voice required.
    const req = applied!.requiredInputs;
    assert.equal(req.find((r) => r.key === "sender_account")?.required, true);
    assert.equal(req.find((r) => r.key === "contacts")?.required, true);
    assert.equal(req.find((r) => r.key === "knowledge_base")?.required, true, "AI sequence needs grounding");
    assert.equal(req.find((r) => r.key === "voice_profile")?.required, true, "voice note needs a voice profile");
  } finally {
    await w.cleanup();
  }
});

test("editing the original template does NOT change campaigns already cloned from it", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId, userId } = w;
    const campaignId = await seedCampaign(db, workspaceId, null);
    await seedNode(db, workspaceId, campaignId, { kind: "action", type: "like_last_post" });
    await seedNode(db, workspaceId, campaignId, { kind: "action", type: "send_connection_request" });

    const t = await saveWorkflowTemplate(db, { workspaceId, userId, campaignId, name: "Frozen", scope: "private" });
    const applied = await applyWorkflowTemplate(db, { workspaceId, templateId: t!.id });

    const before = await db
      .selectFrom("sequence_nodes")
      .select(["type"])
      .where("campaign_id", "=", applied!.campaignId)
      .orderBy("created_at", "asc")
      .execute();
    assert.deepEqual(before.map((n) => n.type), ["like_last_post", "send_connection_request"]);

    // Edit the ORIGINAL template (replace its graph + bump version).
    const updated = await updateWorkflowTemplate(db, {
      workspaceId,
      id: t!.id,
      graph: [{ key: "t0", kind: "action", type: "inmail", config: {}, next: null, true: null, false: null, delayDays: null }],
    });
    assert.equal(updated!.templateVersion, 2, "template_version bumped on a structural edit");

    // The cloned campaign is UNCHANGED (frozen copy, no auto-propagation).
    const after = await db
      .selectFrom("sequence_nodes")
      .select(["type"])
      .where("campaign_id", "=", applied!.campaignId)
      .orderBy("created_at", "asc")
      .execute();
    assert.deepEqual(after.map((n) => n.type), ["like_last_post", "send_connection_request"], "clone untouched by template edit");

    // And the template itself did change (so we know the edit really applied).
    const reloaded = await getWorkflowTemplate(db, { workspaceId, id: t!.id });
    assert.deepEqual(reloaded!.graph.map((n) => n.type), ["inmail"]);
  } finally {
    await w.cleanup();
  }
});

test("generate emits a SCHEMA-VALID full campaign (graph + brain + KB seed) and repairs invalid output", () => {
  // Pure check (no DB), included in the gate for completeness.
  const b = deterministicBlueprint(intake);
  const valid = (g: typeof b.graph) =>
    g.length >= 2 &&
    g.every((n) => (n.kind === "condition" ? ALLOWED_CONDITION_TYPES.has(n.type) : ALLOWED_ACTION_TYPES.has(n.type)));
  assert.ok(valid(b.graph), "deterministic graph is valid");
  assert.ok(b.objective.goal && b.knowledgeSeed.sections.length >= 3, "objective + KB seed present");
  assert.ok(["approve_all", "auto_easy_escalate_hard", "full_auto"].includes(b.autonomy.mode));

  // Invalid model output (bad node type, bad autonomy, KB facts) → repaired.
  const repaired = parseBlueprint(
    JSON.stringify({
      autonomy: { mode: "nope", confidence_threshold: 9 },
      graph: [
        { kind: "action", type: "send_sms", config: {} },
        { kind: "action", type: "send_connection_request", config: { note: "x" } },
        { kind: "action", type: "send_message", config: { body: "Hi {first_name}", aiPrompt: "y" } },
      ],
      knowledgeSeed: { sections: [{ title: "Pricing", prompt: "tiers", content: "Pro $99" }] },
    }),
    intake,
  );
  assert.ok(valid(repaired.graph) && !repaired.graph.some((n) => n.type === "send_sms"), "unknown node dropped");
  assert.ok(["approve_all", "auto_easy_escalate_hard", "full_auto"].includes(repaired.autonomy.mode));
  const pricing = repaired.knowledgeSeed.sections.find((s) => s.title === "Pricing");
  assert.deepEqual(Object.keys(pricing!).sort(), ["prompt", "title"], "no KB facts leaked");
});

test("the clarifying flow collects grounding before allowing launch", () => {
  // Under-specified intake → 1–2 questions before generating.
  assert.ok(clarifyingQuestions({ offer: "x", audience: "y", goal: "z", tone: "gentle" }).length >= 1);
  assert.deepEqual(clarifyingQuestions(intake), [], "a specific intake needs no clarification");

  // Grounding gate: a generated campaign can't launch until the user supplies it.
  const required = computeRequiredInputs(deterministicBlueprint(intake).graph);
  assert.equal(launchReadiness(required, { sender_account: true, contacts: true }).ready, false, "blocked without grounding");
  const all = Object.fromEntries(required.map((r) => [r.key, true]));
  assert.equal(launchReadiness(required, all).ready, true, "ready once grounding + inputs supplied");
});

test("an auto-replying campaign is BLOCKED from launching without a knowledge base", async () => {
  const w = await seedWorkspace();
  try {
    const { db, workspaceId } = w;
    const accountId = await seedAccount(db, workspaceId);
    // Campaign with an account, a step, autonomy=auto_easy_escalate_hard, NO knowledge base.
    const campaignId = await seedCampaign(db, workspaceId, accountId);
    await seedNode(db, workspaceId, campaignId, { kind: "action", type: "send_message", config: { messageBody: AI_BODY } });
    const deps = engineDeps(db);

    // Start must REFUSE — an autonomous-reply campaign with no grounding could
    // answer factual questions ungrounded.
    await assert.rejects(
      () => startCampaign(deps, workspaceId, campaignId),
      /knowledge base/i,
      "blocked: auto-replying campaign with no knowledge base",
    );

    // Supply grounding → the same campaign now launches (0 leads → scheduled 0).
    const kb = await db
      .insertInto("knowledge_bases")
      .values({ workspace_id: workspaceId, name: "Grounding" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db.updateTable("campaigns").set({ knowledge_base_id: kb.id }).where("id", "=", campaignId).execute();

    const res = await startCampaign(deps, workspaceId, campaignId);
    assert.equal(res.scheduled, 0, "launches once grounding is supplied");
  } finally {
    await w.cleanup();
  }
});
