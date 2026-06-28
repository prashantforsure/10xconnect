// Sourced-lead import primitive (Phase 7.3) — the engine-level core of "import a
// LinkedIn-derived source": take SourcedLead candidates (from any LeadSourceAdapter,
// e.g. a Sales Navigator search), workspace-DEDUPE them (core deriveDedupeKey — the
// SAME identity logic CSV + every source uses), persist NEW leads with their sourced
// enrichment + enrich_status='pending' (queued for deep enrichment), reuse existing
// ones, and optionally link them to a list. Idempotent: re-importing the same source
// creates 0 new leads (the dedupe_key unique-per-workspace index backs this).

import { deriveDedupeKey, normalizeEmail, type SourcedLead } from "@10xconnect/core";
import type { DB, Json } from "@10xconnect/db";
import type { Kysely } from "kysely";

export interface ImportSourcedResult {
  /** Candidates considered (after intra-batch identity collapse). */
  considered: number;
  created: number;
  duplicates: number;
  failed: number;
  createdLeadIds: string[];
  /** Created + matched-existing — the full resolved set (for list/enroll). */
  allLeadIds: string[];
}

interface LeadEnrichment {
  firstName?: string;
  lastName?: string;
  headline?: string;
  company?: string;
  role?: string;
  location?: string;
  connectionDegree?: number;
  source?: string;
}

function enrichmentFromSourced(lead: SourcedLead, source: string): LeadEnrichment {
  const out: LeadEnrichment = {
    firstName: lead.firstName,
    lastName: lead.lastName,
    headline: lead.headline,
    company: lead.company,
    role: lead.role,
    location: lead.location,
    connectionDegree: lead.connectionDegree,
    source,
  };
  for (const k of Object.keys(out) as (keyof LeadEnrichment)[]) {
    const v = out[k];
    if (v === undefined || v === null || v === "") delete out[k];
  }
  return out;
}

/**
 * Import sourced leads with workspace dedupe + enrichment-seed persistence. Pure DB
 * work (no provider calls) so it is fully testable on a fixture. `listId` links all
 * resolved leads to a list (idempotent). New leads land enrich_status='pending'.
 */
export async function importSourcedLeads(
  db: Kysely<DB>,
  input: { workspaceId: string; leads: SourcedLead[]; source: string; listId?: string; tags?: string[] },
): Promise<ImportSourcedResult> {
  const tags = input.tags ?? [];

  // 1) Collapse duplicate identities WITHIN this batch.
  const keyed = new Map<string, SourcedLead>();
  let duplicates = 0;
  for (const lead of input.leads) {
    const key = deriveDedupeKey({ linkedinUrl: lead.linkedinUrl, email: lead.email });
    if (!key) continue; // no usable identity → cannot dedupe; skip (sources always have one)
    if (keyed.has(key)) {
      duplicates += 1;
      continue;
    }
    keyed.set(key, lead);
  }

  // 2) Which identities already exist in the workspace?
  const keys = [...keyed.keys()];
  const existing = new Map<string, string>();
  if (keys.length > 0) {
    const rows = await db
      .selectFrom("leads")
      .select(["id", "dedupe_key"])
      .where("workspace_id", "=", input.workspaceId)
      .where("dedupe_key", "in", keys)
      .execute();
    for (const r of rows) {
      if (r.dedupe_key) existing.set(r.dedupe_key, r.id);
    }
  }

  // 3) Persist new; reuse existing.
  const createdLeadIds: string[] = [];
  const allLeadIds = new Set<string>();
  let failed = 0;

  for (const [key, lead] of keyed) {
    const existingId = existing.get(key);
    if (existingId) {
      duplicates += 1;
      allLeadIds.add(existingId);
      continue;
    }
    try {
      const row = await db
        .insertInto("leads")
        .values({
          workspace_id: input.workspaceId,
          linkedin_url: lead.linkedinUrl ?? null,
          email: normalizeEmail(lead.email) ?? lead.email ?? null,
          enrichment: JSON.stringify(enrichmentFromSourced(lead, input.source)) as unknown as Json,
          tags,
          connection_degree: lead.connectionDegree ?? null,
          dedupe_key: key,
          enrich_status: "pending",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      createdLeadIds.push(row.id);
      allLeadIds.add(row.id);
    } catch {
      // Lost a race to a concurrent import on the same identity → count as duplicate.
      const raced = await db
        .selectFrom("leads")
        .select("id")
        .where("workspace_id", "=", input.workspaceId)
        .where("dedupe_key", "=", key)
        .executeTakeFirst();
      if (raced) {
        duplicates += 1;
        allLeadIds.add(raced.id);
      } else {
        failed += 1;
      }
    }
  }

  // 4) Link to a list (idempotent).
  if (input.listId && allLeadIds.size > 0) {
    await db
      .insertInto("list_leads")
      .values([...allLeadIds].map((leadId) => ({ workspace_id: input.workspaceId, list_id: input.listId as string, lead_id: leadId })))
      .onConflict((oc) => oc.columns(["list_id", "lead_id"]).doNothing())
      .execute();
  }

  return {
    considered: keyed.size + duplicates,
    created: createdLeadIds.length,
    duplicates,
    failed,
    createdLeadIds,
    allLeadIds: [...allLeadIds],
  };
}
