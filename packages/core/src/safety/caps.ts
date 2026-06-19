// Per-account daily action caps and hard safety ceilings (CLAUDE.md §6).
// Account safety is the #1 priority: the system REFUSES to exceed researched safe
// maxima even when a user asks — it warns and clamps, never silently exceeds.
// These are pure constants + helpers shared by the campaign Frequency settings
// (clamp on save), the rate governor (enforce per dispatch), and the UI (warn).

import type { ActionType } from "../channel/types";

/** Action types the per-account daily caps apply to (LinkedIn transport subset). */
export type CappedActionType = Exclude<ActionType, "email">;

/**
 * Default per-account daily caps — the Prosp.ai defaults (CLAUDE.md §6 table).
 * Message-like and comment-like actions inherit the relevant row's default.
 */
export const DEFAULT_DAILY_CAPS: Record<CappedActionType, number> = {
  connection_request: 15,
  message: 30,
  voice_note: 20,
  inmail: 5,
  open_profile_message: 30,
  comment_post: 30,
  reply_comment: 30,
  like_post: 30,
  visit_profile: 30,
  follow_lead: 30,
};

/**
 * Hard ceilings — the researched safe maxima. A requested cap above the ceiling
 * is clamped down with a warning; the system never dispatches above these.
 * Deliberately conservative (acceptance rate matters more than raw volume).
 */
export const MAX_DAILY_CAPS: Record<CappedActionType, number> = {
  connection_request: 25,
  message: 80,
  voice_note: 40,
  inmail: 30,
  open_profile_message: 80,
  comment_post: 60,
  reply_comment: 60,
  like_post: 80,
  visit_profile: 80,
  follow_lead: 60,
};

export const CAPPED_ACTION_TYPES = Object.keys(DEFAULT_DAILY_CAPS) as CappedActionType[];

export interface ClampedCap {
  type: CappedActionType;
  /** The value to persist/enforce after clamping. */
  value: number;
  /** True if the requested value was reduced to the ceiling. */
  clamped: boolean;
  ceiling: number;
  /** Human-readable warning when clamped (surface in the UI). */
  warning?: string;
}

/**
 * Clamp a single requested cap to [0, ceiling]. Negative/NaN → default for the
 * type. Above ceiling → clamped down with a warning (never exceed safe maxima).
 */
export function clampCap(type: CappedActionType, requested: number): ClampedCap {
  const ceiling = MAX_DAILY_CAPS[type];
  if (!Number.isFinite(requested) || requested < 0) {
    return { type, value: DEFAULT_DAILY_CAPS[type], clamped: false, ceiling };
  }
  const value = Math.floor(requested);
  if (value > ceiling) {
    return {
      type,
      value: ceiling,
      clamped: true,
      ceiling,
      warning: `${type} capped at the safe maximum of ${ceiling}/day (requested ${value}).`,
    };
  }
  return { type, value, clamped: false, ceiling };
}

/** A full per-account caps map (all action types). */
export type DailyCaps = Record<CappedActionType, number>;

/**
 * Clamp a partial/whole caps map, filling missing types with defaults. Returns
 * the safe caps plus any clamp warnings to surface to the user.
 */
export function clampCaps(requested: Partial<Record<CappedActionType, number>>): {
  caps: DailyCaps;
  warnings: string[];
} {
  const caps = {} as DailyCaps;
  const warnings: string[] = [];
  for (const type of CAPPED_ACTION_TYPES) {
    const req = requested[type];
    const result = clampCap(type, req ?? DEFAULT_DAILY_CAPS[type]);
    caps[type] = result.value;
    if (result.warning) {
      warnings.push(result.warning);
    }
  }
  return { caps, warnings };
}

/** The default caps map (used when a campaign has no custom caps yet). */
export function defaultDailyCaps(): DailyCaps {
  return { ...DEFAULT_DAILY_CAPS };
}
