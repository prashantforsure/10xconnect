// Campaign AI conversation LIMITS + BUDGET config (pure parsers, like
// objectiveFrom/guardrailsFrom in prompts.ts). These are the knobs the Phase 3
// governors read: spam caps (max AI turns, per-contact cooldown) and the LLM
// spend cap (daily USD, soft-alert threshold). Stored in campaigns.limits /
// campaigns.budget (jsonb). Defaults are SAFE — conservative volume caps, and an
// uncapped budget (opt-in) so existing campaigns are unaffected until configured.

export interface LimitsConfig {
  /** Max AI replies per conversation before a forced human handoff. */
  maxAiTurns: number;
  /** Min minutes between AI replies to the same contact (0 = off). */
  cooldownMinutes: number;
}

export interface BudgetConfig {
  /** Daily USD cap on AI spend per campaign. null/undefined = uncapped. */
  dailyUsdCap: number | null;
  /** Fraction of the cap [0..1] at which a one-time soft alert fires. */
  alertAtPct: number;
}

/** Default conversation spam caps. */
export const DEFAULT_LIMITS: LimitsConfig = {
  maxAiTurns: 6,
  cooldownMinutes: 0,
};

export const DEFAULT_ALERT_AT_PCT = 0.8;

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Parse + clamp campaigns.limits into a LimitsConfig (always returns safe values). */
export function limitsFrom(json: unknown): LimitsConfig {
  const o = obj(json);
  const maxAiTurns = num(o.max_ai_turns);
  const cooldownMinutes = num(o.cooldown_minutes);
  return {
    maxAiTurns: maxAiTurns !== undefined ? Math.max(0, Math.floor(maxAiTurns)) : DEFAULT_LIMITS.maxAiTurns,
    cooldownMinutes:
      cooldownMinutes !== undefined ? Math.max(0, Math.floor(cooldownMinutes)) : DEFAULT_LIMITS.cooldownMinutes,
  };
}

/** Parse campaigns.budget into a BudgetConfig (uncapped by default). */
export function budgetFrom(json: unknown): BudgetConfig {
  const o = obj(json);
  const cap = num(o.daily_usd_cap);
  const pct = num(o.alert_at_pct);
  return {
    dailyUsdCap: cap !== undefined && cap >= 0 ? cap : null,
    alertAtPct: pct !== undefined ? Math.min(1, Math.max(0, pct)) : DEFAULT_ALERT_AT_PCT,
  };
}
