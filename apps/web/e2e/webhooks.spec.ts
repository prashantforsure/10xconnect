// Settings -> Webhooks: create against a local sink, signing secret shown once,
// Test hits the sink, a real (outbox) event is delivered and shows in the log,
// then disable.

import { expect, test } from "@playwright/test";

import { trackConsoleErrors } from "./helpers/console";
import { startSink, type Sink } from "./helpers/sink";
import { insertIntegrationEvent, loadContext } from "./helpers/supabase";

let sink: Sink;

test.beforeAll(async () => {
  sink = await startSink();
});
test.afterAll(async () => {
  await sink?.close();
});

test("Webhooks: create, secret once, test, live delivery in log, disable", async ({ page }) => {
  const errors = trackConsoleErrors(page);
  const { workspaceId } = loadContext();

  await page.goto("/settings/webhooks");
  await expect(page.getByRole("heading", { name: "Add endpoint" })).toBeVisible();

  // --- Create the webhook (reply is selected by default) ---------------------
  await page.getByPlaceholder(/Name \(e\.g\. CRM sync\)/).fill("E2E Sink Hook");
  await page.getByPlaceholder("https://your-server.com/webhooks/10xconnect").fill(sink.url);
  await page.getByRole("button", { name: /add webhook/i }).click();

  // Signing secret shown ONCE.
  await expect(page.getByText(/copy it now/i)).toBeVisible();
  const secret = ((await page.locator("code", { hasText: "whsec_" }).first().textContent()) ?? "").trim();
  expect(secret.startsWith("whsec_")).toBeTruthy();

  // Row present + active.
  await expect(page.getByText("E2E Sink Hook")).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();

  // --- Test send hits the sink immediately -----------------------------------
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(page.getByText(/Delivered \(HTTP 200\)/)).toBeVisible();
  await sink.waitForRequest((r) => r.body.includes('"test":true'), 15_000);

  // --- A real outbox event is delivered by the poller ------------------------
  const eventId = await insertIntegrationEvent(workspaceId, "reply", {
    lead: { id: "lead_e2e", name: "E2E Lead" },
    message: { body: "hello from e2e" },
  });
  const delivered = await sink.waitForRequest((r) => r.body.includes(eventId), 30_000);
  expect(delivered.headers["x-10xc-event"]).toBe("reply");
  expect(typeof delivered.headers["x-10xc-signature"]).toBe("string");

  // Delivery log shows the delivered row.
  await page.getByRole("button", { name: "Delivery log for E2E Sink Hook" }).click();
  await expect(page.locator("td", { hasText: "delivered" }).first()).toBeVisible();

  // --- Disable ---------------------------------------------------------------
  await page.getByRole("button", { name: "Disable E2E Sink Hook" }).click();
  await expect(page.getByText("Disabled", { exact: true })).toBeVisible();

  expect(errors(), `console errors: ${errors().join(" | ")}`).toEqual([]);
});
