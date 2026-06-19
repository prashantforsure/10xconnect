// Wires AI personalization into the dispatch content resolver. When a node config
// carries `aiPrompt` and an LLM is configured, the message is generated per-lead
// from the prospect's profile; otherwise we fall back to {variable} injection.
// The engine depends only on the core TextGenerationAdapter interface (no SDK).

import {
  buildPersonalizationPrompt,
  type PersonalizationProfile,
  type TextGenerationAdapter,
} from "@10xconnect/core";

import type { ContentResolver, LeadRow } from "./types";
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
    .map((p) => (typeof p?.text === "string" ? p.text.trim() : ""))
    .filter(Boolean)
    .slice(0, 3);
  return {
    firstName: typeof e.firstName === "string" ? e.firstName : undefined,
    lastName: typeof e.lastName === "string" ? e.lastName : undefined,
    headline: typeof e.headline === "string" ? e.headline : undefined,
    about: typeof e.about === "string" ? e.about : undefined,
    company: typeof e.company === "string" ? e.company : undefined,
    companyOverview: typeof e.companyOverview === "string" ? e.companyOverview : undefined,
    role: typeof e.role === "string" ? e.role : undefined,
    location: typeof e.location === "string" ? e.location : undefined,
    recentPosts: recentPosts.length > 0 ? recentPosts : undefined,
  };
}

/**
 * Build a ContentResolver. If a node config has `aiPrompt` and an LLM is wired,
 * generate per-lead; on any AI failure, fall back to variable injection so a
 * dispatch never fails just because the LLM is unavailable.
 */
export function createAiResolver(text: TextGenerationAdapter | null): ContentResolver {
  return async ({ template, config, lead }) => {
    const aiPrompt = typeof config.aiPrompt === "string" ? config.aiPrompt.trim() : "";
    if (text && aiPrompt) {
      try {
        const out = await text.generate(buildPersonalizationPrompt(aiPrompt, profileFromLead(lead)));
        return out;
      } catch {
        // fall through to variable injection
      }
    }
    return injectVariables(template, lead);
  };
}
