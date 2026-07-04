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

/** A number env var with NO default; blank/unset → undefined (an optional override). */
const optionalNumber = z.preprocess(blankToUndefined, z.coerce.number().optional());

/** A boolean env var with NO default; blank/unset → undefined (an optional override). */
const optionalBoolean = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .union([z.boolean(), z.string()])
    .transform((v) =>
      typeof v === "boolean" ? v : ["true", "1", "yes", "on"].includes(v.trim().toLowerCase()),
    )
    .optional(),
);

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
  // gemini-2.5-flash: 2.0-flash has no free-tier quota on the current key (429 limit:0).
  LLM_MODEL: z.preprocess(blankToUndefined, z.string().default("gemini-2.5-flash")),

  // Embeddings (conversation-brain RAG). Mirrors the LLM knobs; EMBEDDING_API_KEY
  // falls back to LLM_API_KEY. The mock provider is a deterministic hashing
  // embedder so the knowledge base works offline (ADAPTER=mock).
  EMBEDDING_API_KEY: optionalString,
  EMBEDDING_PROVIDER: z.preprocess(blankToUndefined, z.enum(["gemini", "mock"]).default("gemini")),
  EMBEDDING_MODEL: z.preprocess(blankToUndefined, z.string().default("gemini-embedding-001")),

  // Voice notes / TTS (Phase 7). Per-prospect cloned voice notes via ElevenLabs
  // Professional Voice Cloning. Mock-safe by default (voice is a paid feature, so
  // it stays opt-in): VOICE_PROVIDER=mock → deterministic offline audio. VOICE_API_KEY
  // falls back to TTS_API_KEY. The adapter lives ONLY in packages/adapters.
  TTS_API_KEY: optionalString,
  VOICE_API_KEY: optionalString,
  VOICE_PROVIDER: z.preprocess(blankToUndefined, z.enum(["elevenlabs", "mock"]).default("mock")),
  VOICE_MODEL: z.preprocess(blankToUndefined, z.string().default("eleven_multilingual_v2")),

  // Dispatch engine cadence (orchestration brain). A single switch — DISPATCH_MODE
  // — picks the spacing PRESET (see DISPATCH_PRESETS in @10xconnect/engine):
  //   - "testing" (DEFAULT): visibly-fast pacing so a campaign runs to completion in
  //     seconds on the MOCK adapter (demos/dev). NEVER use on a real LinkedIn account.
  //   - "production": real human pacing — 4–8 min jittered spacing (4-min base + up
  //     to 4-min jitter, ~6 min average — jittered so it never bursts) within the
  //     account's working hours. Flip to this at launch with DISPATCH_MODE=production.
  // The per-account DAILY CAPS remain the hard safety ceiling in BOTH modes — spacing
  // only controls cadence within the window, never the daily total.
  // The DISPATCH_MIN_SPACING_MS / DISPATCH_JITTER_MS / DISPATCH_IGNORE_WORKING_HOURS
  // vars are OPTIONAL per-field overrides: set one to tune a preset (e.g. nudge
  // production spacing) without leaving the chosen mode. Unset → the preset value.
  DISPATCH_ENABLED: booleanWithDefault(true),
  DISPATCH_TICK_MS: numberWithDefault(15_000),
  DISPATCH_MODE: z.preprocess(blankToUndefined, z.enum(["testing", "production"]).default("testing")),
  DISPATCH_MIN_SPACING_MS: optionalNumber,
  DISPATCH_JITTER_MS: optionalNumber,
  DISPATCH_IGNORE_WORKING_HOURS: optionalBoolean,

  // Payments (Phase 9+)
  CREEM_API_KEY: optionalString,

  // Accounts. Multiple LinkedIn accounts per workspace are gated by the billing
  // slot count; set true to bypass the slot cap (dev / self-host).
  ALLOW_UNLIMITED_ACCOUNTS: booleanWithDefault(false),

  // Developer-access allowlist. Emails here (comma / space / semicolon separated)
  // get FULL access — unlimited sending-account slots + an always-active ($0)
  // subscription — in any workspace they OWN, in every environment INCLUDING
  // production. Scoped to the workspace owner's email, so real customers are never
  // affected. A built-in default (DEFAULT_DEVELOPER_EMAILS) is always included so
  // the primary developer keeps access even with no env set; add more here.
  DEVELOPER_EMAILS: optionalString,

  // Shared secret for inbound provider webhooks (Unipile notify_url, payments).
  // When set, webhook routes REQUIRE it (x-webhook-secret header or ?secret=…)
  // and reject anything else — fail closed. Unset → allowed (dev / mock adapter).
  WEBHOOK_SECRET: optionalString,

  // Integrations — OUTBOUND webhook/Slack delivery poller (apps/api). Signing
  // uses per-webhook DB secrets, NOT the inbound WEBHOOK_SECRET above.
  INTEGRATIONS_DELIVERY_ENABLED: booleanWithDefault(true),
  INTEGRATIONS_DELIVERY_TICK_MS: numberWithDefault(15_000),

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

/**
 * Built-in developer allowlist — always granted full access, even with no
 * DEVELOPER_EMAILS env var set, so the primary developer can never lock
 * themselves out of their own deployment. Extend at runtime via DEVELOPER_EMAILS.
 */
export const DEFAULT_DEVELOPER_EMAILS = ["pp9926521681@gmail.com"] as const;

/**
 * The parsed developer-email allowlist: the built-in defaults plus anything in the
 * DEVELOPER_EMAILS env var (split on commas / whitespace / semicolons), all
 * lower-cased for case-insensitive matching.
 */
export function developerEmails(e: Env = env): Set<string> {
  const extra = (e.DEVELOPER_EMAILS ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set<string>([...DEFAULT_DEVELOPER_EMAILS, ...extra]);
}

/** True if `email` is on the developer allowlist (case-insensitive; null-safe). */
export function isDeveloperEmail(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }
  return developerEmails().has(email.trim().toLowerCase());
}

/**
 * Fail fast at SERVER STARTUP if production is missing critical secrets. Call
 * from the api/worker bootstrap — NOT at import time, so it never breaks a build
 * (Next.js sets NODE_ENV=production during `next build`). In non-production it is
 * a no-op, keeping local dev and tests frictionless.
 */
export function assertProductionEnv(e: Env = env): void {
  if (e.NODE_ENV !== "production") {
    return;
  }
  const required: [keyof Env, string][] = [
    ["SECRETS_ENCRYPTION_KEY", "encrypts connected-account sessions at rest"],
    ["SUPABASE_URL", "Supabase project URL"],
    ["SUPABASE_SERVICE_ROLE_KEY", "service-role database access"],
    ["SUPABASE_JWT_SECRET", "verifies user session JWTs"],
    ["DATABASE_URL", "database connection"],
  ];
  const missing = required.filter(([key]) => !e[key]).map(([key, why]) => `  - ${key} (${why})`);
  if (missing.length > 0) {
    throw new Error(
      `Refusing to start in production — missing required environment:\n${missing.join("\n")}`,
    );
  }
}
