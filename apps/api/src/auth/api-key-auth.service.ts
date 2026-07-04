import { createHash } from "node:crypto";

import type { ApiKeyPermission, DB } from "@10xconnect/db";
import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Kysely } from "kysely";

import { KYSELY_DB } from "../database/database.module";

/** Plaintext key prefix — the auth guard branches on it (JWT vs API key). */
export const API_KEY_TOKEN_PREFIX = "10xc_";

/** What a validated API key grants: the key pins ONE workspace. */
export interface ApiKeyPrincipal {
  keyId: string;
  workspaceId: string;
  permission: ApiKeyPermission;
}

/**
 * Route prefixes (after the /api/v1 global prefix) that API keys can NEVER
 * reach. Everything identity-, money-, or privilege-shaped: a key must not
 * mint more keys, manage billing/members, or act as a "user".
 */
const DENIED_PREFIXES = [
  "/billing",
  "/workspaces",
  "/api-keys",
  "/me",
  "/dev",
  "/agency",
  "/affiliate",
  "/voice",
];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Per-key fixed-window rate limit (Aimfox parity: 60 req/min). In-memory —
// per-instance and approximate; move to Redis when the API scales horizontally.
const RATE_LIMIT_PER_MINUTE = 60;
const RATE_WINDOW_MS = 60_000;

// last_used_at is display metadata — throttle writes to at most one per key/min.
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Strip the global prefix so denylist checks are deployment-agnostic. */
function routePath(path: string): string {
  return path.startsWith("/api/v1") ? path.slice("/api/v1".length) : path;
}

/**
 * Authenticates `10xc_` bearer tokens for the public API. The key resolves to
 * its workspace (no user identity), enforces the denylist + read-only
 * permission + a per-key rate limit, and stamps last_used_at (throttled).
 */
@Injectable()
export class ApiKeyAuthService {
  private readonly rateWindows = new Map<string, { windowStart: number; count: number }>();
  private readonly lastUsedWrites = new Map<string, number>();

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  /**
   * Authenticate a key WITHOUT route/method checks: hash lookup + per-key rate
   * limit + last_used stamp. Used directly by the MCP endpoint (always POST —
   * read_only keys are gated per-TOOL there, not per-method).
   */
  async authenticate(token: string): Promise<ApiKeyPrincipal> {
    const row = await this.db
      .selectFrom("api_keys")
      .select(["id", "workspace_id", "permission"])
      .where("hash", "=", hashApiKey(token))
      .executeTakeFirst();
    if (!row) {
      throw new UnauthorizedException("Invalid API key");
    }
    this.enforceRateLimit(row.id);
    this.touchLastUsed(row.id);
    return { keyId: row.id, workspaceId: row.workspace_id, permission: row.permission };
  }

  /** Full authorization for one request. Returns the principal or throws 401/403/429. */
  async authorize(token: string, method: string, path: string): Promise<ApiKeyPrincipal> {
    const principal = await this.authenticate(token);

    const route = routePath(path);
    if (DENIED_PREFIXES.some((p) => route === p || route.startsWith(`${p}/`))) {
      throw new ForbiddenException("This endpoint is not available to API keys");
    }

    if (principal.permission === "read_only" && !READ_METHODS.has(method.toUpperCase())) {
      throw new ForbiddenException("This API key is read-only");
    }

    return principal;
  }

  private enforceRateLimit(keyId: string): void {
    const now = Date.now();
    const window = this.rateWindows.get(keyId);
    if (!window || now - window.windowStart >= RATE_WINDOW_MS) {
      this.rateWindows.set(keyId, { windowStart: now, count: 1 });
      return;
    }
    window.count += 1;
    if (window.count > RATE_LIMIT_PER_MINUTE) {
      const retryAfterSec = Math.ceil((window.windowStart + RATE_WINDOW_MS - now) / 1000);
      throw new HttpException(
        `API key rate limit exceeded (${RATE_LIMIT_PER_MINUTE} requests/minute). Retry in ${retryAfterSec}s.`,
        429,
      );
    }
  }

  private touchLastUsed(keyId: string): void {
    const now = Date.now();
    const last = this.lastUsedWrites.get(keyId);
    if (last && now - last < LAST_USED_WRITE_INTERVAL_MS) {
      return;
    }
    this.lastUsedWrites.set(keyId, now);
    // Fire-and-forget: display metadata must never fail or slow a request.
    void this.db
      .updateTable("api_keys")
      .set({ last_used_at: new Date().toISOString() })
      .where("id", "=", keyId)
      .execute()
      .catch(() => {});
  }
}
