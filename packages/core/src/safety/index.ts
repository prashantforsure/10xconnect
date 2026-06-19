// Account-safety primitives (CLAUDE.md §6): per-account daily caps + ceilings and
// per-weekday working-hours windows. Pure constants/helpers used by the campaign
// settings, the rate governor, the scheduler, and the UI.
export * from "./caps";
export * from "./schedule";
