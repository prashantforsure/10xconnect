// Settings/Resources -> Tutorials: the in-app integration guides render (all 5
// walkthroughs, deep-links into the real settings pages) with no console errors.
// Runs in the authenticated project context (the shell wraps this route).

import { expect, test } from "@playwright/test";

import { trackConsoleErrors } from "./helpers/console";

test("/tutorials renders the integration guides with no console errors", async ({ page }) => {
  const errors = trackConsoleErrors(page);

  await page.goto("/tutorials", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/tutorials$/);
  await expect(page.getByRole("heading", { name: "Connect your stack" })).toBeVisible();

  for (const guide of [
    "Create your first API key",
    "Connect Slack",
    "Set up MCP (Claude / Cursor)",
    "Receive events with webhooks",
    "Install the n8n node",
  ]) {
    await expect(page.getByRole("heading", { name: guide })).toBeVisible();
  }

  // Guides deep-link into the real settings surfaces + the developer reference.
  await expect(page.getByRole("link", { name: "Settings → API" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "developer docs" }).first()).toBeVisible();

  expect(errors(), `console errors: ${errors().join(" | ")}`).toEqual([]);
});
