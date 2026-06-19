import type {
  AccountConnection,
  AccountRef,
  AccountStatus,
  ChannelAdapter,
  ConnectInput,
  ProxyConfig,
} from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  NotImplementedException,
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
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

// --- DTOs ------------------------------------------------------------------

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
    url: z.string().trim().min(1).max(2048),
  }),
]);

// Connect contract: the LinkedIn `li_at` session cookie + the matching browser
// user-agent. Two sources of that same payload (both go through the identical,
// verified cookie transport):
//   - "extension" — the browser extension captures the session from the user's
//     logged-in tab (the product method; CLAUDE.md §6).
//   - "cookie"    — the user pastes their li_at manually (a testing affordance,
//     gated to non-production in the UI). NOT email/password — a server-side
//     datacenter login is a top cause of the repeated-logout loop (§6/§14) and
//     stays removed.
// We validate the session with the transport provider and re-check status before
// persisting, so an expired/challenged session is rejected, never saved live.
const connectAccountSchema = z.object({
  method: z.enum(["extension", "cookie"]).default("extension"),
  /** ISO country of the account — proxy + session are matched to it. */
  country: z.string().trim().min(2).max(64),
  /** Optional display email the extension can supply. */
  email: z.string().trim().email().max(255).optional(),
  /** Captured/pasted LinkedIn `li_at` session cookie. SECRET — never logged; encrypted at rest. */
  liAt: z.string().trim().min(20).max(8192),
  /**
   * Browser user-agent paired with the cookie. Required: matching it (together
   * with a region proxy) is what stops LinkedIn from logging the account out
   * (§6/§14). It MUST be the user-agent of the browser the li_at was taken from.
   */
  userAgent: z.string().trim().min(1).max(512),
  proxy: proxySchema.default({ mode: "bundled" }),
});
type ConnectAccountDto = z.infer<typeof connectAccountSchema>;

// --- Views (no secrets, no provider handles) -------------------------------

export interface AccountView {
  id: string;
  type: "linkedin" | "mailbox";
  connection_method: "extension" | "credentials" | "cookie" | "hosted_auth" | null;
  name: string | null;
  proxy_type: "bundled" | "own" | null;
  proxy_region: string | null;
  country: string | null;
  location: string | null;
  status: AccountStatus;
  health_score: number;
  warmup_state: unknown;
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

export interface ConnectAccountResponse {
  account: AccountView;
  guidance: ConnectionGuidance;
}

export interface AccountHealthView {
  accountId: string;
  status: AccountStatus;
  healthScore: number;
  // Real metrics are computed by the account-health monitor in Phase 4 (Step 20).
  acceptanceRate: number | null;
  replyRate: number | null;
  actionsToday: number | null;
  restrictionEvents: number;
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
  "proxy_type",
  "proxy_region",
  "country",
  "location",
  "status",
  "health_score",
  "warmup_state",
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

    const proxy: ProxyConfig =
      dto.proxy.mode === "own"
        ? { mode: "own", region: dto.proxy.region ?? dto.country, url: dto.proxy.url }
        : { mode: "bundled", region: dto.proxy.region ?? dto.country };

    // Build the adapter input + the encrypted-at-rest secret bundle. Both methods
    // carry the li_at session + the matching user-agent; we feed both to the
    // transport (which handles extension/cookie identically) and persist them
    // encrypted so a reconnect can re-verify. The user-agent is always forwarded
    // — it's the logout defense (§6/§14).
    const proxyExtra = proxy.mode === "own" && proxy.url ? { proxyUrl: proxy.url } : {};
    const input: ConnectInput = {
      method: dto.method,
      country: dto.country,
      proxy,
      cookie: { liAt: dto.liAt, userAgent: dto.userAgent },
    };
    const secretBundle: Record<string, unknown> = {
      method: dto.method,
      liAt: dto.liAt,
      userAgent: dto.userAgent,
      ...proxyExtra,
    };
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
      country: dto.country,
      proxy,
      connectionMethod: dto.method,
      ciphertext,
    });

    this.logger.log(`Connected ${dto.method} account ${account.id} (workspace=${workspaceId})`);
    return {
      account,
      guidance: dto.method === "cookie" ? COOKIE_GUIDANCE : EXTENSION_GUIDANCE,
    };
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
      country: string;
      proxy: ProxyConfig;
      connectionMethod: "extension" | "cookie" | "hosted_auth";
      ciphertext?: string | null;
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
    };

    let previousProviderAccountId: string | null = null;
    const account = await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom("sending_accounts")
        .where("workspace_id", "=", workspaceId)
        .where("type", "=", "linkedin")
        .select(["id", "provider_account_id"])
        .executeTakeFirst();

      const row = existing
        ? await trx
            .updateTable("sending_accounts")
            .set(accountFields)
            .where("id", "=", existing.id)
            .where("workspace_id", "=", workspaceId)
            .returning(ACCOUNT_VIEW_COLUMNS)
            .executeTakeFirstOrThrow()
        : await trx
            .insertInto("sending_accounts")
            .values({ workspace_id: workspaceId, type: "linkedin", ...accountFields })
            .returning(ACCOUNT_VIEW_COLUMNS)
            .executeTakeFirstOrThrow();

      if (existing) {
        previousProviderAccountId = existing.provider_account_id ?? null;
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

  /** Stub health: reflects current persisted status; real scoring is Step 20. */
  async health(workspaceId: string, id: string): Promise<AccountHealthView> {
    const row = await this.getRowOr404(workspaceId, id);
    return {
      accountId: row.id,
      status: row.status,
      healthScore: row.health_score,
      acceptanceRate: null,
      replyRate: null,
      actionsToday: null,
      restrictionEvents: 0,
      note: "Health metrics are stubbed; acceptance/reply rates + scoring land in Phase 4 (Step 20).",
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
    proxy_type: AccountView["proxy_type"];
    proxy_region: string | null;
    country: string | null;
    location: string | null;
    status: AccountStatus;
    health_score: number;
    warmup_state: unknown;
    created_at: string;
    updated_at: string;
  }): AccountView {
    return {
      id: row.id,
      type: row.type,
      connection_method: row.connection_method,
      name: row.name,
      proxy_type: row.proxy_type,
      proxy_region: row.proxy_region,
      country: row.country,
      location: row.location,
      status: row.status,
      health_score: row.health_score,
      warmup_state: row.warmup_state,
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

  @Post(":id/pause")
  pause(@WorkspaceId() workspaceId: string, @Param("id") id: string): Promise<AccountView> {
    return this.accounts.pause(workspaceId, id);
  }

  @Post(":id/resume")
  resume(@WorkspaceId() workspaceId: string, @Param("id") id: string): Promise<AccountView> {
    return this.accounts.resume(workspaceId, id);
  }

  // PATCH update (proxy/schedule overrides) lands with per-account overrides (later).
  @Patch(":id")
  update(@Param("id") _id: string): never {
    throw new NotImplementedException();
  }
}

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, SecretCipher],
  exports: [AccountsService],
})
export class AccountsModule {}
