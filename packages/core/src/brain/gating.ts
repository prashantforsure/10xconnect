// Whether a campaign has a "brain" configured — i.e. enough context for the AI to
// engage inbound replies. This is the EXACT gate the inbound pipeline uses to
// decide whether to enqueue a conversation turn (packages/engine/src/inbound.ts),
// and the same predicate the Context-tab "AI is off" indicator reads, so the UI
// can never disagree with runtime behaviour: a reply only routes to the AI when a
// campaign has a meaningful objective OR a linked knowledge base.
//
// An objective counts only when it has at least one non-empty field — matching the
// engine's objectiveFrom() (which trims away blank strings). Without this, a no-op
// "Save" on an empty Aim card would persist `{}` / `{goal:""}` and falsely flip the
// indicator to "on" while the AI actually has zero grounding.

export interface CampaignBrainPresence {
  /** campaigns.objective (jsonb) — null/absent when unset. */
  objective?: unknown;
  /** campaigns.knowledge_base_id — null/absent when no KB is linked. */
  knowledgeBaseId?: string | null;
}

/** True when the objective is an object with at least one non-empty string field. */
function hasObjectiveContent(objective: unknown): boolean {
  if (!objective || typeof objective !== "object" || Array.isArray(objective)) {
    return false;
  }
  return Object.values(objective as Record<string, unknown>).some(
    (v) => typeof v === "string" && v.trim().length > 0,
  );
}

/** True when the campaign has a meaningful objective or a linked knowledge base. */
export function hasCampaignBrain(input: CampaignBrainPresence): boolean {
  return input.knowledgeBaseId != null || hasObjectiveContent(input.objective);
}
