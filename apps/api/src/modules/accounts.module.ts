import { env } from "@10xconnect/config";
import { isCredentialsReconnectCapable } from "@10xconnect/core";
import type {
  AccountConnection,
  AccountRef,
  AccountStatus,
  ChannelAdapter,
  ConnectInput,
  ProxyConfig,
} from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import { computeAccountHealth } from "@10xconnect/engine";
import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { Kysely } from "kysely";
import { z } from "zod";

import { CHANNEL_ADAPTER } from "../adapter/channel-adapter.module";
import { SecretCipher } from "../common/crypto/secret-cipher";
import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { isDeveloperWorkspace } from "../common/developer-access";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

// --- DTOs ------------------------------------------------------------------

// scheme://[user:pass@]host:port — http(s) or socks5(h). Validated before connect
// so a malformed proxy (the #1 silent connect failure) is rejected with a clear
// message instead of failing opaquely at the transport provider.
export const PROXY_URL_RE = /^(https?|socks5h?):\/\/([^\s:@/]+(:[^\s@/]*)?@)?[^\s:@/]+:\d{2,5}$/i;

const proxySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("bundled"),
    // Optional override; defaults to the account country for region matching.
    region: z.string().trim().min(1).max(64).optional(),
  }),
  z.object({
    mode: z.literal("own"),
    region: z.string().trim().min(1).max(64).optional(),
    // Full proxy URL (may embed credentials), e.g. http://user:pass@host:port or
    // socks5://host:port. Treated as SECRET material — encrypted, never stored
    // in a plaintext column or logged.
    url: z
      .string()
      .trim()
      .min(1)
      .max(2048)
      .regex(PROXY_URL_RE, "Proxy must be scheme://[user:pass@]host:port (http, https, or socks5)"),
  }),
]);

// Connect contract. Three methods, all persisted as encrypted-at-rest material:
//   - "extension" — the browser extension captures the user's real li_at session
//     + matching user-agent from their logged-in tab (the lowest-risk method).
//   - "cookie"    — the user pastes that same li_at manually (a testing affordance,
//     gated to non-production in the UI).
//   - "credentials" — Infinite login (CLAUDE.md §6): email + password + the
//     authenticator-app TOTP secret. The provider logs in inside a stable,
//     region-matched residential-proxy session and silently RE-AUTHENTICATES when
//     the session drops (solving the 2FA checkpoint from the stored TOTP secret),
//     so the account stays connected. Requires authenticator-app 2FA (not SMS).
// We validate the connection with the transport provider and re-check status
// before persisting, so a rejected login/session is never saved live.
const connectAccountSchema = z
  .object({
    method: z.enum(["extension", "cookie", "credentials"]).default("extension"),
    /** ISO country of the account — proxy + session are matched to it. */
    country: z.string().trim().min(2).max(64),
    /** Display email (extension/cookie) OR the LinkedIn login email (credentials). */
    email: z.string().trim().email().max(255).optional(),
    /** Captured/pasted LinkedIn `li_at` session cookie (extension/cookie). SECRET — encrypted at rest. */
    liAt: z.string().trim().min(20).max(8192).optional(),
    /**
     * Browser user-agent paired with the cookie (extension/cookie). Matching it
     * (with a region proxy) is what stops LinkedIn from logging the account out
     * (§6/§14) — it MUST be the user-agent of the browser the li_at came from.
     */
    userAgent: z.string().trim().min(1).max(512).optional(),
    /** LinkedIn password (credentials/Infinite login). SECRET — encrypted at rest, never logged. */
    password: z.string().min(1).max(512).optional(),
    /**
     * Base32 authenticator-app TOTP secret ("setup key") for Infinite login.
     * SECRET — encrypted at rest. Its presence is what makes re-auth silent: the
     * adapter generates the current 2FA code from it to solve LinkedIn's checkpoint.
     */
    totpSecret: z.string().trim().min(8).max(128).optional(),
    proxy: proxySchema.default({ mode: "bundled" }),
    /**
     * When set, RECONNECT this existing account (refresh its session in place,
     * preserving campaigns/history). Omit to connect a NEW account (consumes a
     * billing slot). Multi-account: a workspace can hold many LinkedIn accounts.
     */
    reconnectAccountId: z.string().uuid().optional(),
    /** Optional friendly label to disambiguate accounts in the list. */
    label: z.string().trim().max(80).optional(),
  })
  // Per-method required fields (kept out of the shape so one schema covers all three).
  .superRefine((v, ctx) => {
    if (v.method === "credentials") {
      if (!v.email) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "email is required for Infinite login" });
      }
      if (!v.password) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: "password is required for Infinite login" });
      }
    } else {
      if (!v.liAt) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["liAt"], message: "liAt is required" });
      }
      if (!v.userAgent) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["userAgent"], message: "userAgent is required" });
      }
    }
  });
type ConnectAccountDto = z.infer<typeof connectAccountSchema>;

/** Per-account overrides editable after connect (label + proxy region). */
const updateAccountSchema = z
  .object({
    label: z.string().trim().max(80).nullable().optional(),
    proxyRegion: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
type UpdateAccountDto = z.infer<typeof updateAccountSchema>;

// --- Views (no secrets, no provider handles) -------------------------------

export interface AccountView {
  id: string;
  type: "linkedin" | "mailbox";
  connection_method: "extension" | "credentials" | "cookie" | "hosted_auth" | null;
  name: string | null;
  label: string | null;
  proxy_type: "bundled" | "own" | null;
  proxy_region: string | null;
  country: string | null;
  location: string | null;
  status: AccountStatus;
  health_score: number;
  warmup_state: unknown;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectionGuidance {
  twoFactorRequired: boolean;
  summary: string;
  steps: string[];
}

/** Guidance for the extension connect flow — the primary connect method (CLAUDE.md §6). */
const EXTENSION_GUIDANCE: ConnectionGuidance = {
  twoFactorRequired: true,
  summary:
    "Connected through the 10xConnect extension, which rides your real, already-authenticated LinkedIn session — the safest way to connect, and what keeps the account from being logged out. Keep 2FA enabled on the account.",
  steps: [
    "Stay signed in to LinkedIn in the same browser — signing out invalidates the captured session.",
    "Keep 2FA enabled (Settings & Privacy → Sign in & security → Two-step verification).",
    "If the account is ever restricted or disconnected, just reconnect from this page — the extension refreshes the session in place.",
  ],
};

/**
 * Guidance for the manual li_at connect flow (testing). The precautions here are
 * the difference between an account that stays connected and one that LinkedIn
 * logs out repeatedly (§6/§14): keep the session, IP region, and user-agent
 * stable and consistent with each other.
 */
const COOKIE_GUIDANCE: ConnectionGuidance = {
  twoFactorRequired: true,
  summary:
    "Connected with your li_at session cookie. To keep LinkedIn from logging the account out again and again, the session, the proxy region, and the user-agent must stay stable and match each other.",
  steps: [
    "Copy li_at AND the user-agent from the SAME browser/profile, and set the country to where that account normally signs in — a mismatch between them is the #1 cause of repeated logouts.",
    "Don't sign out of LinkedIn in that browser, don't change the password, and don't use 'Sign out of all other sessions' — any of these kills the li_at.",
    "Keep 2FA enabled, avoid logging into the account from lots of different networks/devices, and let it run on its assigned region proxy.",
    "If it does get logged out, paste a fresh li_at here — it reconnects in place and keeps your campaigns + history.",
  ],
};

/**
 * Guidance for the credentials (Infinite login) flow. The account stays connected
 * because we can silently re-authenticate — but only while the stored credentials
 * + TOTP secret remain valid, so the precautions center on NOT invalidating them.
 */
const CREDENTIALS_GUIDANCE: ConnectionGuidance = {
  twoFactorRequired: true,
  summary:
    "Connected with Infinite login. We sign the account in inside a stable, region-matched residential-proxy session, and — because your authenticator 2FA secret is stored encrypted — silently re-authenticate whenever LinkedIn drops the session, so it stays connected without you reconnecting.",
  steps: [
    "Keep authenticator-app 2FA (TOTP) enabled — it's what lets us log back in for you. Don't switch 2FA to SMS or turn it off.",
    "Don't change the account password — it invalidates the stored login (if you do, reconnect here with the new one).",
    "Set the country to where the account normally signs in; it runs on a matching residential proxy so LinkedIn never sees impossible travel.",
    "New accounts warm up gradually — we never exceed safe daily limits.",
  ],
};

export interface ConnectAccountResponse {
  account: AccountView;
  guidance: ConnectionGuidance;
}

export interface AccountHealthView {
  accountId: string;
  status: AccountStatus;
  healthScore: number;
  // Real metrics from the account-health monitor (Phase 7.4 / Step 20).
  acceptanceRate: number | null;
  replyRate: number | null;
  actionsToday: number | null;
  restrictionEvents: number;
  /** Acceptance-rate auto-throttle state (cap multiplier in effect). */
  throttle: { factor: number; throttled: boolean; reason?: string };
  signals: string[];
  note: string;
}

/**
 * Columns safe to return to workspace members. Deliberately excludes
 * provider_account_id (provider handle) and the entire sending_account_secrets
 * row (encrypted credentials — server-only).
 */
const ACCOUNT_VIEW_COLUMNS = [
  "id",
  "type",
  "connection_method",
  "name",
  "label",
  "proxy_type",
  "proxy_region",
  "country",
  "location",
  "status",
  "health_score",
  "warmup_state",
  "avatar_url",
  "created_at",
  "updated_at",
] as const;

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    @Inject(CHANNEL_ADAPTER) private readonly adapter: ChannelAdapter,
    private readonly cipher: SecretCipher,
  ) {}

  /**
   * Connect (or reconnect) the workspace's single LinkedIn account via the
   * extension: establish the provider session through the adapter, then persist
   * the account + encrypted session material and initialize warm-up state (status
   * starts 'warming'; full ramp is Step 17). A workspace holds exactly one
   * LinkedIn account (CLAUDE.md §6) — if one already exists, the session is
   * refreshed in place (campaign state/history preserved). Works against any
   * ChannelAdapter (mock for dev, Unipile live).
   */
  async connect(workspaceId: string, dto: ConnectAccountDto): Promise<ConnectAccountResponse> {
    if (!this.cipher.isConfigured()) {
      // Refuse rather than persist plaintext — secret-at-rest is non-negotiable.
      throw new ServiceUnavailableException(
        "Credential encryption is not configured (SECRETS_ENCRYPTION_KEY missing)",
      );
    }

    if (dto.reconnectAccountId) {
      // Reconnect targets an existing row — verify it belongs to this workspace.
      await this.getRowOr404(workspaceId, dto.reconnectAccountId);
    } else {
      // A NEW account consumes a billing slot (multi-account cap).
      await this.assertSlotAvailable(workspaceId);
    }

    const proxy: ProxyConfig =
      dto.proxy.mode === "own"
        ? { mode: "own", region: dto.proxy.region ?? dto.country, url: dto.proxy.url }
        : { mode: "bundled", region: dto.proxy.region ?? dto.country };

    // Build the adapter input + the encrypted-at-rest secret bundle per method.
    // extension/cookie carry the li_at session + user-agent; credentials (Infinite
    // login) carry email/password + the TOTP secret. We persist the material
    // encrypted so a reconnect (or the silent Infinite-login re-auth) can reuse it.
    // The own-proxy URL is secret too, so it rides in the same encrypted bundle.
    const proxyExtra = proxy.mode === "own" && proxy.url ? { proxyUrl: proxy.url } : {};
    let input: ConnectInput;
    let secretBundle: Record<string, unknown>;
    if (dto.method === "credentials") {
      input = {
        method: "credentials",
        country: dto.country,
        proxy,
        // email/password validated as required for this method (superRefine).
        credentials: { email: dto.email as string, password: dto.password as string, totpSecret: dto.totpSecret },
      };
      secretBundle = {
        method: "credentials",
        email: dto.email,
        password: dto.password,
        ...(dto.totpSecret ? { totpSecret: dto.totpSecret } : {}),
        ...proxyExtra,
      };
    } else {
      input = {
        method: dto.method,
        country: dto.country,
        proxy,
        cookie: { liAt: dto.liAt as string, userAgent: dto.userAgent as string },
      };
      secretBundle = {
        method: dto.method,
        liAt: dto.liAt,
        userAgent: dto.userAgent,
        ...proxyExtra,
      };
    }
    const fallbackName = dto.email ?? "LinkedIn account";

    let connection: AccountConnection;
    try {
      connection = await this.adapter.connectAccount(input);
    } catch {
      // NEVER log the error — it may echo request fields (password/cookie/token). Generic only.
      this.logger.warn(`connectAccount failed via transport adapter (workspace=${workspaceId})`);
      throw new BadGatewayException("Failed to connect the account with the transport provider");
    }

    // Verify the session actually works before persisting (CLAUDE.md §6: buying
    // transport ≠ buying safety). A created account whose provider status comes
    // back disconnected/restricted — expired li_at cookie, security checkpoint, or
    // bad credentials — is NOT saved; we tear down the provider-side account and
    // surface a clear error so a dead account never looks "connected".
    const ref: AccountRef = {
      accountId: connection.accountId,
      providerAccountId: connection.providerAccountId,
    };
    let verifiedStatus: AccountStatus = connection.status;
    try {
      verifiedStatus = await this.adapter.getAccountStatus(ref);
    } catch {
      this.logger.warn(`Post-connect status check failed (workspace=${workspaceId})`);
    }
    if (verifiedStatus === "disconnected" || verifiedStatus === "restricted") {
      try {
        await this.adapter.disconnectAccount(ref);
      } catch {
        /* best-effort cleanup of the provider-side account */
      }
      throw new BadGatewayException(
        "Could not verify this LinkedIn account — LinkedIn rejected the session " +
          "(signed out, a security checkpoint, or an expired/mismatched li_at). " +
          "Sign back in to LinkedIn in the same browser and reconnect with a fresh session.",
      );
    }

    const ciphertext = this.cipher.encryptJson(secretBundle);
    const account = await this.finalizeLinkedInAccount(workspaceId, {
      providerAccountId: connection.providerAccountId,
      name: connection.name ?? fallbackName,
      avatarUrl: connection.avatarUrl ?? undefined,
      country: dto.country,
      proxy,
      connectionMethod: dto.method,
      ciphertext,
      reconnectAccountId: dto.reconnectAccountId ?? null,
      label: dto.label ?? undefined,
    });

    this.logger.log(`Connected ${dto.method} account ${account.id} (workspace=${workspaceId})`);
    return {
      account,
      guidance:
        dto.method === "credentials"
          ? CREDENTIALS_GUIDANCE
          : dto.method === "cookie"
            ? COOKIE_GUIDANCE
            : EXTENSION_GUIDANCE,
    };
  }

  /**
   * Infinite login (CLAUDE.md §6): silently re-authenticate a credentials account
   * after its session drops. Triggered by the inbound account_status_changed event
   * (Unipile CREDENTIALS → restricted / a disconnect). It's a SYSTEM-level call —
   * a webhook carries no workspace context — so it resolves the account by our id
   * OR the provider handle, decrypts the stored credentials, and re-logs in via the
   * adapter (which solves the 2FA checkpoint from the stored TOTP secret). On
   * success the account returns to 'warming'; on failure (a real restriction, a
   * changed password, or no stored TOTP) it's left as-is for a manual reconnect.
   * Never throws — best-effort self-healing, keyed off a de-duplicated event so it
   * runs at most once per drop (no reconnect loop).
   */
  async attemptInfiniteReconnectByRef(refId: string): Promise<{ reconnected: boolean }> {
    const adapter = this.adapter;
    if (!isCredentialsReconnectCapable(adapter) || !this.cipher.isConfigured()) {
      return { reconnected: false };
    }
    const row = await this.db
      .selectFrom("sending_accounts")
      .select(["id", "provider_account_id", "connection_method", "country", "proxy_type", "proxy_region"])
      .where("type", "=", "linkedin")
      .where((eb) => eb.or([eb("id", "=", refId), eb("provider_account_id", "=", refId)]))
      .executeTakeFirst();
    if (!row || row.connection_method !== "credentials") {
      return { reconnected: false };
    }
    const secret = await this.db
      .selectFrom("sending_account_secrets")
      .select("ciphertext")
      .where("account_id", "=", row.id)
      .executeTakeFirst();
    if (!secret) {
      return { reconnected: false };
    }
    let bundle: { email?: string; password?: string; totpSecret?: string; proxyUrl?: string };
    try {
      bundle = this.cipher.decryptJson(secret.ciphertext);
    } catch {
      return { reconnected: false };
    }
    // Infinite login REQUIRES the stored TOTP secret — without it we can't solve
    // the 2FA checkpoint, so leave it for a manual reconnect rather than loop.
    if (!bundle.email || !bundle.password || !bundle.totpSecret) {
      return { reconnected: false };
    }
    const region = row.proxy_region ?? row.country ?? undefined;
    const proxy: ProxyConfig =
      row.proxy_type === "own" && bundle.proxyUrl
        ? { mode: "own", region, url: bundle.proxyUrl }
        : { mode: "bundled", region };
    try {
      const conn = await adapter.reconnectWithCredentials(
        { accountId: row.id, providerAccountId: row.provider_account_id ?? undefined },
        { email: bundle.email, password: bundle.password, totpSecret: bundle.totpSecret },
        proxy,
      );
      await this.db
        .updateTable("sending_accounts")
        .set({ status: "warming", provider_account_id: conn.providerAccountId })
        .where("id", "=", row.id)
        .execute();
      this.logger.log(`Infinite login: auto-reconnected account ${row.id}`);
      return { reconnected: true };
    } catch {
      // A real restriction / changed password — NEVER log details (may echo secrets).
      this.logger.warn(`Infinite login: auto-reconnect failed for account ${row.id}; left for manual reconnect`);
      return { reconnected: false };
    }
  }

  /**
   * Persist (create-or-reconnect-in-place) the workspace's single LinkedIn
   * account from an already-verified provider connection. Shared by the
   * extension/cookie connect flow and the Hosted Auth callback (CLAUDE.md §6):
   * one row per workspace (partial unique index); a reconnect refreshes the
   * existing row and preserves campaign state/history. A session secret is stored
   * only when provided — Hosted Auth has none (Unipile holds the session).
   */
  async finalizeLinkedInAccount(
    workspaceId: string,
    params: {
      providerAccountId: string;
      name: string | null;
      /** Profile photo URL; only written when provided (a reconnect without one
       * keeps the existing photo rather than clobbering it). */
      avatarUrl?: string | null;
      country: string;
      proxy: ProxyConfig;
      connectionMethod: "extension" | "cookie" | "credentials" | "hosted_auth";
      ciphertext?: string | null;
      /** When set, refresh THIS account row (reconnect); else create a new account. */
      reconnectAccountId?: string | null;
      /** Optional human label; only written when provided. */
      label?: string | null;
    },
  ): Promise<AccountView> {
    const { providerAccountId, country, proxy, ciphertext } = params;
    // Always (re)start warming (CLAUDE.md §6) — the ramp cannot be bypassed.
    const accountFields = {
      connection_method: params.connectionMethod,
      name: params.name ?? "LinkedIn account",
      provider_account_id: providerAccountId,
      proxy_type: proxy.mode,
      proxy_region: proxy.region ?? null,
      country,
      location: country,
      status: "warming" as const,
      health_score: 100,
      warmup_state: JSON.stringify(this.initialWarmupState()),
      // Only include when supplied so a photo-less reconnect doesn't wipe an existing one.
      ...(params.avatarUrl !== undefined ? { avatar_url: params.avatarUrl } : {}),
    };

    let previousProviderAccountId: string | null = null;
    const account = await this.db.transaction().execute(async (trx) => {
      // Reconnect targets a SPECIFIC account (multi-account); create inserts new.
      const existing = params.reconnectAccountId
        ? await trx
            .selectFrom("sending_accounts")
            .where("id", "=", params.reconnectAccountId)
            .where("workspace_id", "=", workspaceId)
            .where("type", "=", "linkedin")
            .select(["id", "provider_account_id"])
            .executeTakeFirst()
        : undefined;

      const row = existing
        ? await trx
            .updateTable("sending_accounts")
            .set({ ...accountFields, ...(params.label !== undefined ? { label: params.label } : {}) })
            .where("id", "=", existing.id)
            .where("workspace_id", "=", workspaceId)
            .returning(ACCOUNT_VIEW_COLUMNS)
            .executeTakeFirstOrThrow()
        : await trx
            .insertInto("sending_accounts")
            .values({ workspace_id: workspaceId, type: "linkedin", label: params.label ?? null, ...accountFields })
            .returning(ACCOUNT_VIEW_COLUMNS)
            .executeTakeFirstOrThrow();

      if (existing) {
        previousProviderAccountId = existing.provider_account_id ?? null;
        // Identity switch: the reconnected profile is a DIFFERENT LinkedIn person
        // than the one this row previously held. Their synced inbox + sourced
        // contacts belong to the old profile — clear them so the workspace shows
        // only the new profile's data (Aimfox: switching a profile clears the old
        // one's leads/conversations). A same-identity reconnect (session refresh)
        // keeps everything. Conversations delete cascades their messages; leads
        // delete cascades list membership + campaign state.
        if (previousProviderAccountId && previousProviderAccountId !== providerAccountId) {
          await trx
            .deleteFrom("conversations")
            .where("workspace_id", "=", workspaceId)
            .where("account_id", "=", row.id)
            .execute();
          await trx
            .deleteFrom("leads")
            .where("workspace_id", "=", workspaceId)
            .where("account_id", "=", row.id)
            .execute();
        }
      }

      // Session secret (extension/cookie only). Hosted Auth passes none.
      if (ciphertext) {
        await trx
          .insertInto("sending_account_secrets")
          .values({ account_id: row.id, workspace_id: workspaceId, ciphertext })
          .onConflict((oc) => oc.column("account_id").doUpdateSet({ ciphertext }))
          .execute();
      }

      return row;
    });

    // Best-effort: retire the previous provider-side account on reconnect so we
    // don't leak orphaned provider accounts. Failures here are non-fatal.
    if (previousProviderAccountId && previousProviderAccountId !== providerAccountId) {
      try {
        await this.adapter.disconnectAccount({
          accountId: account.id,
          providerAccountId: previousProviderAccountId,
        });
      } catch {
        this.logger.warn(`Old provider account cleanup failed on reconnect (workspace=${workspaceId})`);
      }
    }

    return this.toView(account);
  }

  async list(workspaceId: string): Promise<AccountView[]> {
    const rows = await this.db
      .selectFrom("sending_accounts")
      .where("workspace_id", "=", workspaceId)
      .select(ACCOUNT_VIEW_COLUMNS)
      .orderBy("created_at", "asc")
      .execute();
    return rows.map((r) => this.toView(r));
  }

  async detail(workspaceId: string, id: string): Promise<AccountView> {
    return this.toView(await this.getRowOr404(workspaceId, id));
  }

  /** Real health: recomputes the score from actions/events, persists it, and
   * surfaces the acceptance-rate auto-throttle now in effect (Phase 7.4). */
  async health(workspaceId: string, id: string): Promise<AccountHealthView> {
    const row = await this.getRowOr404(workspaceId, id);
    const report = await computeAccountHealth(this.db, { workspaceId, accountId: id });
    return {
      accountId: row.id,
      status: row.status,
      healthScore: report.score,
      acceptanceRate: report.acceptanceRate,
      replyRate: report.replyRate,
      actionsToday: report.input.connectionRequestsSent + report.input.messagesSent,
      restrictionEvents: report.input.restrictionEvents,
      throttle: report.throttle,
      signals: report.signals,
      note: report.throttle.throttled
        ? "Acceptance-rate auto-throttle is active — sending caps reduced to protect the account."
        : "Health reflects the last 30 days of activity.",
    };
  }

  /** Disconnect via the adapter, then mark the account disconnected locally. */
  async disconnect(workspaceId: string, id: string): Promise<AccountView> {
    const row = await this.getRowOr404(workspaceId, id);

    try {
      await this.adapter.disconnectAccount({
        accountId: row.id,
        providerAccountId: row.provider_account_id ?? undefined,
      });
    } catch {
      // Provider-side disconnect failures must not strand the account "connected".
      // Reflect the user's intent locally; never log provider error details.
      this.logger.warn(`Provider disconnect failed for account ${id}; marking disconnected locally`);
    }

    const updated = await this.db
      .updateTable("sending_accounts")
      .set({ status: "disconnected" })
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning(ACCOUNT_VIEW_COLUMNS)
      .executeTakeFirstOrThrow();

    this.logger.log(`Disconnected account ${id} (workspace=${workspaceId})`);
    return this.toView(updated);
  }

  /**
   * Permanently REMOVE an account (Aimfox "remove" vs. the non-destructive
   * "disconnect"). Deleting the row cascades its conversations + leads (and their
   * list membership / campaign state); its campaigns are detached (account_id set
   * null by FK) so they stop dispatching. Frees the billing slot.
   */
  async remove(workspaceId: string, id: string): Promise<{ deleted: true; id: string }> {
    const row = await this.getRowOr404(workspaceId, id);
    // Best-effort provider-side cleanup first.
    try {
      await this.adapter.disconnectAccount({
        accountId: row.id,
        providerAccountId: row.provider_account_id ?? undefined,
      });
    } catch {
      this.logger.warn(`Provider disconnect failed while removing account ${id}`);
    }
    await this.db
      .deleteFrom("sending_accounts")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .execute();
    this.logger.log(`Removed account ${id} (workspace=${workspaceId}) — data cascaded`);
    return { deleted: true, id };
  }

  /** Manually pause an account: it stops dispatching within one tick. */
  async pause(workspaceId: string, id: string): Promise<AccountView> {
    await this.getRowOr404(workspaceId, id);
    const updated = await this.db
      .updateTable("sending_accounts")
      .set({ status: "paused" })
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning(ACCOUNT_VIEW_COLUMNS)
      .executeTakeFirstOrThrow();
    this.logger.log(`Paused account ${id} (workspace=${workspaceId})`);
    return this.toView(updated);
  }

  /**
   * Resume a paused account. Returns it to 'warming' (never straight to full
   * volume) — the warm-up ramp is age-based (CLAUDE.md §6), so an account past
   * its ramp window still gets full caps while a new one stays reduced. Refuses
   * to resume a restricted/disconnected account.
   */
  async resume(workspaceId: string, id: string): Promise<AccountView> {
    const row = await this.getRowOr404(workspaceId, id);
    if (row.status === "restricted" || row.status === "disconnected") {
      throw new BadGatewayException(
        `Cannot resume a ${row.status} account — reconnect or resolve the restriction first.`,
      );
    }
    const updated = await this.db
      .updateTable("sending_accounts")
      .set({ status: "warming" })
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning(ACCOUNT_VIEW_COLUMNS)
      .executeTakeFirstOrThrow();
    this.logger.log(`Resumed account ${id} (workspace=${workspaceId})`);
    return this.toView(updated);
  }

  private async getRowOr404(workspaceId: string, id: string) {
    const row = await this.db
      .selectFrom("sending_accounts")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .select([...ACCOUNT_VIEW_COLUMNS, "provider_account_id"])
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException("Account not found");
    }
    return row;
  }

  /**
   * Guard the per-workspace account count against the billing slot allowance
   * before creating a NEW account (reconnects never consume a slot). A workspace
   * with no subscription row gets one free slot. Bypassed by ALLOW_UNLIMITED_ACCOUNTS
   * (dev/self-host). A disconnected account still holds its slot until removed.
   */
  async assertSlotAvailable(workspaceId: string): Promise<void> {
    if (env.ALLOW_UNLIMITED_ACCOUNTS) {
      return;
    }
    // Developer bypass: a workspace owned by a developer-allowlisted email gets
    // unlimited sending accounts (dev / self-host + production testing). Scoped to
    // the owner, so real customers still hit their slot cap.
    if (await isDeveloperWorkspace(this.db, workspaceId)) {
      return;
    }
    const [used, sub] = await Promise.all([
      this.db
        .selectFrom("sending_accounts")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("workspace_id", "=", workspaceId)
        .where("type", "=", "linkedin")
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom("subscriptions")
        .select("slot_count")
        .where("workspace_id", "=", workspaceId)
        .executeTakeFirst(),
    ]);
    const limit = sub?.slot_count ?? 1;
    if (Number(used.count) >= limit) {
      throw new ConflictException(
        `Account limit reached (${limit} slot${limit === 1 ? "" : "s"}). Add a slot in Billing to connect another LinkedIn account.`,
      );
    }
  }

  /**
   * Per-account overrides (multi-account management): rename/label, proxy region,
   * or bundled↔own proxy. Own-proxy URL changes are re-encrypted into the secret
   * bundle. Session (li_at) is NOT changed here — that's a reconnect.
   */
  async update(
    workspaceId: string,
    id: string,
    dto: { label?: string | null; proxyRegion?: string | null },
  ): Promise<AccountView> {
    await this.getRowOr404(workspaceId, id);
    const patch: Record<string, unknown> = {};
    if (dto.label !== undefined) patch.label = dto.label;
    if (dto.proxyRegion !== undefined) patch.proxy_region = dto.proxyRegion;
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException("No fields to update");
    }
    const updated = await this.db
      .updateTable("sending_accounts")
      .set(patch)
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", id)
      .returning(ACCOUNT_VIEW_COLUMNS)
      .executeTakeFirstOrThrow();
    return this.toView(updated);
  }

  /**
   * Minimal warm-up state initialized at connect. The full ramp (reduced → full
   * caps over 4–6 weeks) is the Step 17 state machine; here we only seed it.
   */
  private initialWarmupState(): Record<string, unknown> {
    return { phase: "warming", startedAt: new Date().toISOString() };
  }

  private toView(row: {
    id: string;
    type: AccountView["type"];
    connection_method: AccountView["connection_method"];
    name: string | null;
    label: string | null;
    proxy_type: AccountView["proxy_type"];
    proxy_region: string | null;
    country: string | null;
    location: string | null;
    status: AccountStatus;
    health_score: number;
    warmup_state: unknown;
    avatar_url: string | null;
    created_at: string;
    updated_at: string;
  }): AccountView {
    return {
      id: row.id,
      type: row.type,
      connection_method: row.connection_method,
      name: row.name,
      label: row.label,
      proxy_type: row.proxy_type,
      proxy_region: row.proxy_region,
      country: row.country,
      location: row.location,
      status: row.status,
      health_score: row.health_score,
      warmup_state: row.warmup_state,
      avatar_url: row.avatar_url,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

@UseGuards(WorkspaceScopeGuard)
@Controller("accounts")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(@WorkspaceId() workspaceId: string): Promise<AccountView[]> {
    return this.accounts.list(workspaceId);
  }

  @Post("connect")
  connect(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(connectAccountSchema)) body: ConnectAccountDto,
  ): Promise<ConnectAccountResponse> {
    return this.accounts.connect(workspaceId, body);
  }

  @Get(":id")
  detail(@WorkspaceId() workspaceId: string, @Param("id") id: string): Promise<AccountView> {
    return this.accounts.detail(workspaceId, id);
  }

  @Get(":id/health")
  health(@WorkspaceId() workspaceId: string, @Param("id") id: string): Promise<AccountHealthView> {
    return this.accounts.health(workspaceId, id);
  }

  @Post(":id/disconnect")
  disconnect(@WorkspaceId() workspaceId: string, @Param("id") id: string): Promise<AccountView> {
    return this.accounts.disconnect(workspaceId, id);
  }

  /** Permanently remove the account + its data (cascade). Frees the billing slot. */
  @Delete(":id")
  remove(
    @WorkspaceId() workspaceId: string,
    @Param("id") id: string,
  ): Promise<{ deleted: true; id: string }> {
    return this.accounts.remove(workspaceId, id);
  }

  @Post(":id/pause")
  pause(@WorkspaceId() workspaceId: string, @Param("id") id: string): Promise<AccountView> {
    return this.accounts.pause(workspaceId, id);
  }

  @Post(":id/resume")
  resume(@WorkspaceId() workspaceId: string, @Param("id") id: string): Promise<AccountView> {
    return this.accounts.resume(workspaceId, id);
  }

  /** Per-account overrides: label + proxy region. */
  @Patch(":id")
  update(
    @WorkspaceId() workspaceId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateAccountSchema)) body: UpdateAccountDto,
  ): Promise<AccountView> {
    return this.accounts.update(workspaceId, id, body);
  }
}

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, SecretCipher],
  exports: [AccountsService],
})
export class AccountsModule {}
