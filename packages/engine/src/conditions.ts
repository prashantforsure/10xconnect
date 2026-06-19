// Condition node evaluation (CLAUDE.md §7). Static conditions resolve immediately
// from lead data; event conditions (invite_accepted, message_opened/replied) wait
// for the inbound event up to a timeout, then take the false branch.

import { DEFAULT_CONDITION_WAIT_DAYS, isEventCondition } from "./nodes";
import { hasLeadEvent } from "./repository";
import type { EngineDeps, LeadRow, SequenceNodeRow } from "./types";

const DAY_MS = 86_400_000;

export type ConditionOutcome = "true" | "false" | "wait";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Map an event-condition node type to the lead_events.type it waits on. */
function eventTypeFor(nodeType: string): string {
  if (nodeType === "message_replied") {
    return "reply";
  }
  return nodeType; // invite_accepted, message_opened, email_opened, ...
}

export async function evaluateCondition(
  deps: EngineDeps,
  input: {
    workspaceId: string;
    node: SequenceNodeRow;
    lead: LeadRow;
    firstCheckedAt: Date;
  },
): Promise<ConditionOutcome> {
  const { node, lead, workspaceId } = input;
  const cfg = asObject(node.config);
  const now = deps.now?.() ?? new Date();

  if (isEventCondition(node.type)) {
    const occurred = await hasLeadEvent(deps.db, workspaceId, lead.id, eventTypeFor(node.type));
    if (occurred) {
      return "true";
    }
    const waitDays =
      (typeof cfg.waitDays === "number" ? cfg.waitDays : undefined) ??
      DEFAULT_CONDITION_WAIT_DAYS[node.type] ??
      7;
    const elapsed = now.getTime() - input.firstCheckedAt.getTime();
    return elapsed >= waitDays * DAY_MS ? "false" : "wait";
  }

  // Static conditions.
  switch (node.type) {
    case "has_linkedin_url":
      return lead.linkedin_url ? "true" : "false";
    case "is_first_level":
      return lead.connection_degree === 1 ? "true" : "false";
    case "is_open_profile": {
      const enrichment = asObject(lead.enrichment);
      return enrichment.openProfile === true ? "true" : "false";
    }
    case "check_data_in_column": {
      const column = typeof cfg.column === "string" ? cfg.column : "";
      const columns = asObject(lead.custom_columns);
      const value = column ? columns[column] : undefined;
      if (cfg.equals !== undefined) {
        return value === cfg.equals ? "true" : "false";
      }
      return value !== undefined && value !== null && value !== "" ? "true" : "false";
    }
    default:
      // Unknown/unsupported condition (e.g. email_* in the LinkedIn MVP) → false.
      return "false";
  }
}
