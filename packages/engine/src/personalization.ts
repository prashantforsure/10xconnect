// Personalization resolution + the per-prospect preview cache (Phase 5). The SAME
// resolvePersonalizedMessage() runs at PREVIEW time and at DISPATCH time, keyed by
// (node_id, contact_id, prompt_version), so what you preview is exactly what sends
// — and a cached row means dispatch reuses the output with NO second LLM call.
// AI-chip generation is metered into budget_ledger. Variables resolve through the
// full registry (fallback / freshness / on_missing → no empty brackets, ever).

import {
  buildPersonalizationPrompt,
  estimateTokens,
  hasPersonalizationSignal,
  looksLikeRefusal,
  type PersonalizationProfile,
  promptVersion,
  readMessageBody,
  renderMessageBody,
  resolveContactVariables,
  type TextGenerationAdapter,
  type VariableContext,
  varietyWarning,
} from "@10xconnect/core";

import { meteredGenerate } from "./brain/metering";
import type { ContentResolver, EngineDeps, LeadRow } from "./types";
import { injectVariables } from "./variables";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function profileFromLead(lead: LeadRow): PersonalizationProfile {
  const e = asObject(lead.enrichment);
  const posts = Array.isArray(e.recentPosts) ? (e.recentPosts as { text?: string }[]) : [];
  const recentPosts = posts
    .map((p) => (typeof p?.text === "string" ? p.text.trim() : typeof p === "string" ? p : ""))
    .filter(Boolean)
    .slice(0, 3);
  return {
    firstName: typeof e.firstName === "string" ? e.firstName : undefined,
    lastName: typeof e.lastName === "string" ? e.lastName : undefined,
    headline: typeof e.headline === "string" ? e.headline : undefined,
    about: typeof e.about === "string" ? e.about : undefined,
    company: typeof e.company === "string" ? e.company : typeof e.companyName === "string" ? e.companyName : undefined,
    companyOverview: typeof e.companyOverview === "string" ? e.companyOverview : undefined,
    role: typeof e.role === "string" ? e.role : typeof e.jobTitle === "string" ? e.jobTitle : undefined,
    seniority: typeof e.seniority === "string" ? e.seniority : undefined,
    industry: typeof e.industry === "string" ? e.industry : undefined,
    location: typeof e.location === "string" ? e.location : undefined,
    recentPosts: recentPosts.length > 0 ? recentPosts : undefined,
  };
}

/** Build the variable-resolver context from a lead row (+ optional sender). */
function contextFromLead(lead: LeadRow, sender?: { firstName?: string; company?: string }, now?: Date): VariableContext {
  const e = asObject(lead.enrichment);
  return {
    enrichment: e,
    customColumns: asObject(lead.custom_columns),
    linkedinUrl: lead.linkedin_url,
    email: lead.email,
    connectionDegree: lead.connection_degree,
    sender,
    enrichedAt: typeof e.enrichedAt === "string" ? e.enrichedAt : null,
    now,
  };
}

export interface ResolveInput {
  workspaceId: string;
  campaignId: string | null;
  nodeId: string;
  /** The node's config jsonb (carries messageBody / legacy body + aiPrompt). */
  config: Record<string, unknown>;
  lead: LeadRow;
  sender?: { firstName?: string; company?: string };
  /** Default true — read the preview cache (set false to force a fresh run). */
  useCache?: boolean;
  /** Default true — write the resolved output to the cache. */
  write?: boolean;
}

export interface ResolveResult {
  text: string;
  cached: boolean;
  promptVersion: string;
  tokens: number;
}

/**
 * Resolve a node's message for one contact: variables (registry) + AI chips
 * (metered LLM), rendered with no broken merges. Reads/writes the preview cache so
 * preview and dispatch share one resolution.
 */
export async function resolvePersonalizedMessage(deps: EngineDeps, input: ResolveInput): Promise<ResolveResult> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const body = readMessageBody(input.config);
  const version = promptVersion(body);

  if (input.useCache !== false) {
    const cached = await db
      .selectFrom("preview_cache")
      .select(["resolved_text as text", "tokens"])
      .where("node_id", "=", input.nodeId)
      .where("contact_id", "=", input.lead.id)
      .where("prompt_version", "=", version)
      .executeTakeFirst();
    if (cached) return { text: cached.text, cached: true, promptVersion: version, tokens: Number(cached.tokens) };
  }

  // Variables (registry: value → fallback → on_missing; activity freshness).
  const customKeys = body.segments
    .filter((s): s is { type: "variable"; key: string; fallback?: string } => s.type === "variable")
    .map((s) => s.key)
    .filter((k) => k.startsWith("custom"));
  const resolved = resolveContactVariables(contextFromLead(input.lead, input.sender, now), customKeys);

  // AI chips — generate per-lead from ONLY the available facts, metered.
  // Guard (no broken/embarrassing sends): if there's nothing to personalize from
  // (enrichment empty/failed) skip the LLM call entirely; if the model returns a
  // refusal/meta-complaint ("No prospect details provided…"), drop it. Either way
  // the AI segment renders empty → renderMessageBody collapses it (no junk sent).
  let aiOut = "";
  let tokens = 0;
  const aiSeg = body.segments.find((s): s is { type: "ai"; prompt?: string; promptId?: string } => s.type === "ai");
  if (aiSeg && deps.textAdapter) {
    const profile = profileFromLead(input.lead);
    if (hasPersonalizationSignal(profile)) {
      const aiPrompt = (aiSeg.prompt ?? "").trim();
      const generated = (
        await meteredGenerate(
          deps,
          { workspaceId: input.workspaceId, campaignId: input.campaignId, conversationId: null, leadId: input.lead.id, kind: "personalization", model: deps.modelLabel ?? "mock", now },
          buildPersonalizationPrompt(aiPrompt, profile),
        )
      ).trim();
      aiOut = looksLikeRefusal(generated) ? "" : generated;
      tokens = estimateTokens(aiOut);
    }
  }

  const text = renderMessageBody(body, resolved.values, {
    renderAi: () => aiOut,
    policyByKey: resolved.policy,
  });

  if (input.write !== false) {
    await db
      .insertInto("preview_cache")
      .values({ node_id: input.nodeId, contact_id: input.lead.id, prompt_version: version, workspace_id: input.workspaceId, resolved_text: text, tokens })
      .onConflict((oc) => oc.columns(["node_id", "contact_id", "prompt_version"]).doUpdateSet({ resolved_text: text, tokens }))
      .execute();
  }
  return { text, cached: false, promptVersion: version, tokens };
}

export interface PreviewInput {
  workspaceId: string;
  campaignId: string | null;
  nodeId: string;
  config: Record<string, unknown>;
  leadIds?: string[];
  sampleSize?: number;
  sender?: { firstName?: string; company?: string };
  /** Force a fresh run (ignore + overwrite the cache) — used on "re-run". */
  force?: boolean;
}

export interface PreviewResult {
  promptVersion: string;
  results: { contactId: string; name: string; text: string; cached: boolean }[];
  varietyWarning: string | null;
}

const LEAD_COLS = ["id", "workspace_id", "linkedin_url", "email", "enrichment", "tags", "custom_columns", "connection_degree"] as const;

/** Resolve a node's message across sample/selected contacts (per-prospect preview). */
export async function previewNode(deps: EngineDeps, input: PreviewInput): Promise<PreviewResult> {
  let q = deps.db.selectFrom("leads").select(LEAD_COLS).where("workspace_id", "=", input.workspaceId);
  q = input.leadIds && input.leadIds.length > 0 ? q.where("id", "in", input.leadIds) : q.limit(input.sampleSize ?? 3);
  const leads = await q.execute();

  const results: PreviewResult["results"] = [];
  let promptVersionOut = "";
  for (const row of leads) {
    const lead: LeadRow = {
      id: row.id,
      workspace_id: row.workspace_id,
      linkedin_url: row.linkedin_url,
      email: row.email,
      enrichment: row.enrichment,
      tags: row.tags ?? [],
      custom_columns: row.custom_columns ?? {},
      connection_degree: row.connection_degree,
    };
    const r = await resolvePersonalizedMessage(deps, {
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      nodeId: input.nodeId,
      config: input.config,
      lead,
      sender: input.sender,
      useCache: !input.force,
      write: true,
    });
    promptVersionOut = r.promptVersion;
    results.push({ contactId: row.id, name: leadDisplayName(lead), text: r.text, cached: r.cached });
  }
  return { promptVersion: promptVersionOut, results, varietyWarning: varietyWarning(results.map((r) => r.text)) };
}

function leadDisplayName(lead: LeadRow): string {
  const e = asObject(lead.enrichment);
  return [e.firstName, e.lastName].filter(Boolean).join(" ").trim() || lead.email || lead.linkedin_url || "Lead";
}

/**
 * Cache-aware dispatch resolver (Phase 5). For an AI-bearing body it routes through
 * resolvePersonalizedMessage (reuses the preview cache → no second LLM call). With
 * no node context it falls back to plain variable injection so dispatch never fails.
 */
export function createCachedAiResolver(deps: EngineDeps): ContentResolver {
  return async ({ workspaceId, campaignId, nodeId, config, lead, template }) => {
    if (!nodeId) return injectVariables(template, lead);
    const { text } = await resolvePersonalizedMessage(deps, {
      workspaceId,
      campaignId: campaignId ?? null,
      nodeId,
      config,
      lead,
      useCache: true,
      write: true,
    });
    return text;
  };
}

/**
 * Legacy resolver (pre-cache): generate per-lead from the prompt, else variable
 * injection. Kept for callers that don't have node context. Prefer
 * createCachedAiResolver in the worker.
 */
export function createAiResolver(text: TextGenerationAdapter | null): ContentResolver {
  return async ({ template, config, lead }) => {
    const aiPrompt = typeof config.aiPrompt === "string" ? config.aiPrompt.trim() : "";
    if (text && aiPrompt) {
      const profile = profileFromLead(lead);
      if (hasPersonalizationSignal(profile)) {
        try {
          const gen = (await text.generate(buildPersonalizationPrompt(aiPrompt, profile))).trim();
          if (gen && !looksLikeRefusal(gen)) {
            return gen;
          }
        } catch {
          // fall through to variable injection
        }
      }
    }
    return injectVariables(template, lead);
  };
}
