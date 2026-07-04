// Settings -> API: create (All + Read-only), secret shown once, list metadata,
// rename, revoke — and prove a created key actually authenticates the public API
// (read-only rejects writes; the denylist blocks billing).

import { expect, test } from "@playwright/test";

import { API_URL } from "./helpers/config";
import { trackConsoleErrors } from "./helpers/console";

test("API keys: create both permissions, use, rename, revoke", async ({ page, request }) => {
  const errors = trackConsoleErrors(page);

  await page.goto("/settings/api");
  await expect(page.getByRole("heading", { name: "API", exact: true })).toBeVisible();

  // --- Create an "All" key; plaintext shown once -----------------------------
  await page.fill("#key-name", "E2E All Key");
  await page.getByRole("button", { name: /generate key/i }).click();

  const secretCode = page.locator("code", { hasText: "10xc_" }).first();
  await expect(secretCode).toBeVisible();
  const allKey = ((await secretCode.textContent()) ?? "").trim();
  expect(allKey.startsWith("10xc_")).toBeTruthy();
  await expect(page.getByText(/won.t be shown again/i)).toBeVisible();

  // Scope badge assertions to the key row (the permission <select> also contains
  // <option>All</option> / <option>Read-only</option>).
  const allRow = page.locator("div.px-4.py-3").filter({ hasText: "E2E All Key" });
  await expect(allRow.getByText("All", { exact: true })).toBeVisible();

  // --- Create a Read-only key ------------------------------------------------
  await page.fill("#key-name", "E2E Reporting");
  await page.selectOption("#key-permission", "read_only");
  await page.getByRole("button", { name: /generate key/i }).click();
  // Wait for the banner to re-render with the NEW key before reading it (both
  // keys share the 10xc_ prefix, so the code element is reused).
  const roCode = page.locator("code", { hasText: "10xc_" }).first();
  await expect(roCode).not.toHaveText(allKey);
  const roKey = ((await roCode.textContent()) ?? "").trim();
  expect(roKey.startsWith("10xc_")).toBeTruthy();
  expect(roKey).not.toBe(allKey);
  const roRow = page.locator("div.px-4.py-3").filter({ hasText: "E2E Reporting" });
  await expect(roRow.getByText("Read-only", { exact: true })).toBeVisible();

  // --- The key authenticates the public API (workspace pinned, no header) ----
  const list = await request.get(`${API_URL}/api/v1/campaigns`, {
    headers: { Authorization: `Bearer ${allKey}` },
  });
  expect(list.ok()).toBeTruthy();

  // Read-only key is rejected on a write.
  const write = await request.post(`${API_URL}/api/v1/campaigns`, {
    headers: { Authorization: `Bearer ${roKey}` },
    data: { name: "should-be-blocked" },
  });
  expect(write.status()).toBe(403);

  // Denylist: billing is never reachable with an API key.
  const billing = await request.get(`${API_URL}/api/v1/billing/subscription`, {
    headers: { Authorization: `Bearer ${allKey}` },
  });
  expect(billing.status()).toBe(403);

  // --- Rename the All key ----------------------------------------------------
  await page.getByRole("button", { name: "Rename E2E All Key" }).click();
  const renameInput = page.locator("input:focus");
  await renameInput.fill("E2E All Key (prod)");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("E2E All Key (prod)")).toBeVisible();

  // --- Revoke the read-only key ----------------------------------------------
  await page.getByRole("button", { name: "Revoke E2E Reporting" }).click();
  await expect(page.getByText("E2E Reporting")).toHaveCount(0);

  expect(errors(), `console errors: ${errors().join(" | ")}`).toEqual([]);
});
