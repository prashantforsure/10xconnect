import assert from "node:assert/strict";
import { test } from "node:test";

import { DISPATCH_PRESETS, resolveDispatchConfig } from "./config";

// The testing-vs-production spacing toggle (BATCH 6 item 5). dispatchConfigFromEnv
// reads cached env, so the behaviour lives in the pure resolveDispatchConfig — that
// is what we assert here.

test("DEFAULTS to the testing preset (visibly-fast, ignores working hours)", () => {
  const cfg = resolveDispatchConfig({ mode: "testing" });
  assert.equal(cfg.minSpacingMs, DISPATCH_PRESETS.testing.minSpacingMs);
  assert.equal(cfg.jitterMs, 0);
  assert.equal(cfg.ignoreWorkingHours, true);
  // Sanity: testing spacing is sub-second-ish, NOT the 4-min production base.
  assert.ok(cfg.minSpacingMs < 5_000, "testing spacing must be fast");
});

test("production mode uses real 4–8 min jittered spacing within working hours", () => {
  const cfg = resolveDispatchConfig({ mode: "production" });
  assert.equal(cfg.minSpacingMs, 240_000); // 4-min base
  assert.equal(cfg.jitterMs, 240_000); // up to +4-min jitter → 4–8 min
  assert.equal(cfg.ignoreWorkingHours, false);
});

test("per-field env overrides win over the preset without leaving the mode", () => {
  const cfg = resolveDispatchConfig({
    mode: "production",
    minSpacingMs: 300_000,
    ignoreWorkingHours: true,
  });
  assert.equal(cfg.minSpacingMs, 300_000); // overridden
  assert.equal(cfg.jitterMs, 240_000); // still the production preset
  assert.equal(cfg.ignoreWorkingHours, true); // overridden
});

test("an undefined override keeps the preset value (no accidental zeroing)", () => {
  const cfg = resolveDispatchConfig({ mode: "testing", minSpacingMs: undefined });
  assert.equal(cfg.minSpacingMs, DISPATCH_PRESETS.testing.minSpacingMs);
  assert.equal(cfg.batchSize, 25);
});
