import { randomUUID } from "node:crypto";

import { env } from "@10xconnect/config";
import { type HostedAuthCallback, isHostedAuthCapable, type ProxyConfig } from "@10xconnect/core";
import type { DB } from "@10xconnect/db";
import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Post,
  Query,
  Redirect,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Kysely } from "kysely";
import { z } from "zod";

import { CHANNEL_ADAPTER } from "../adapter/channel-adapter.module";
import { Public } from "../common/decorators/public.decorator";
import { WorkspaceId } from "../common/decorators/workspace-id.decorator";
import { WebhookSecretGuard } from "../common/guards/webhook-secret.guard";
import { WorkspaceScopeGuard } from "../common/guards/workspace-scope.guard";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { KYSELY_DB } from "../database/database.module";

import { AccountsModule, AccountsService } from "./accounts.module";

// Country is optional — defaults to the existing account's region (reconnect) or
// "US". The hosted flow always uses a region-matched BUNDLED proxy (own-proxy is
// kept to the extension/cookie paths), so there are no secrets in this request.
const hostedAuthSchema = z.object({
  country: z.string().trim().min(2).max(64).optional(),
  /** When set, reconnect THIS account (multi-account); else connect a new one. */
  reconnectAccountId: z.string().uuid().optional(),
});
type HostedAuthDto = z.infer<typeof hostedAuthSchema>;

const LINK_TTL_MS = 15 * 60_000;

@Injectable()
export class HostedAuthService {
  private readonly logger = new Logger(HostedAuthService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    @Inject(CHANNEL_ADAPTER) private readonly adapter: unknown,
    private readonly accounts: AccountsService,
  ) {}

  /**
   * Start the Hosted Auth flow: record a pending request keyed by a one-time
   * token, ask the provider for a hosted login link (carrying that token as
   * `name`), and return the URL for the browser to open.
   */
  async createLink(workspaceId: string, dto: HostedAuthDto): Promise<{ url: string; expiresAt: string }> {
    if (!isHostedAuthCapable(this.adapter)) {
      throw new ServiceUnavailableException(
        "Hosted auth is not available on the active transport adapter",
      );
    }

    // Multi-account: reconnect targets a SPECIFIC account; otherwise create a new
    // one (which consumes a billing slot, gated the same way as extension connect).
    const existing = dto.reconnectAccountId
      ? await this.db
          .selectFrom("sending_accounts")
          .select(["id", "provider_account_id", "country"])
          .where("workspace_id", "=", workspaceId)
          .where("type", "=", "linkedin")
          .where("id", "=", dto.reconnectAccountId)
          .executeTakeFirst()
      : undefined;
    if (dto.reconnectAccountId && !existing) {
      throw new NotFoundException("Account not found");
    }
    if (!existing) {
      await this.accounts.assertSlotAvailable(workspaceId);
    }

    const type = existing ? "reconnect" : "create";
    const country = (dto.country ?? existing?.country ?? "US").trim().toUpperCase();
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();

    await this.db
      .insertInto("account_link_requests")
      .values({
        workspace_id: workspaceId,
        token,
        type,
        reconnect_provider_account_id: existing?.provider_account_id ?? null,
        reconnect_account_id: existing?.id ?? null,
        country,
        status: "pending",
        expires_at: expiresAt,
      })
      .execute();

    const apiBase = env.API_PUBLIC_URL.replace(/\/+$/, "");
    const appBase = env.APP_URL.replace(/\/+$/, "");
    // Carry the shared webhook secret on the notify_url so the callback can be
    // authenticated (WebhookSecretGuard). No-op when WEBHOOK_SECRET is unset.
    const secretQs = env.WEBHOOK_SECRET ? `?secret=${encodeURIComponent(env.WEBHOOK_SECRET)}` : "";
    const link = await this.adapter.createHostedAuthLink({
      type,
      reconnectProviderAccountId: existing?.provider_account_id ?? undefined,
      name: token,
      successRedirectUrl: `${appBase}/connect/callback?status=success`,
      failureRedirectUrl: `${appBase}/connect/callback?status=failure`,
      notifyUrl: `${apiBase}/api/v1/webhooks/hosted/unipile${secretQs}`,
      expiresAt,
    });

    this.logger.log(`Hosted-auth ${type} link issued (workspace=${workspaceId})`);
    return { url: link.url, expiresAt: link.expiresAt };
  }

  /** Parse + finalize a provider hosted-auth callback (the notify_url webhook). */
  async handleCallback(body: unknown): Promise<void> {
    if (!isHostedAuthCapable(this.adapter)) {
      return;
    }
    const parsed = this.adapter.parseHostedAuthCallback(body);
    if (!parsed) {
      this.logger.warn("Unrecognized hosted-auth callback payload — ignored");
      return;
    }
    await this.complete(parsed);
  }

  /**
   * Finalize a completed hosted-auth flow: match the one-time token back to its
   * workspace and save the connected account. Idempotent — a replayed callback
   * (Unipile may retry) finds the request already 'completed' and no-ops.
   * The provider's CREATION_SUCCESS / RECONNECTED is itself the confirmation the
   * account is connected, so we trust it and let finalize seed warm-up state.
   */
  async complete(callback: HostedAuthCallback): Promise<void> {
    const request = await this.db
      .selectFrom("account_link_requests")
      .selectAll()
      .where("token", "=", callback.name)
      .where("status", "=", "pending")
      .executeTakeFirst();
    if (!request) {
      this.logger.warn("Hosted-auth callback for unknown or non-pending token — ignored");
      return;
    }
    if (new Date(request.expires_at).getTime() < Date.now()) {
      await this.db
        .updateTable("account_link_requests")
        .set({ status: "expired" })
        .where("id", "=", request.id)
        .execute();
      this.logger.warn("Hosted-auth callback for an expired token — ignored");
      return;
    }

    const proxy: ProxyConfig = { mode: "bundled", region: request.country };
    await this.accounts.finalizeLinkedInAccount(request.workspace_id, {
      providerAccountId: callback.providerAccountId,
      name: null,
      country: request.country,
      proxy,
      connectionMethod: "hosted_auth",
      reconnectAccountId: request.reconnect_account_id ?? null,
    });

    await this.db
      .updateTable("account_link_requests")
      .set({ status: "completed" })
      .where("id", "=", request.id)
      .execute();

    this.logger.log(`Hosted-auth ${callback.status} account (workspace=${request.workspace_id})`);
  }
}

@Controller()
export class HostedAuthController {
  constructor(private readonly hosted: HostedAuthService) {}

  /** Start the flow → returns the hosted login URL for the browser to open. */
  @UseGuards(WorkspaceScopeGuard)
  @Post("accounts/hosted-auth")
  createLink(
    @WorkspaceId() workspaceId: string,
    @Body(new ZodValidationPipe(hostedAuthSchema)) body: HostedAuthDto,
  ): Promise<{ url: string; expiresAt: string }> {
    return this.hosted.createLink(workspaceId, body);
  }

  /** Provider notify_url callback — public; always 200 fast (Unipile retries otherwise).
   * Authenticated by the shared webhook secret; exempt from rate limiting so
   * provider retries are never dropped. */
  @Public()
  @SkipThrottle()
  @UseGuards(WebhookSecretGuard)
  @Post("webhooks/hosted/unipile")
  async callback(@Body() body: unknown): Promise<{ received: true }> {
    await this.hosted.handleCallback(body);
    return { received: true };
  }

  /**
   * Dev-only completion route (mock adapter): the simulated hosted page opens
   * this, which fires the same finalize the real notify_url would, then redirects
   * the popup back to the app. Disabled in production.
   */
  @Public()
  @Get("dev/hosted-auth/complete")
  @Redirect()
  async devComplete(
    @Query("token") token?: string,
    @Query("type") type?: string,
    @Query("redirect") redirect?: string,
  ): Promise<{ url: string }> {
    if (env.NODE_ENV === "production") {
      throw new NotFoundException();
    }
    if (token) {
      await this.hosted.complete({
        providerAccountId: `mock-hosted-${randomUUID().slice(0, 8)}`,
        name: token,
        status: type === "reconnect" ? "reconnected" : "created",
      });
    }
    const appBase = env.APP_URL.replace(/\/+$/, "");
    const target =
      redirect && redirect.startsWith(appBase) ? redirect : `${appBase}/connect/callback?status=success`;
    return { url: target };
  }
}

@Module({
  imports: [AccountsModule],
  controllers: [HostedAuthController],
  providers: [HostedAuthService],
})
export class HostedAuthModule {}
