import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

/**
 * Walk up from `startDir` looking for the nearest `.env` file. In this monorepo
 * scripts run from each package's directory, so we search ancestors to find the
 * single repo-root `.env`.
 */
function findNearestEnvFile(startDir: string): string | undefined {
  let dir = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

let dotenvLoaded = false;
function ensureDotenvLoaded(): void {
  if (dotenvLoaded) {
    return;
  }
  dotenvLoaded = true;
  const envPath = findNearestEnvFile(process.cwd());
  if (envPath) {
    loadDotenv({ path: envPath });
  }
}

// Treat blank values (e.g. `FOO=` in .env) as "unset" so optional vars don't
// fail validation just because the key exists with an empty value.
const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(blankToUndefined, z.string().optional());
const optionalUrl = z.preprocess(blankToUndefined, z.string().url().optional());

/**
 * Environment schema for the whole platform.
 *
 * In Step 2 the Supabase variables are still optional so the app boots without a
 * configured environment. Later steps will tighten these as features come online.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Supabase (Step 2+)
  // Server-side (used by apps/api and web server components).
  SUPABASE_URL: optionalUrl,
  SUPABASE_ANON_KEY: optionalString,
  // Server-only. Never expose to the browser.
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  // Server-only. Used by the API to verify Supabase access-token JWTs (HS256).
  SUPABASE_JWT_SECRET: optionalString,

  // Database (Step 3+)
  DATABASE_URL: optionalString,

  // Redis / queue (Phase 4+)
  REDIS_URL: optionalString,

  // Transport: Unipile (Phase 2+)
  UNIPILE_API_KEY: optionalString,
  UNIPILE_DSN: optionalString,

  // AI personalization (Phase 6+)
  LLM_API_KEY: optionalString,

  // Voice notes / TTS (Phase 6+)
  TTS_API_KEY: optionalString,

  // Payments (Phase 9+)
  CREEM_API_KEY: optionalString,

  // Observability (Phase 12+)
  SENTRY_DSN: optionalString,

  // App
  APP_URL: z.preprocess(blankToUndefined, z.string().url().default("http://localhost:3000")),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Validate and return the environment. Loads the repo-root `.env` first (for
 * Node processes), then validates. Throws a readable error on failure. Result is
 * memoized so repeated imports share a single parsed object.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) {
    return cached;
  }

  ensureDotenvLoaded();

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** Eagerly-validated environment object. */
export const env: Env = loadEnv();
