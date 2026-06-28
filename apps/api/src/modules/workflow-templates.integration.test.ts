// Test gate for BATCH 3 — workflow templates UI (backend wiring).
//
// Drives the REAL WorkflowTemplatesService against the dev Postgres and proves the
// three invariants the UI depends on:
//   1. STRIP   — saving a campaign as a template keeps the SHAPE only; it never
//      stores leads, the sending account, the knowledge base, or resolved/
//      per-contact message data.
//   2. APPLY   — applying clones a FRESH DRAFT campaign with 0 contacts (no account,
//      no KB) and surfaces the required_inputs the user must supply.
//   3. FROZEN  — editing the original template does NOT change an already-applied
//      (running) campaign.
//
// Run: pnpm --filter @10xconnect/api test:integration

import "reflect-metadata";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { createDb, createServiceClient, type DB } from "@10xconnect/db";
import type { Kysely } from "kysely";

import { WorkflowTemplatesService } from "./workflow-templates.module";

async function withWorkspace(
  body: (ctx: { db: Kysely<DB>; workspaceId: string; userId: string }) => Promise<void>,
): Promise<void> {
  const admin = createServiceClient();
  const db = createDb();
  const suffix = randomUUID();
  const created = await admin.auth.admin.createUser({
    email: `wf-tmpl-${suffix}@10xconnect.test`,
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
      .values({ name: `WF Tmpl ${suffix}`, owner_id: userId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db.insertInto("memberships").values({ workspace_id: ws.id, user_id: userId, role: "owner" }).execute();
    await body({ db, workspaceId: ws.id, userId });
  } finally {
    await admin.auth.admin.deleteUser(userId);
    await db.destroy();
  }
}

test("workflow templates: save strips sensitive data, apply clones a fresh 0-contact draft, edits don't touch clones", async () => {
  await withWorkspace(async ({ db, workspaceId, userId }) => {
    // --- Seed a fully-loaded source campaign (account + KB + contacts + graph) ---
    const account = await db
      .insertInto("sending_accounts")
      .values({
        workspace_id: workspaceId,
        type: "linkedin",
        connection_method: "extension",
        name: "Sender",
        provider_account_id: `prov-secret-${randomUUID()}`,
        proxy_type: "bundled",
        country: "US",
        location: "US",
        status: "active",
        health_score: 100,
        warmup_state: JSON.stringify({ phase: "active", startedAt: "2020-01-01T00:00:00.000Z" }),
      })
      .returning(["id", "provider_account_id"])
      .executeTakeFirstOrThrow();
    const kb = await db
      .insertInto("knowledge_bases")
      .values({ workspace_id: workspaceId, name: "Secret KB" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const campaign = await db
      .insertInto("campaigns")
      .values({
        workspace_id: workspaceId,
        name: "Source campaign",
        status: "draft",
        account_id: account.id,
        knowledge_base_id: kb.id,
        objective: JSON.stringify({ goal: "book a demo" }),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const lead = await db
      .insertInto("leads")
      .values({
        workspace_id: workspaceId,
        linkedin_url: `https://linkedin.com/in/secret-lead-${randomUUID()}`,
        enrichment: JSON.stringify({ firstName: "Jordan" }),
        tags: [],
        connection_degree: 1,
        enrich_status: "enriched",
      })
      .returning(["id", "linkedin_url"])
      .executeTakeFirstOrThrow();
    await db
      .insertInto("lead_campaign_state")
      .values({ workspace_id: workspaceId, campaign_id: campaign.id, lead_id: lead.id, status: "active", history: JSON.stringify([]) })
      .execute();
    const waitNode = await db
      .insertInto("sequence_nodes")
      .values({
        workspace_id: workspaceId,
        campaign_id: campaign.id,
        kind: "action",
        type: "wait_x_days",
        config: JSON.stringify({ days: 3 }),
        delay_days: 3,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .insertInto("sequence_nodes")
      .values({
        workspace_id: workspaceId,
        campaign_id: campaign.id,
        kind: "action",
        type: "send_message",
        // Sensitive per-contact / account / media keys that MUST be stripped:
        config: JSON.stringify({
          body: "Hi {first_name}",
          senders: [account.id],
          audioRef: "audio-secret-123",
          resolved: { perContact: "cached preview text" },
        }),
        next_node_id: waitNode.id,
      })
      .execute();

    const svc = new WorkflowTemplatesService(db);

    // --- 1. STRIP -----------------------------------------------------------
    const tmpl = await svc.save(workspaceId, userId, {
      campaignId: campaign.id,
      name: "My Reusable Template",
      scope: "private",
    });
    assert.equal(tmpl.graph.length, 2, "graph shape captured");
    const serialized = JSON.stringify(tmpl).toLowerCase();
    const leadUrl = (lead.linkedin_url ?? "").toLowerCase();
    assert.ok(leadUrl, "seed lead identifier present");
    assert.ok(!serialized.includes("senders"), "sender bindings stripped");
    assert.ok(!serialized.includes("audioref"), "voice/media refs stripped");
    assert.ok(!serialized.includes("resolved"), "resolved per-contact cache stripped");
    assert.ok(!serialized.includes(leadUrl), "no leads in the template");
    // account.id was embedded in the send_message `senders` config — stripping must drop it.
    assert.ok(!serialized.includes(account.id.toLowerCase()), "no account binding in the template");
    assert.ok(!serialized.includes(kb.id.toLowerCase()), "no knowledge base in the template");
    const msgSkeleton = tmpl.graph.find((n) => n.type === "send_message");
    assert.ok(msgSkeleton && (msgSkeleton.config as { body?: string }).body, "message SKELETON kept");
    const savedReq = tmpl.requiredInputs.filter((r) => r.required).map((r) => r.key);
    assert.ok(
      savedReq.includes("sender_account") && savedReq.includes("contacts"),
      "save surfaces required account + contacts",
    );

    // --- 2. APPLY -----------------------------------------------------------
    const applied = await svc.apply(workspaceId, tmpl.id, {});
    assert.ok(applied.campaignId, "a new campaign was created");
    assert.notEqual(applied.campaignId, campaign.id, "it is a NEW campaign, not the source");
    const appliedReq = applied.requiredInputs.filter((r) => r.required).map((r) => r.key);
    assert.ok(
      appliedReq.includes("sender_account") && appliedReq.includes("contacts"),
      "apply surfaces required account + contacts",
    );
    const clone = await db
      .selectFrom("campaigns")
      .select(["status", "account_id", "knowledge_base_id"])
      .where("id", "=", applied.campaignId)
      .executeTakeFirstOrThrow();
    assert.equal(clone.status, "draft", "fresh DRAFT");
    assert.equal(clone.account_id, null, "no account bound on the clone");
    assert.equal(clone.knowledge_base_id, null, "no KB linked on the clone");
    const contacts = await db
      .selectFrom("lead_campaign_state")
      .select((eb) => eb.fn.countAll<number>().as("c"))
      .where("campaign_id", "=", applied.campaignId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(contacts.c), 0, "0 contacts on the clone");

    // --- 3. FROZEN ----------------------------------------------------------
    const cloneNodesBefore = (
      await db.selectFrom("sequence_nodes").select("type").where("campaign_id", "=", applied.campaignId).orderBy("type").execute()
    ).map((r) => r.type);
    assert.equal(cloneNodesBefore.length, 2, "clone has the cloned graph");
    // The clone is now a LIVE campaign.
    await db.updateTable("campaigns").set({ status: "running" }).where("id", "=", applied.campaignId).execute();
    // Edit the ORIGINAL template to a completely different graph.
    await svc.update(workspaceId, tmpl.id, {
      graph: [{ key: "n0", kind: "action", type: "add_tag", config: {}, next: null, true: null, false: null, delayDays: null }],
    });
    const cloneNodesAfter = (
      await db.selectFrom("sequence_nodes").select("type").where("campaign_id", "=", applied.campaignId).orderBy("type").execute()
    ).map((r) => r.type);
    assert.deepEqual(cloneNodesAfter, cloneNodesBefore, "editing the template did NOT change the running clone (frozen)");
    const updatedTmpl = await svc.get(workspaceId, tmpl.id);
    assert.equal(updatedTmpl.graph.length, 1, "the template itself did change");
    assert.ok(updatedTmpl.templateVersion > tmpl.templateVersion, "template version bumped on graph edit");
  });
});
