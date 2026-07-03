import assert from "node:assert/strict";
import { test } from "node:test";

import { SIMULATED_PROVIDER_REF, resolveSimulation, simulatedActionResult } from "./simulation";

// pp9926521681@gmail.com is in DEFAULT_DEVELOPER_EMAILS (packages/config), so it is
// a developer email with no env configuration. A plain customer email is not.
const DEV_EMAIL = "pp9926521681@gmail.com";
const CUSTOMER_EMAIL = "someone@customer.example";

test("resolveSimulation: a developer-owned workspace defaults ON when unset", () => {
  assert.equal(resolveSimulation({}, DEV_EMAIL), true);
  assert.equal(resolveSimulation({ inbox_type: "campaign_only" }, DEV_EMAIL), true);
});

test("resolveSimulation: a normal workspace defaults OFF when unset", () => {
  assert.equal(resolveSimulation({}, CUSTOMER_EMAIL), false);
  assert.equal(resolveSimulation({}, null), false);
  assert.equal(resolveSimulation(undefined, undefined), false);
});

test("resolveSimulation: an explicit boolean always wins over the default", () => {
  // A developer deliberately opts into a REAL send.
  assert.equal(resolveSimulation({ simulation_mode: false }, DEV_EMAIL), false);
  // Any workspace can opt IN to simulation.
  assert.equal(resolveSimulation({ simulation_mode: true }, CUSTOMER_EMAIL), true);
});

test("resolveSimulation: tolerates a JSON-string settings blob", () => {
  assert.equal(resolveSimulation(JSON.stringify({ simulation_mode: true }), CUSTOMER_EMAIL), true);
  assert.equal(resolveSimulation(JSON.stringify({}), DEV_EMAIL), true);
});

test("simulatedActionResult: a success tagged SIMULATED (recorded but not sent)", () => {
  const r = simulatedActionResult("idem-1", new Date(0));
  assert.equal(r.status, "success");
  assert.equal(r.idempotencyKey, "idem-1");
  assert.equal(r.status === "success" && r.providerRef, SIMULATED_PROVIDER_REF);
  assert.equal(r.status === "success" && r.at, new Date(0).toISOString());
});
