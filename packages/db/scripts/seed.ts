import { randomUUID } from "node:crypto";

import { createAdminClient } from "./db-utils";

// A deterministic test fixture so RLS can be verified manually.
const SEED_EMAIL = "seed-user@10xconnect.test";
const SEED_PASSWORD = "Seed-User-Pw-1!";

async function main(): Promise<void> {
  const admin = createAdminClient();

  // 1) Create (or find) the seed auth user.
  let userId: string | undefined;
  const created = await admin.auth.admin.createUser({
    email: SEED_EMAIL,
    password: SEED_PASSWORD,
    email_confirm: true,
  });

  if (created.error) {
    // Likely already exists — look it up.
    const list = await admin.auth.admin.listUsers();
    userId = list.data.users.find((u) => u.email === SEED_EMAIL)?.id;
    if (!userId) {
      throw created.error;
    }
    console.log("seed user already existed:", userId);
  } else {
    userId = created.data.user.id;
    console.log("created seed user:", userId);
  }

  // 2) Ensure a workspace owned by the seed user.
  const { data: existingWs } = await admin
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId)
    .limit(1);

  let workspaceId = existingWs?.[0]?.id as string | undefined;
  if (!workspaceId) {
    const ws = await admin
      .from("workspaces")
      .insert({ name: "Seed Workspace", owner_id: userId })
      .select("id")
      .single();
    if (ws.error) {
      throw ws.error;
    }
    workspaceId = ws.data.id as string;
    console.log("created workspace:", workspaceId);
  } else {
    console.log("workspace already existed:", workspaceId);
  }

  // 3) Ensure the owner membership.
  const membership = await admin
    .from("memberships")
    .upsert(
      { workspace_id: workspaceId, user_id: userId, role: "owner" },
      { onConflict: "workspace_id,user_id" },
    )
    .select("id")
    .single();
  if (membership.error) {
    throw membership.error;
  }
  console.log("ensured owner membership:", membership.data.id);

  // 4) Demo data (idempotent: only seeded when the workspace has no campaigns).
  const { data: existingCampaigns } = await admin
    .from("campaigns")
    .select("id")
    .eq("workspace_id", workspaceId)
    .limit(1);

  if (!existingCampaigns?.[0]) {
    // Mock sending account (warmed 60 days → full caps for a smooth demo).
    const startedAt = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const account = await admin
      .from("sending_accounts")
      .insert({
        workspace_id: workspaceId,
        type: "linkedin",
        connection_method: "credentials",
        name: "Demo LinkedIn",
        provider_account_id: `demo-${randomUUID()}`,
        proxy_type: "bundled",
        country: "US",
        location: "US",
        status: "active",
        health_score: 100,
        warmup_state: { phase: "warming", startedAt },
      })
      .select("id")
      .single();
    if (account.error) {
      throw account.error;
    }

    const list = await admin
      .from("contact_lists")
      .insert({ workspace_id: workspaceId, name: "Demo Founders", color: "#6366f1" })
      .select("id")
      .single();
    if (list.error) {
      throw list.error;
    }

    const sampleLeads = [
      { firstName: "Jordan", lastName: "Lee", company: "Northwind", role: "Founder & CEO" },
      { firstName: "Priya", lastName: "Shah", company: "Brightloop", role: "Head of Sales" },
      { firstName: "Marco", lastName: "Rossi", company: "Velocity Labs", role: "VP Growth" },
      { firstName: "Aisha", lastName: "Khan", company: "Lumen", role: "Co-founder" },
      { firstName: "Tom", lastName: "Becker", company: "Stackforge", role: "CRO" },
    ];
    for (const s of sampleLeads) {
      const slug = `${s.firstName}-${s.lastName}`.toLowerCase();
      const lead = await admin
        .from("leads")
        .insert({
          workspace_id: workspaceId,
          linkedin_url: `https://linkedin.com/in/demo-${slug}`,
          enrichment: {
            firstName: s.firstName,
            lastName: s.lastName,
            company: s.company,
            role: s.role,
            headline: `${s.role} at ${s.company}`,
          },
          tags: ["demo"],
          connection_degree: 2,
          enrich_status: "enriched",
        })
        .select("id")
        .single();
      if (lead.error) {
        throw lead.error;
      }
      await admin
        .from("list_leads")
        .insert({ workspace_id: workspaceId, list_id: list.data.id, lead_id: lead.data.id });
    }

    // Campaign + a canonical sequence (connection → invite_accepted? → message).
    const campaign = await admin
      .from("campaigns")
      .insert({
        workspace_id: workspaceId,
        name: "Demo: Founders Outreach",
        status: "draft",
        account_id: account.data.id,
        caps: {
          connection_request: 15,
          message: 30,
          like_post: 30,
          visit_profile: 30,
          comment_post: 30,
          follow_lead: 30,
          inmail: 5,
        },
        schedule: {
          sun: { enabled: false, start: "09:00", end: "18:00" },
          mon: { enabled: true, start: "09:00", end: "18:00" },
          tue: { enabled: true, start: "09:00", end: "18:00" },
          wed: { enabled: true, start: "09:00", end: "18:00" },
          thu: { enabled: true, start: "09:00", end: "18:00" },
          fri: { enabled: true, start: "09:00", end: "18:00" },
          sat: { enabled: false, start: "09:00", end: "18:00" },
        },
        settings: { skip_already_contacted: true, exclude_conn_req_from_reply_rate: true },
      })
      .select("id")
      .single();
    if (campaign.error) {
      throw campaign.error;
    }

    const nA = randomUUID();
    const nB = randomUUID();
    const nC = randomUUID();
    const seq = await admin.from("sequence_nodes").insert([
      { id: nA, workspace_id: workspaceId, campaign_id: campaign.data.id, kind: "action", type: "send_connection_request", config: {}, next_node_id: nB },
      { id: nB, workspace_id: workspaceId, campaign_id: campaign.data.id, kind: "condition", type: "invite_accepted", config: {}, true_node_id: nC },
      { id: nC, workspace_id: workspaceId, campaign_id: campaign.data.id, kind: "action", type: "send_message", config: { body: "Hi {first_name}, thanks for connecting! What's top of mind at {company} this quarter?" } },
    ]);
    if (seq.error) {
      throw seq.error;
    }
    console.log("seeded demo account, 5 leads, list, and a campaign with a sequence.");
  } else {
    console.log("demo data already present — skipped.");
  }

  console.log("\nSeed complete.");
  console.log(`  email:        ${SEED_EMAIL}`);
  console.log(`  password:     ${SEED_PASSWORD}`);
  console.log(`  user_id:      ${userId}`);
  console.log(`  workspace_id: ${workspaceId}`);
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
