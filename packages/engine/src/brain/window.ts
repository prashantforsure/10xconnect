// The budget window key — a UTC calendar day 'YYYY-MM-DD' (matches budget_ledger.
// "window", a Postgres date). Caps reset at UTC midnight, mirroring the rate
// governor's per-UTC-day accounting.
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}
