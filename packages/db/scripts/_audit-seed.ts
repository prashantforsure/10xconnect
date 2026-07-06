// AUDIT TOOLING (throwaway — never commit): seeds an isolated SIMULATION-MODE
// workspace for the /campaigns/:id production-readiness audit. Everything is
// fake (SIM- provider ids, nonexistent linkedin URLs) and simulation_mode:true
// is written in the same INSERT that creates the workspace, so no dispatch can
// ever reach a real provider. Deleted by _audit-teardown.ts.

import { randomUUID } from "node:crypto";

import { createAdminClient, createPgClient } from "./db-utils";

const EPOCH = Date.now();
const EMAIL = `audit-sim-${EPOCH}@10xconnect.test`;
const PASSWORD = `Aud-${randomUUID()}!x9`;

const SIXTY_DAYS_AGO = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
const WARMED = JSON.stringify({ phase: "active", startedAt: SIXTY_DAYS_AGO });

interface LeadSpec {
  key: string;
  firstName: string;
  lastName: string;
  degree: number | null;
  openProfile?: boolean;
  customColumns?: Record<string, string>;
  noLinkedin?: boolean;
  suppressed?: boolean;
  sparse?: boolean; // missing company/about → exercises fallbacks
}

const LEAD_SPECS: LeadSpec[] = [
  { key: "L1", firstName: "Asha", lastName: "Rao", degree: 1 },
  { key: "L2", firstName: "Ben", lastName: "Carter", degree: 1, openProfile: true },
  { key: "L3", firstName: "Chitra", lastName: "Iyer", degree: 1 },
  { key: "L4", firstName: "Dev", lastName: "Malhotra", degree: 2 },
  { key: "L5", firstName: "Elena", lastName: "Petrova", degree: 2, customColumns: { segment: "A" } },
  { key: "L6", firstName: "Farid", lastName: "Khan", degree: 3 },
  { key: "L7", firstName: "Grace", lastName: "Lin", degree: 2 },
  { key: "L8", firstName: "Hugo", lastName: "Mendes", degree: 2, sparse: true },
  { key: "L9", firstName: "Ira", lastName: "Solberg", degree: null, noLinkedin: true },
  { key: "L10", firstName: "Jonas", lastName: "Weber", degree: 2, suppressed: true },
];

function enrichmentFor(spec: LeadSpec, n: number): string {
  if (spec.sparse) {
    // Only a first name — everything else missing to test fallback/drop behavior.
    return JSON.stringify({ firstName: spec.firstName, providerId: `SIM-LEAD-${n}` });
  }
  return JSON.stringify({
    firstName: spec.firstName,
    lastName: spec.lastName,
    headline: `${spec.firstName} — VP Growth at SimCorp ${n}`,
    role: "VP Growth",
    seniority: "vp",
    about: `Simulated lead ${n} for the 10xConnect audit. Loves B2B SaaS and clean data.`,
    location: "Berlin, Germany",
    company: `SimCorp ${n}`,
    companyOverview: `SimCorp ${n} builds simulated B2B tooling for audit workflows.`,
    industry: "Software",
    companySize: "51-200",
    openProfile: spec.openProfile === true,
    providerId: `SIM-LEAD-${n}`,
  });
}

async function main(): Promise<void> {
  const admin = createAdminClient();
  const pg = createPgClient();
  await pg.connect();
  try {
    // 1. Auth user (handle_new_user trigger mirrors into public.profiles)
    const created = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error("failed to create audit user");
    }
    const userId = created.data.user.id;

    // 2. Workspace — handle_new_user already created this user's personal
    //    workspace + owner membership. Overwrite its settings so
    //    simulation_mode:true lands (safety layer L1) and rename it, keeping a
    //    single workspace per user.
    const ws = await pg.query(
      `update public.workspaces
          set name = $1, settings = $3::jsonb
        where owner_id = $2
        returning id`,
      [
        "AUDIT-SIM (safe to delete)",
        userId,
        JSON.stringify({
          simulation_mode: true,
          ai_sdr_enabled: true,
          inbox_type: "all_conversations",
          auto_withdraw_days: 14,
        }),
      ],
    );
    const workspaceId: string = ws.rows[0].id;

    // 3. Sim sending account — fake provider id (safety layer L2), warmup done
    const acct = await pg.query(
      `insert into public.sending_accounts
         (workspace_id, type, connection_method, name, provider_account_id, status, health_score, warmup_state, location, country)
       values ($1, 'linkedin', 'extension', 'Sim LinkedIn (audit)', $2, 'active', 100, $3::jsonb, 'Berlin', 'DE')
       returning id`,
      [workspaceId, `SIM-AUDIT-${randomUUID()}`, WARMED],
    );
    const accountId: string = acct.rows[0].id;

    // 4. Leads — pre-enriched (enrich_status='enriched' so nothing triggers real fetchProfile)
    const leadIds: Record<string, string> = {};
    for (let i = 0; i < LEAD_SPECS.length; i++) {
      const spec = LEAD_SPECS[i];
      const n = i + 1;
      const linkedinUrl = spec.noLinkedin ? null : `https://www.linkedin.com/in/audit-sim-lead-${n}`;
      const email = spec.noLinkedin ? `audit-sim-lead-${n}@simcorp.test` : null;
      const row = await pg.query(
        `insert into public.leads
           (workspace_id, linkedin_url, email, enrichment, custom_columns, enrich_status, connection_degree, account_id)
         values ($1, $2, $3, $4::jsonb, $5::jsonb, 'enriched', $6, $7)
         returning id`,
        [
          workspaceId,
          linkedinUrl,
          email,
          enrichmentFor(spec, n),
          JSON.stringify(spec.customColumns ?? {}),
          spec.degree,
          accountId,
        ],
      );
      leadIds[spec.key] = row.rows[0].id;

      if (spec.suppressed && linkedinUrl) {
        await pg.query(
          `insert into public.do_not_contact (workspace_id, linkedin_url, reason)
           values ($1, $2, 'audit suppression test')`,
          [workspaceId, linkedinUrl],
        );
      }
    }

    // 5. Contact list with L1–L8
    const list = await pg.query(
      `insert into public.contact_lists (workspace_id, name, color) values ($1, 'Audit List', '#7c3aed') returning id`,
      [workspaceId],
    );
    const listId: string = list.rows[0].id;
    for (const key of ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"]) {
      await pg.query(
        `insert into public.list_leads (workspace_id, list_id, lead_id) values ($1, $2, $3)`,
        [workspaceId, listId, leadIds[key]],
      );
    }

    // 6. Verify the simulation flag really landed (safety preflight, part 1)
    const check = await pg.query(
      `select settings->>'simulation_mode' as sim from public.workspaces where id = $1`,
      [workspaceId],
    );
    if (check.rows[0]?.sim !== "true") {
      throw new Error(`FATAL: simulation_mode not set on workspace ${workspaceId} — aborting`);
    }

    const context = {
      email: EMAIL,
      password: PASSWORD,
      userId,
      workspaceId,
      accountId,
      listId,
      leadIds,
      simulationVerified: true,
    };
    console.log("AUDIT_CONTEXT_JSON_START");
    console.log(JSON.stringify(context, null, 2));
    console.log("AUDIT_CONTEXT_JSON_END");
  } finally {
    await pg.end();
  }
}

main().catch((e: unknown) => {
  console.error("audit-seed failed:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
