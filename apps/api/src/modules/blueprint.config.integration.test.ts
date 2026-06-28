// Test gate for BATCH 2 — full prompt-to-campaign blueprint in the UI.
//
// Proves:
//   1. CLARIFY    — a thin intake yields clarifying questions; a rich one doesn't.
//   2. COMPLETE   — the blueprint is a FULL campaign (graph + objective + success
//      criteria + ICP + guardrails + voice + autonomy + cadence + KB seed + the
//      required inputs the user must supply) — not just a node graph.
//   3. APPLY      — applying the blueprint via the REAL services populates BOTH the
//      sequence graph AND the Context tab (brain): objective/guardrails/voice/
//      autonomy persist and round-trip.
//   4. GATE       — launchReadiness blocks launch until grounding is supplied, and
//      flips to ready once an account + contacts + KB facts exist.
//
// Generation is tested at the deterministic core layer (no LLM call — mock-safe);
// the API `generate(full)` is a thin wrapper over these same functions.
//
// Run: pnpm --filter @10xconnect/api test:integration

import "reflect-metadata";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  clarifyingQuestions,
  computeRequiredInputs,
  deterministicBlueprint,
  EMBEDDING_DIM,
  type EmbeddingAdapter,
  type GenerateIntake,
  type GenNode,
  hashingEmbedding,
  launchReadiness,
} from "@10xconnect/core";
import { createDb, createServiceClient, type DB } from "@10xconnect/db";
import { type EngineDeps, ingestText } from "@10xconnect/engine";
import type { Kysely } from "kysely";

import { BrainService } from "./brain.module";
import { CampaignRunService } from "./campaigns/campaign-run.service";
import { CampaignsService } from "./campaigns/campaigns.service";
import type { SaveSequenceDto } from "./campaigns/dto";

const RICH: GenerateIntake = {
  offer: "fractional RevOps for seed-stage SaaS",
  audience: "seed-stage B2B SaaS founders",
  goal: "book intro calls",
  tone: "balanced",
};
const THIN: GenerateIntake = { offer: "stuff", audience: "x", goal: "y", tone: "balanced" };

const fakeAdapter = {} as never;
const mockEmbedder: EmbeddingAdapter = {
  dimension: EMBEDDING_DIM,
  embed: async (t: string) => hashingEmbedding(t),
};

function engineDeps(db: Kysely<DB>): EngineDeps {
  // saveSequence/getSequence only touch this.db + this.campaigns — the rest is unused here.
  return {
    db,
    adapter: {} as never,
    config: { minSpacingMs: 1000, jitterMs: 0, ignoreWorkingHours: true, batchSize: 50 },
  } as unknown as EngineDeps;
}

/** A GenNode[] → save-sequence payload (linear chain with ids + edges), like the builder. */
function toSequenceNodes(graph: GenNode[]): SaveSequenceDto["nodes"] {
  return graph.map((n, i) => {
    const nextId = i < graph.length - 1 ? `n${i + 1}` : null;
    return {
      id: `n${i}`,
      kind: n.kind,
      type: n.type,
      config: n.config,
      next: n.kind === "action" ? nextId : null,
      true: n.kind === "condition" ? nextId : null,
      false: null,
      delayDays: n.type === "wait_x_days" ? Number((n.config as { days?: number }).days) || 1 : null,
    };
  });
}

async function withWorkspace(
  body: (ctx: { db: Kysely<DB>; workspaceId: string }) => Promise<void>,
): Promise<void> {
  const admin = createServiceClient();
  const db = createDb();
  const suffix = randomUUID();
  const created = await admin.auth.admin.createUser({
    email: `blueprint-${suffix}@10xconnect.test`,
    password: `Pw-${suffix}!`,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    await db.destroy();
    throw created.error ?? new Error("failed to create seed user");
  }
  const userId = created.data.user.id;
  try {
    const ws = await db
      .insertInto("workspaces")
      .values({ name: `Blueprint ${suffix}`, owner_id: userId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db.insertInto("memberships").values({ workspace_id: ws.id, user_id: userId, role: "owner" }).execute();
    await body({ db, workspaceId: ws.id });
  } finally {
    await admin.auth.admin.deleteUser(userId);
    await db.destroy();
  }
}

async function seedAccount(db: Kysely<DB>, workspaceId: string): Promise<string> {
  const row = await db
    .insertInto("sending_accounts")
    .values({
      workspace_id: workspaceId,
      type: "linkedin",
      connection_method: "extension",
      name: "Test",
      provider_account_id: `prov-${randomUUID()}`,
      proxy_type: "bundled",
      country: "US",
      location: "US",
      status: "active",
      health_score: 100,
      warmup_state: JSON.stringify({ phase: "active", startedAt: "2020-01-01T00:00:00.000Z" }),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function seedDraftCampaign(db: Kysely<DB>, workspaceId: string, accountId: string): Promise<string> {
  const row = await db
    .insertInto("campaigns")
    .values({ workspace_id: workspaceId, name: "Blueprint", status: "draft", account_id: accountId })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// --- 1. CLARIFY -------------------------------------------------------------

test("clarifying questions: a thin intake asks, a rich one generates straight away", () => {
  assert.ok(clarifyingQuestions(THIN).length >= 1, "thin intake → clarifying questions");
  assert.equal(clarifyingQuestions(RICH).length, 0, "rich intake → no questions");
});

// --- 2. COMPLETE ------------------------------------------------------------

test("blueprint is a FULL campaign (graph + objective + guardrails + voice + autonomy + cadence + KB seed)", () => {
  const bp = deterministicBlueprint(RICH);
  assert.ok(bp.objective.goal && bp.objective.success_criteria, "objective goal + success criteria");
  assert.ok(bp.objective.icp && bp.objective.cta, "objective ICP + CTA");
  assert.ok(bp.guardrails.escalate_on.length > 0, "guardrails escalate_on seeded");
  assert.ok(bp.voice.tone.length > 0, "voice tone");
  assert.ok(["approve_all", "auto_easy_escalate_hard", "full_auto"].includes(bp.autonomy.mode), "autonomy mode");
  assert.equal(typeof (bp.cadence.caps as Record<string, number>).connection_request, "number", "cadence caps");
  assert.ok(bp.graph.length >= 2, "a real multi-step graph");
  assert.ok(bp.knowledgeSeed.sections.length > 0, "KB seed sections");
  const keys = bp.requiredInputs.map((r) => r.key);
  assert.ok(keys.includes("sender_account") && keys.includes("contacts"), "required inputs include account + contacts");
});

// --- 3 (pure). GATE LOGIC ---------------------------------------------------

test("launchReadiness blocks until every required input is provided", () => {
  const req = deterministicBlueprint(RICH).requiredInputs;
  assert.equal(launchReadiness(req, {}).ready, false, "nothing provided → blocked");

  const kbRequired = req.some((r) => r.key === "knowledge_base" && r.required);
  const partial = launchReadiness(req, { sender_account: true, contacts: true });
  assert.equal(partial.ready, !kbRequired, "account+contacts only → ready iff KB not required");

  const all = launchReadiness(req, {
    sender_account: true,
    contacts: true,
    knowledge_base: true,
    voice_profile: true,
  });
  assert.equal(all.ready, true, "everything provided → ready");
});

// --- 3 (DB). APPLY POPULATES GRAPH + CONTEXT TAB ----------------------------

test("applying a blueprint populates BOTH the graph and the Context tab (brain) via the real services", async () => {
  await withWorkspace(async ({ db, workspaceId }) => {
    const accountId = await seedAccount(db, workspaceId);
    const campaignId = await seedDraftCampaign(db, workspaceId, accountId);
    const bp = deterministicBlueprint(RICH);

    const brain = new BrainService(db, fakeAdapter);
    const campaigns = new CampaignsService(db);
    const runService = new CampaignRunService(db, engineDeps(db), campaigns);

    // Apply exactly as the Build-with-AI flow does (brain → caps → graph). The KB
    // is NOT auto-created — the user supplies the real facts before launch.
    await brain.setBrain(workspaceId, campaignId, {
      objective: {
        goal: bp.objective.goal,
        offer: RICH.offer,
        success_criteria: bp.objective.success_criteria,
        icp: bp.objective.icp,
        cta: bp.objective.cta,
      },
      guardrails: bp.guardrails,
      voice: { tone: bp.voice.tone },
      autonomy: bp.autonomy,
    });
    const freq = await campaigns.saveFrequency(workspaceId, campaignId, {
      caps: bp.cadence.caps as Record<string, number>,
    });
    await runService.saveSequence(workspaceId, campaignId, { nodes: toSequenceNodes(bp.graph) });

    // Context tab is populated (getBrain is exactly what the Context tab reads):
    const got = await brain.getBrain(workspaceId, campaignId);
    assert.equal((got.objective as { goal?: string }).goal, bp.objective.goal, "objective persisted");
    assert.equal((got.objective as { offer?: string }).offer, RICH.offer, "offer persisted from intake");
    assert.ok(((got.guardrails as { escalate_on?: string[] }).escalate_on ?? []).length > 0, "guardrails persisted");
    assert.equal((got.voice as { tone?: string }).tone, bp.voice.tone, "voice persisted");
    assert.equal((got.autonomy as { mode?: string }).mode, bp.autonomy.mode, "autonomy persisted");
    // Cadence caps persisted (the saveFrequency/clampCaps key-shape contract holds):
    assert.ok(typeof freq.caps.connection_request === "number" && freq.caps.connection_request > 0, "cadence caps persisted");

    // Graph is populated:
    const seq = await runService.getSequence(workspaceId, campaignId);
    assert.equal(seq.nodes.length, bp.graph.length, "every blueprint step persisted to the sequence");
  });
});

// --- 4 (DB). LAUNCH GATED ON REAL STATE -------------------------------------

test("launch is blocked until grounding is supplied, then flips to ready", async () => {
  await withWorkspace(async ({ db, workspaceId }) => {
    const accountId = await seedAccount(db, workspaceId);
    const campaignId = await seedDraftCampaign(db, workspaceId, accountId);
    const bp = deterministicBlueprint(RICH);
    // Focus this gate on the GROUNDING path (account + contacts + KB facts); drop
    // voice nodes so the orthogonal voice-profile input isn't also required here.
    const graph = bp.graph.filter((n) => n.type !== "send_voice_note");

    const brain = new BrainService(db, fakeAdapter);
    const campaigns = new CampaignsService(db);
    const runService = new CampaignRunService(db, engineDeps(db), campaigns);

    const kb = await brain.createKb(workspaceId, { name: bp.knowledgeSeed.name });
    await brain.setBrain(workspaceId, campaignId, { objective: { goal: bp.objective.goal }, knowledgeBaseId: kb.id });
    await runService.saveSequence(workspaceId, campaignId, { nodes: toSequenceNodes(graph) });
    const req = computeRequiredInputs(graph);

    // Compute `provided` from the LIVE campaign state, like campaign-detail does.
    const providedNow = async () => {
      const c = await db
        .selectFrom("campaigns")
        .select("account_id")
        .where("id", "=", campaignId)
        .executeTakeFirstOrThrow();
      const leads = await db
        .selectFrom("lead_campaign_state")
        .select((eb) => eb.fn.countAll<number>().as("c"))
        .where("campaign_id", "=", campaignId)
        .executeTakeFirstOrThrow();
      const chunks = await db
        .selectFrom("kb_chunks")
        .select((eb) => eb.fn.countAll<number>().as("c"))
        .where("knowledge_base_id", "=", kb.id)
        .executeTakeFirstOrThrow();
      return {
        sender_account: c.account_id != null,
        contacts: Number(leads.c) > 0,
        knowledge_base: Number(chunks.c) > 0,
        voice_profile: false,
      };
    };

    // Account is bound, but there are no contacts and the KB has no facts → blocked.
    assert.equal(launchReadiness(req, await providedNow()).ready, false, "blocked before grounding");

    // Supply the grounding the blueprint can't invent: real KB facts + contacts.
    await ingestText(db, mockEmbedder, {
      workspaceId,
      knowledgeBaseId: kb.id,
      text: "Pricing. Our Pro plan is $99/month and includes the AI assistant.",
      source: "doc",
    });
    const leadId = (
      await db
        .insertInto("leads")
        .values({
          workspace_id: workspaceId,
          linkedin_url: `https://linkedin.com/in/lead-${randomUUID()}`,
          enrichment: JSON.stringify({ firstName: "Jordan" }),
          tags: [],
          connection_degree: 1,
          enrich_status: "enriched",
        })
        .returning("id")
        .executeTakeFirstOrThrow()
    ).id;
    await db
      .insertInto("lead_campaign_state")
      .values({ workspace_id: workspaceId, campaign_id: campaignId, lead_id: leadId, status: "active", history: JSON.stringify([]) })
      .execute();

    assert.equal(launchReadiness(req, await providedNow()).ready, true, "ready once grounding is supplied");
  });
});
