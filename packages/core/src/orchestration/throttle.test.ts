import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultDailyCaps } from "../safety/caps";

import { checkRate } from "./rate-governor";
import { acceptanceThrottle, readThrottleFactor } from "./throttle";

test("acceptanceThrottle needs a sample, then throttles soft/severe below thresholds", () => {
  // Too small a sample → never throttle on noise.
  assert.deepEqual(acceptanceThrottle({ acceptanceRate: 0.0, connectionRequestsSent: 5 }), { factor: 1, throttled: false });
  assert.deepEqual(acceptanceThrottle({ acceptanceRate: null, connectionRequestsSent: 50 }), { factor: 1, throttled: false });

  // 50% acceptance over a real sample → healthy, no throttle.
  assert.equal(acceptanceThrottle({ acceptanceRate: 0.5, connectionRequestsSent: 20 }).throttled, false);

  // 15% → soft throttle (0.5); 5% → severe (0.25).
  const soft = acceptanceThrottle({ acceptanceRate: 0.15, connectionRequestsSent: 20 });
  assert.equal(soft.throttled, true);
  assert.equal(soft.factor, 0.5);
  const severe = acceptanceThrottle({ acceptanceRate: 0.05, connectionRequestsSent: 20 });
  assert.equal(severe.factor, 0.25);
});

test("checkRate applies the throttle factor on top of warm-up (and is a no-op by default)", () => {
  const base = defaultDailyCaps(); // connection_request default 15
  const warmed = 28; // fully warmed

  // No throttle field → unchanged behavior (backward compatible).
  const full = checkRate({ type: "connection_request", usedToday: 0, baseCaps: base, accountAgeDays: warmed });
  assert.equal(full.cap, base.connection_request);

  // 0.5 throttle halves the warmed cap.
  const half = checkRate({ type: "connection_request", usedToday: 0, baseCaps: base, accountAgeDays: warmed, throttleFactor: 0.5 });
  assert.equal(half.cap, Math.floor(base.connection_request * 0.5));
  assert.ok(half.cap < full.cap, "throttle reduced the cap");

  // A throttled account that's already sent its reduced quota is denied.
  const denied = checkRate({ type: "connection_request", usedToday: half.cap, baseCaps: base, accountAgeDays: warmed, throttleFactor: 0.5 });
  assert.equal(denied.allowed, false);
  assert.match(denied.reason ?? "", /throttle/);
});

test("readThrottleFactor parses warmup_state.throttle (default 1, clamped)", () => {
  assert.equal(readThrottleFactor({}), 1);
  assert.equal(readThrottleFactor(null), 1);
  assert.equal(readThrottleFactor({ throttle: { factor: 0.5 } }), 0.5);
  assert.equal(readThrottleFactor({ throttle: { factor: 0 } }), 1, "0/invalid → no throttle");
  assert.equal(readThrottleFactor({ throttle: { factor: 2 } }), 1, "clamped to ≤1");
});
