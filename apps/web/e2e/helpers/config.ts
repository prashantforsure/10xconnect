// Shared constants for the e2e suite. Paths are anchored on process.cwd(), which
// is apps/web when Playwright is launched via `pnpm --filter @10xconnect/web
// test:e2e` (the documented way to run it).

import { join } from "node:path";

const ROOT = process.cwd();

export const AUTH_DIR = join(ROOT, "e2e", ".auth");
/** Saved Playwright storageState (cookies) for the authenticated project. */
export const AUTH_STATE_PATH = join(AUTH_DIR, "state.json");
/** Seeded workspace/user context shared between setup, tests, and teardown. */
export const CONTEXT_PATH = join(AUTH_DIR, "context.json");

/** Web app origin. Override with E2E_BASE_URL if the dev server runs elsewhere. */
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
/** NestJS API origin (no /api/v1). Override with E2E_API_URL. */
export const API_URL = process.env.E2E_API_URL ?? "http://localhost:3001";
