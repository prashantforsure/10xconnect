// Slot-based pricing (CLAUDE.md §8): you pay per sending-account slot; campaigns,
// contacts, messages, and team members are unlimited. A residential proxy is
// bundled per slot. Shared by the landing page, the public pricing page, and the
// in-app billing screen so the numbers never drift.

export type BillingCycle = "monthly" | "annual";

/** Price per slot per month, in USD. Annual is billed yearly at a discount. */
export const PRICE_PER_SLOT: Record<BillingCycle, number> = {
  monthly: 49,
  annual: 39,
};

export const INCLUDED_FEATURES: string[] = [
  "Unlimited campaigns, contacts & messages",
  "Unlimited team members (free seats)",
  "Bundled residential proxy per account",
  "AI-personalized messages & comments",
  "Account-safety engine (rate limits, warm-up, health)",
  "Unified inbox with auto-stop on reply",
  "Analytics & per-account safety insights",
];

/** Monthly cost for a number of slots on a given cycle. */
export function monthlyCost(slots: number, cycle: BillingCycle): number {
  return slots * PRICE_PER_SLOT[cycle];
}

/** What the customer is actually billed now (annual = 12 months up front). */
export function billedNow(slots: number, cycle: BillingCycle): number {
  return cycle === "annual" ? monthlyCost(slots, cycle) * 12 : monthlyCost(slots, cycle);
}
