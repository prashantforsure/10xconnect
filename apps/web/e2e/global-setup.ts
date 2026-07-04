// Playwright global setup: seed a throwaway workspace, log in through the real
// Supabase-Auth UI to mint a session, and persist storageState so every spec
// starts authenticated with an active workspace. Teardown deletes the user.

import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "@playwright/test";

import { AUTH_DIR, AUTH_STATE_PATH, BASE_URL, CONTEXT_PATH } from "./helpers/config";
import { seedWorkspace } from "./helpers/supabase";

async function globalSetup(): Promise<void> {
  const context = await seedWorkspace();
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(CONTEXT_PATH, JSON.stringify(context, null, 2));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.fill('input[name="email"]', context.email);
    await page.fill('input[name="password"]', context.password);
    await page.getByRole("button", { name: "Log in" }).click();

    // The login server action redirects off /login on success.
    try {
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
    } catch {
      const banner = await page.locator("p.text-destructive").first().textContent().catch(() => null);
      throw new Error(`e2e login failed${banner ? `: ${banner.trim()}` : " (still on /login)"}`);
    }

    // Confirm the app shell + workspace resolve before trusting the session.
    await page.goto(`${BASE_URL}/settings/api`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.getByRole("button", { name: /generate key/i }).waitFor({ timeout: 60_000 });

    await page.context().storageState({ path: AUTH_STATE_PATH });
  } finally {
    await browser.close();
  }
}

export default globalSetup;
