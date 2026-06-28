// Shared client types + formatting for the unit-economics views (campaign analytics
// tab, dashboard overall card, A/B compare). Mirrors the engine `UnitEconomics`
// shape returned by GET /analytics/unit-economics and
// GET /analytics/campaign/:id/unit-economics.

export interface UnitEconomics {
  totalSpendUsd: number;
  totalTokens: number;
  conversations: number;
  replies: number;
  qualified: number;
  bookedMeetings: number;
  /** Spend ÷ conversations (null when there are no conversations yet). */
  costPerConversationUsd: number | null;
  /** Spend ÷ qualified leads. */
  costPerQualifiedUsd: number | null;
  /** Spend ÷ booked meetings — the headline unit-economics number. */
  costPerBookedMeetingUsd: number | null;
}

/**
 * Format a USD amount for display. AI spend per outcome is often sub-dollar (a few
 * cents of tokens), so show 4 decimals under $1 and 2 above; `null` reads as "—"
 * (the ratio is undefined until there's an outcome to divide by).
 */
export function formatUsd(value: number | null | undefined): string {
  if (value == null) {
    return "—";
  }
  const decimals = Math.abs(value) > 0 && Math.abs(value) < 1 ? 4 : 2;
  return `$${value.toFixed(decimals)}`;
}
