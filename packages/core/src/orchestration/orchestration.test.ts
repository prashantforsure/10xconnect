import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultDailyCaps } from "../safety/caps";
import { defaultWeekSchedule } from "../safety/schedule";

import { computeHealth } from "./health";
import { checkRate } from "./rate-governor";
import { computeFirstDispatchAt, computeNextDispatchAt } from "./scheduler";
import { ageDaysSince, effectiveCaps, isWarmupComplete, warmupMultiplier } from "./warmup";

// --- warm-up --------------------------------------------------------------

test("warmupMultiplier ramps from reduced to full", () => {
  assert.equal(warmupMultiplier(0), 0.25);
  assert.equal(warmupMultiplier(7), 0.4);
  assert.equal(warmupMultiplier(14), 0.6);
  assert.equal(warmupMultiplier(21), 0.8);
  assert.equal(warmupMultiplier(28), 1);
  assert.equal(warmupMultiplier(100), 1);
});

test("a fresh account cannot send at full volume on day 1", () => {
  const base = defaultDailyCaps();
  const day1 = effectiveCaps(base, 0);
  assert.ok(day1.connection_request < base.connection_request);
  assert.equal(day1.connection_request, Math.floor(base.connection_request * 0.25));
  // Full caps once warmed.
  assert.deepEqual(effectiveCaps(base, 30), base);
});

test("effectiveCaps keeps small caps ≥1 while warming", () => {
  const caps = effectiveCaps({ ...defaultDailyCaps(), inmail: 5 }, 0);
  assert.ok(caps.inmail >= 1);
});

test("isWarmupComplete + ageDaysSince", () => {
  assert.equal(isWarmupComplete(28), true);
  assert.equal(isWarmupComplete(10), false);
  const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
  assert.equal(ageDaysSince(tenDaysAgo), 10);
  assert.equal(ageDaysSince(null), 0);
});

// --- rate governor --------------------------------------------------------

test("checkRate allows under cap and denies at cap (warmed account)", () => {
  const base = defaultDailyCaps(); // connection_request: 15
  const under = checkRate({ type: "connection_request", usedToday: 10, baseCaps: base, accountAgeDays: 30 });
  assert.equal(under.allowed, true);
  assert.equal(under.cap, 15);
  assert.equal(under.remaining, 5);

  const atCap = checkRate({ type: "connection_request", usedToday: 15, baseCaps: base, accountAgeDays: 30 });
  assert.equal(atCap.allowed, false);
  assert.match(atCap.reason ?? "", /cap reached/);
});

test("checkRate enforces the REDUCED warm-up cap for new accounts", () => {
  const base = defaultDailyCaps(); // connection_request: 15 → *0.25 = 3 on day 1
  const decision = checkRate({ type: "connection_request", usedToday: 3, baseCaps: base, accountAgeDays: 0 });
  assert.equal(decision.cap, 3);
  assert.equal(decision.allowed, false); // 3/3 reached even though base is 15
});

// --- scheduler ------------------------------------------------------------

test("computeNextDispatchAt jitters spacing and stays in working hours", () => {
  const schedule = defaultWeekSchedule();
  // Monday 10:00 UTC, 15-min spacing + up to 5-min jitter, rng=0 → +15 min.
  const from = new Date("2026-06-15T10:00:00Z");
  const next = computeNextDispatchAt({
    schedule,
    from,
    minSpacingMs: 15 * 60_000,
    jitterMs: 5 * 60_000,
    random: () => 0,
  });
  assert.equal(next.getTime(), from.getTime() + 15 * 60_000);
});

test("computeNextDispatchAt pushes past the window to the next opening", () => {
  const schedule = defaultWeekSchedule();
  // Friday 17:55 + 15 min would land at 18:10 (outside) → next Monday 09:00.
  const from = new Date("2026-06-19T17:55:00Z");
  const next = computeNextDispatchAt({
    schedule,
    from,
    minSpacingMs: 15 * 60_000,
    jitterMs: 0,
    random: () => 0,
  });
  assert.equal(next.getUTCDay(), 1);
  assert.equal(next.getUTCHours(), 9);
});

test("computeNextDispatchAt demo mode ignores working hours", () => {
  const schedule = defaultWeekSchedule();
  const from = new Date("2026-06-19T23:00:00Z"); // Friday night
  const next = computeNextDispatchAt({
    schedule,
    from,
    minSpacingMs: 1000,
    jitterMs: 0,
    ignoreWorkingHours: true,
    random: () => 0,
  });
  assert.equal(next.getTime(), from.getTime() + 1000);
});

test("computeFirstDispatchAt respects (or ignores) working hours", () => {
  const schedule = defaultWeekSchedule();
  const sat = new Date("2026-06-20T10:00:00Z"); // Saturday (off)
  assert.equal(computeFirstDispatchAt(schedule, sat).getUTCDay(), 1); // → Monday
  assert.equal(computeFirstDispatchAt(schedule, sat, true).getTime(), sat.getTime());
});

// --- health ---------------------------------------------------------------

test("computeHealth penalizes low acceptance and floors on restriction", () => {
  const healthy = computeHealth({
    connectionRequestsSent: 20,
    invitesAccepted: 10,
    messagesSent: 10,
    replies: 4,
    restrictionEvents: 0,
    captchaEvents: 0,
  });
  assert.equal(healthy.score, 100);
  assert.equal(healthy.restricted, false);
  assert.equal(healthy.acceptanceRate, 0.5);

  const lowAccept = computeHealth({
    connectionRequestsSent: 20,
    invitesAccepted: 1,
    messagesSent: 0,
    replies: 0,
    restrictionEvents: 0,
    captchaEvents: 0,
  });
  assert.ok(lowAccept.score < 100);

  const restricted = computeHealth({
    connectionRequestsSent: 5,
    invitesAccepted: 2,
    messagesSent: 0,
    replies: 0,
    restrictionEvents: 1,
    captchaEvents: 0,
  });
  assert.equal(restricted.restricted, true);
  assert.ok(restricted.score <= 20);
});
