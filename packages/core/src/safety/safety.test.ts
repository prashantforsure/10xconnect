import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clampCap,
  clampCaps,
  DEFAULT_DAILY_CAPS,
  defaultDailyCaps,
  MAX_DAILY_CAPS,
} from "./caps";
import {
  defaultWeekSchedule,
  isWithinWorkingHours,
  nextWorkingTime,
  validateSchedule,
} from "./schedule";

// --- caps -----------------------------------------------------------------

test("clampCap keeps values within the ceiling", () => {
  const r = clampCap("connection_request", 10);
  assert.equal(r.value, 10);
  assert.equal(r.clamped, false);
});

test("clampCap clamps above the safe ceiling and warns", () => {
  const ceiling = MAX_DAILY_CAPS.connection_request;
  const r = clampCap("connection_request", ceiling + 100);
  assert.equal(r.value, ceiling);
  assert.equal(r.clamped, true);
  assert.match(r.warning ?? "", /safe maximum/);
});

test("clampCap falls back to default for invalid input", () => {
  assert.equal(clampCap("message", -5).value, DEFAULT_DAILY_CAPS.message);
  assert.equal(clampCap("message", Number.NaN).value, DEFAULT_DAILY_CAPS.message);
});

test("clampCaps fills missing types with defaults and collects warnings", () => {
  const { caps, warnings } = clampCaps({ connection_request: 9999, like_post: 5 });
  assert.equal(caps.connection_request, MAX_DAILY_CAPS.connection_request);
  assert.equal(caps.like_post, 5);
  assert.equal(caps.message, DEFAULT_DAILY_CAPS.message); // filled default
  assert.ok(warnings.length >= 1);
});

test("defaults never exceed ceilings", () => {
  for (const [type, def] of Object.entries(DEFAULT_DAILY_CAPS)) {
    assert.ok(def <= MAX_DAILY_CAPS[type as keyof typeof MAX_DAILY_CAPS], `${type} default ≤ ceiling`);
  }
  assert.deepEqual(defaultDailyCaps(), DEFAULT_DAILY_CAPS);
});

// --- schedule -------------------------------------------------------------

test("isWithinWorkingHours respects enabled days + window (UTC)", () => {
  const sched = defaultWeekSchedule(); // Mon-Fri 09:00-18:00
  // 2026-06-15 is a Monday.
  const monday10 = new Date("2026-06-15T10:00:00Z");
  const monday20 = new Date("2026-06-15T20:00:00Z");
  const sunday10 = new Date("2026-06-14T10:00:00Z");
  assert.equal(isWithinWorkingHours(sched, monday10), true);
  assert.equal(isWithinWorkingHours(sched, monday20), false);
  assert.equal(isWithinWorkingHours(sched, sunday10), false);
});

test("nextWorkingTime pushes outside-window times to the next opening", () => {
  const sched = defaultWeekSchedule();
  // Friday 20:00 → should jump to Monday 09:00.
  const friday20 = new Date("2026-06-19T20:00:00Z");
  const next = nextWorkingTime(sched, friday20);
  assert.equal(next.getUTCDay(), 1); // Monday
  assert.equal(next.getUTCHours(), 9);
});

test("nextWorkingTime returns the input when already inside the window", () => {
  const sched = defaultWeekSchedule();
  const monday10 = new Date("2026-06-15T10:00:00Z");
  assert.equal(nextWorkingTime(sched, monday10).getTime(), monday10.getTime());
});

test("validateSchedule flags short windows and end<=start", () => {
  const sched = defaultWeekSchedule();
  sched.mon = { enabled: true, start: "09:00", end: "11:00" }; // 2h → warn
  sched.tue = { enabled: true, start: "18:00", end: "09:00" }; // invalid → error
  const result = validateSchedule(sched);
  assert.ok(result.warnings.some((w) => w.includes("mon")));
  assert.ok(result.errors.some((e) => e.includes("tue")));
  assert.equal(result.valid, false);
});
