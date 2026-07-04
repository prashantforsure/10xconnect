// Settings -> Integrations (Slack): connect against a local sink (welcome post
// received), send a test, disconnect. The API's Slack host check is relaxed in
// non-production, so the sink URL is accepted here.

import { expect, test } from "@playwright/test";

import { trackConsoleErrors } from "./helpers/console";
import { startSink, type Sink } from "./helpers/sink";

let sink: Sink;

test.beforeAll(async () => {
  sink = await startSink();
});
test.afterAll(async () => {
  await sink?.close();
});

test("Slack: connect (welcome received), test, disconnect", async ({ page }) => {
  const errors = trackConsoleErrors(page);

  await page.goto("/settings/integrations");
  await expect(page.getByText("Slack")).toBeVisible();

  // --- Connect against the sink ----------------------------------------------
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.locator("#slack-url").fill(sink.url);
  await page.getByRole("button", { name: "Connect Slack" }).click();

  await expect(page.getByText(/Slack connected/i)).toBeVisible();
  await sink.waitForRequest((r) => r.body.includes("10xConnect connected"), 15_000);
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  // --- Test post -------------------------------------------------------------
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(page.getByText(/Test message delivered to Slack/i)).toBeVisible();
  await sink.waitForRequest((r) => r.body.includes("Test Lead"), 15_000);

  // --- Disconnect ------------------------------------------------------------
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText(/Slack disconnected/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeVisible();

  expect(errors(), `console errors: ${errors().join(" | ")}`).toEqual([]);
});
