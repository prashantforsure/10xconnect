// Scheduler (CLAUDE.md §6, roadmap Step 18). Dispatches only inside the account's
// working-hours window, with randomized ~6-min average spacing (4–8 min; jittered
// — never burst). Daily caps remain the hard ceiling. Pure: computes the next
// dispatch instant; the worker persists it as actions.scheduled_at. Randomness is
// injectable for deterministic tests.

import { type WeekSchedule, nextWorkingTime } from "../safety/schedule";

export interface NextDispatchInput {
  schedule: WeekSchedule;
  /** Compute the next slot relative to this instant (usually the last dispatch). */
  from: Date;
  /** Base spacing between actions (ms). Default-safe 4 min in config. */
  minSpacingMs: number;
  /** Extra random spacing added on top (ms) so cadence is jittered, not fixed. */
  jitterMs: number;
  /** Demo-only: ignore working hours (mock adapter only — never a real account). */
  ignoreWorkingHours?: boolean;
  /** Injectable RNG in [0,1) for deterministic tests. */
  random?: () => number;
}

/**
 * The next instant an action may dispatch: `from` + jittered spacing, pushed into
 * the next working-hours opening unless explicitly told to ignore them.
 */
export function computeNextDispatchAt(input: NextDispatchInput): Date {
  const rng = input.random ?? Math.random;
  const spacing = Math.max(0, input.minSpacingMs) + Math.floor(rng() * Math.max(0, input.jitterMs));
  const candidate = new Date(input.from.getTime() + spacing);
  if (input.ignoreWorkingHours) {
    return candidate;
  }
  return nextWorkingTime(input.schedule, candidate);
}

/**
 * The first dispatch time when a campaign starts: respects working hours (or
 * fires ~now in demo mode). No spacing before the first action.
 */
export function computeFirstDispatchAt(
  schedule: WeekSchedule,
  from: Date = new Date(),
  ignoreWorkingHours = false,
): Date {
  return ignoreWorkingHours ? from : nextWorkingTime(schedule, from);
}
