import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { API_URL, AUTH_STATE_PATH, BASE_URL } from "./e2e/helpers/config";

// E2E harness for the integrations surfaces (API keys, webhooks, Slack, MCP,
// /developers). Auth is handled once in e2e/global-setup.ts (seed a throwaway
// workspace + log in through the real Supabase-Auth UI) and shared via
// storageState. Simulation-safe: no real adapter, no LinkedIn sends, throwaway
// workspaces only.
//
// Run:  pnpm --filter @10xconnect/web test:e2e         (headless)
//       pnpm --filter @10xconnect/web test:e2e:ui      (interactive)
// First-time setup:  npx playwright install chromium
//
// NOT wired into the default `pnpm test` gate — it needs the browser binary and
// a running/reachable stack, so it stays an explicit, separately-run gate.

const REPO_ROOT = join(__dirname, "..", "..");

export default defineConfig({
  testDir: "./e2e",
  // One shared workspace + a per-key rate limiter make parallel workers racey;
  // determinism matters more than speed for this small suite.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Dev-server route compilation can be slow on the first hit; be generous. The
  // webhook delivery-log spec also waits on the ~15s outbound poller.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    storageState: AUTH_STATE_PATH,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Reuse the already-running dev stack; only start it if nothing is listening.
  webServer: [
    {
      command: "pnpm --filter @10xconnect/api dev",
      url: `${API_URL}/health`,
      cwd: REPO_ROOT,
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: "pnpm --filter @10xconnect/web dev",
      url: `${BASE_URL}/login`,
      cwd: REPO_ROOT,
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
