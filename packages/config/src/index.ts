import { z } from "zod";

/**
 * Environment schema for the whole platform.
 *
 * In Step 1 every variable is optional (or defaulted) so the app boots without a
 * configured environment. Later steps will tighten these (e.g. make SUPABASE_URL
 * and DATABASE_URL required) as features come online.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Supabase (Step 2+)
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  // Server-only. Never expose to the browser.
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // Server-only. Used by the API to verify Supabase access-token JWTs (HS256).
  SUPABASE_JWT_SECRET: z.string().optional(),

  // Database (Step 3+)
  DATABASE_URL: z.string().optional(),

  // Redis / queue (Phase 4+)
  REDIS_URL: z.string().optional(),

  // Transport: Unipile (Phase 2+)
  UNIPILE_API_KEY: z.string().optional(),
  UNIPILE_DSN: z.string().optional(),

  // AI personalization (Phase 6+)
  LLM_API_KEY: z.string().optional(),

  // Voice notes / TTS (Phase 6+)
  TTS_API_KEY: z.string().optional(),

  // Payments (Phase 9+)
  CREEM_API_KEY: z.string().optional(),

  // Observability (Phase 12+)
  SENTRY_DSN: z.string().optional(),

  // App
  APP_URL: z.string().url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Validate and return the environment. Throws a readable error if validation
 * fails. Result is memoized so repeated imports share a single parsed object.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) {
    return cached;
  }

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
