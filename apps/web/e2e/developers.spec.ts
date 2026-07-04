// Public /developers docs render WITHOUT authentication (this is what the
// middleware public-path fix guarantees). Runs in a fresh, unauthenticated
// context and asserts no redirect to /login, all sections present, no console
// errors.

import { expect, test } from "@playwright/test";

import { API_URL } from "./helpers/config";
import { trackConsoleErrors } from "./helpers/console";

// Override the project's authenticated storageState — anonymous visitor.
test.use({ storageState: { cookies: [], origins: [] } });

test("/developers renders publicly with no console errors", async ({ page }) => {
  const errors = trackConsoleErrors(page);

  await page.goto("/developers", { waitUntil: "domcontentloaded" });

  // Must NOT be bounced to the login page.
  await expect(page).toHaveURL(/\/developers$/);
  await expect(page.getByRole("heading", { name: "Developers", exact: true })).toBeVisible();

  for (const section of ["Authentication", "REST API", "Webhooks", "MCP server"]) {
    await expect(page.getByRole("heading", { name: section })).toBeVisible();
  }

  // The API base URL is interpolated into the docs (no unrendered placeholder).
  await expect(page.getByText(API_URL, { exact: false }).first()).toBeVisible();
  await expect(page.getByText("undefined/campaigns")).toHaveCount(0);

  expect(errors(), `console errors: ${errors().join(" | ")}`).toEqual([]);
});
