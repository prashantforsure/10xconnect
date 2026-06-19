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

/** A number env var with a default; blank/unset → default. */
const numberWithDefault = (def: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().default(def));

/** A boolean env var ("true"/"1"/"yes" → true); blank/unset → default. */
const booleanWithDefault = (def: boolean) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .union([z.boolean(), z.string()])
      .transform((v) =>
        typeof v === "boolean" ? v : ["true", "1", "yes", "on"].includes(v.trim().toLowerCase()),
      )
      .default(def),
  );

/**
 * Environment schema for the whole platform.
 *
 * In Step 2 the Supabase variables are still optional so the app boots without a
 * configured environment. Later steps will tighten these as features come online.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Transport adapter selection (Step 8). 'mock' = in-memory adapter for
  // dev/test; 'unipile' = real LinkedIn transport (later step). Defaults to mock.
  ADAPTER: z.preprocess(blankToUndefined, z.enum(["mock", "unipile"]).default("mock")),

  // Supabase (Step 2+)
  // Server-side (used by apps/api and web server components).
  SUPABASE_URL: optionalUrl,
  SUPABASE_ANON_KEY: optionalString,
  // Server-only. Never expose to the browser.
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  // Server-only. Used by the API to verify Supabase access-token JWTs (HS256).
  SUPABASE_JWT_SECRET: optionalString,

  // Server-only. AES-256-GCM key for encrypting sending-account credential /
  // session material at rest (Step 10). 32 bytes, hex (64 chars) or base64.
  // Required to connect credentials-based accounts; never sent to the browser.
  SECRETS_ENCRYPTION_KEY: optionalString,

  // Database (Step 3+)
  DATABASE_URL: optionalString,

  // Redis / queue (Phase 4+)
  REDIS_URL: optionalString,

  // Transport: Unipile (Phase 2+)
  UNIPILE_API_KEY: optionalString,
  UNIPILE_DSN: optionalString,

  // AI personalization (Phase 6+). LLM_API_KEY is the provider key (Gemini for
  // the MVP). Model + provider are swappable; the adapter lives in packages/adapters.
  LLM_API_KEY: optionalString,
  LLM_PROVIDER: z.preprocess(blankToUndefined, z.enum(["gemini", "mock"]).default("gemini")),
  LLM_MODEL: z.preprocess(blankToUndefined, z.string().default("gemini-2.0-flash")),

  // Voice notes / TTS (Phase 6+)
  TTS_API_KEY: optionalString,

  // Dispatch engine cadence (orchestration brain). Defaults are SAFE for real
  // accounts: poll every 15s, 4–8 min spacing (4-min base + up to 4-min jitter,
  // ~6 min average — jittered so it never bursts), respect working hours. The
  // per-account DAILY CAPS remain the hard safety ceiling regardless of spacing —
  // this cadence just lets an account actually reach those caps within its window.
  // The demo-only knobs (tiny spacing / ignore working hours) make a campaign
  // visibly run in seconds on the MOCK adapter — never on a real account.
  DISPATCH_ENABLED: booleanWithDefault(true),
  DISPATCH_TICK_MS: numberWithDefault(15_000),
  DISPATCH_MIN_SPACING_MS: numberWithDefault(240_000),
  DISPATCH_JITTER_MS: numberWithDefault(240_000),
  DISPATCH_IGNORE_WORKING_HOURS: booleanWithDefault(false),

  // Payments (Phase 9+)
  CREEM_API_KEY: optionalString,

  // Observability (Phase 12+)
  SENTRY_DSN: optionalString,

  // App
  APP_URL: z.preprocess(blankToUndefined, z.string().url().default("http://localhost:3000")),
  // The API's own PUBLICLY reachable base URL (no trailing /api/v1). Used to build
  // the Unipile Hosted Auth `notify_url`, which Unipile must be able to reach —
  // so this must be a public URL in production (localhost only works with the
  // mock adapter, which simulates the callback locally).
  API_PUBLIC_URL: z.preprocess(blankToUndefined, z.string().url().default("http://localhost:3001")),
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
