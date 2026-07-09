// Outbound delivery poller (integrations Phase B). Consumes the engine's
// integration_events outbox and delivers to the workspace's targets:
//
//   fan-out : unprocessed events → one webhook_deliveries row per matching
//             active webhook (Phase C adds Slack connections) → processed_at.
//   deliver : claim due pending deliveries (FOR UPDATE SKIP LOCKED — safe if a
//             second API instance ever runs), POST the signed envelope, and on
//             failure back off [30s, 5m, 30m, 2h, 6h, 15h] (≈ 6 retries / 24h)
//             before going terminal `failed`. 20 consecutive failures disable
//             the webhook + raise an in-app notification.
//   prune   : delete deliveries + processed events older than 30 days.
//
// Mirrors the ContinuousImportService in-process poller pattern (BullMQ is the
// future swap behind the same seam). HTTP happens OUTSIDE any transaction.

import { env } from "@10xconnect/config";
import type { DB, DeliveryStatus } from "@10xconnect/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { type Kysely, sql } from "kysely";

import { SecretCipher } from "../../common/crypto/secret-cipher";
import { KYSELY_DB } from "../../database/database.module";

import { formatSlackMessage } from "./slack-format";
import { postSlack, sendWebhook, type EventEnvelope, type SendResult } from "./webhook-sender";

/** Retry backoff after each failed attempt; exhausted → terminal `failed`. */
export const RETRY_BACKOFF_MS = [
  30_000, // 30s
  5 * 60_000, // 5m
  30 * 60_000, // 30m
  2 * 3_600_000, // 2h
  6 * 3_600_000, // 6h
  15 * 3_600_000, // 15h  (cumulative ≈ 23.6h)
] as const;

/** Consecutive failed attempts before a webhook is auto-disabled. */
export const DISABLE_AFTER_CONSECUTIVE_FAILURES = 20;

const FANOUT_BATCH = 50;
const DELIVER_BATCH = 25;
const RETENTION_DAYS = 30;
const REQUEST_TIMEOUT_MS = 10_000;
/** Claimed rows are pushed this far out so a crash mid-flight can't spin-loop. */
const CLAIM_LEASE_MS = 120_000;

interface ClaimedDelivery {
  id: string;
  workspace_id: string;
  event_id: string;
  target_kind: string;
  webhook_id: string | null;
  connection_id: string | null;
  event_type: string;
  attempt: number;
}

@Injectable()
export class DeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("IntegrationsDelivery");
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    private readonly cipher: SecretCipher,
  ) {}

  onModuleInit(): void {
    if (!env.INTEGRATIONS_DELIVERY_ENABLED) {
      this.logger.log("Outbound delivery poller disabled (INTEGRATIONS_DELIVERY_ENABLED=false).");
      return;
    }
    this.timer = setInterval(() => void this.tick(), env.INTEGRATIONS_DELIVERY_TICK_MS);
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
    this.logger.log(
      `Outbound delivery poller started (${env.INTEGRATIONS_DELIVERY_TICK_MS}ms interval).`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /** One poller pass: fan-out → deliver → prune. Public for tests. */
  async tick(): Promise<void> {
    if (this.running) {
      return; // never overlap ticks
    }
    this.running = true;
    try {
      await this.fanOut();
      await this.deliverDue();
      await this.prune();
    } catch (err) {
      this.logger.error(`Delivery tick failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /** Unprocessed events → delivery rows for every matching active target. */
  async fanOut(): Promise<number> {
    const events = await this.db
      .selectFrom("integration_events")
      .select(["id", "workspace_id", "type"])
      .where("processed_at", "is", null)
      .orderBy("created_at")
      .limit(FANOUT_BATCH)
      .execute();
    if (events.length === 0) {
      return 0;
    }

    const workspaceIds = [...new Set(events.map((e) => e.workspace_id))];
    const hooks = await this.db
      .selectFrom("webhooks")
      .select(["id", "workspace_id", "events"])
      .where("workspace_id", "in", workspaceIds)
      .where("status", "=", "active")
      .execute();

    let created = 0;
    for (const event of events) {
      const targets = hooks.filter(
        (h) => h.workspace_id === event.workspace_id && h.events.includes(event.type),
      );
      for (const hook of targets) {
        const inserted = await this.db
          .insertInto("webhook_deliveries")
          .values({
            workspace_id: event.workspace_id,
            event_id: event.id,
            target_kind: "webhook",
            webhook_id: hook.id,
            event_type: event.type,
          })
          // Any unique violation (event × webhook already fanned out) is a no-op.
          .onConflict((oc) => oc.doNothing())
          .returning("id")
          .executeTakeFirst();
        if (inserted) {
          created += 1;
        }
      }
      await this.fanOutConnections(event);
      await this.db
        .updateTable("integration_events")
        .set({ processed_at: new Date().toISOString() })
        .where("id", "=", event.id)
        .execute();
    }
    if (created > 0) {
      this.logger.log(`Fanned out ${created} deliver${created === 1 ? "y" : "ies"}.`);
    }
    return created;
  }

  /** Fan an event out to active integration connections (Slack URL-paste). */
  protected async fanOutConnections(event: {
    id: string;
    workspace_id: string;
    type: string;
  }): Promise<void> {
    const connections = await this.db
      .selectFrom("integration_connections")
      .select(["id", "events"])
      .where("workspace_id", "=", event.workspace_id)
      .where("status", "=", "active")
      .execute();
    for (const connection of connections) {
      if (!connection.events.includes(event.type)) {
        continue;
      }
      await this.db
        .insertInto("webhook_deliveries")
        .values({
          workspace_id: event.workspace_id,
          event_id: event.id,
          target_kind: "slack",
          connection_id: connection.id,
          event_type: event.type,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  }

  /** Claim due deliveries (SKIP LOCKED) and POST them outside the transaction. */
  async deliverDue(): Promise<number> {
    const leaseIso = new Date(Date.now() + CLAIM_LEASE_MS).toISOString();

    const claimed = await this.db.transaction().execute(async (trx) => {
      const due = await trx
        .selectFrom("webhook_deliveries")
        .select("id")
        .where("status", "=", "pending")
        // Compare against the DB clock, not the app-server clock: rows are stamped
        // with `next_attempt_at default now()` (DB time). A client-side `new Date()`
        // that lags the DB by even ~1s would treat a just-fanned-out row as "not yet
        // due" and skip it until a later tick — up to a full poll interval of extra
        // latency on every fresh delivery under clock skew.
        .where("next_attempt_at", "<=", sql<string>`now()`)
        .orderBy("next_attempt_at")
        .limit(DELIVER_BATCH)
        .forUpdate()
        .skipLocked()
        .execute();
      if (due.length === 0) {
        return [] as ClaimedDelivery[];
      }
      return (await trx
        .updateTable("webhook_deliveries")
        .set({ attempt: sql`attempt + 1`, next_attempt_at: leaseIso })
        .where(
          "id",
          "in",
          due.map((d) => d.id),
        )
        .returning([
          "id",
          "workspace_id",
          "event_id",
          "target_kind",
          "webhook_id",
          "connection_id",
          "event_type",
          "attempt",
        ])
        .execute()) as ClaimedDelivery[];
    });

    for (const delivery of claimed) {
      await this.deliverOne(delivery);
    }
    return claimed.length;
  }

  private async deliverOne(delivery: ClaimedDelivery): Promise<void> {
    const event = await this.db
      .selectFrom("integration_events")
      .select(["id", "type", "payload", "created_at", "workspace_id"])
      .where("id", "=", delivery.event_id)
      .executeTakeFirst();
    if (!event) {
      await this.finish(delivery.id, "failed", { ok: false, error: "event row missing" });
      return;
    }
    const envelope: EventEnvelope = {
      id: event.id,
      type: event.type,
      created_at: event.created_at,
      workspace_id: event.workspace_id,
      data: event.payload,
    };

    if (delivery.target_kind === "webhook" && delivery.webhook_id) {
      await this.deliverToWebhook(delivery, envelope);
      return;
    }
    if (delivery.target_kind === "slack" && delivery.connection_id) {
      await this.deliverToConnection(delivery, envelope);
      return;
    }
    await this.finish(delivery.id, "failed", { ok: false, error: "unknown delivery target" });
  }

  private async deliverToWebhook(
    delivery: ClaimedDelivery,
    envelope: EventEnvelope,
  ): Promise<void> {
    const hook = await this.db
      .selectFrom("webhooks")
      .select(["id", "url", "secret", "auth_header_name", "auth_header_value", "status", "consecutive_failures"])
      .where("id", "=", delivery.webhook_id!)
      .executeTakeFirst();
    if (!hook || hook.status !== "active") {
      await this.finish(delivery.id, "failed", { ok: false, error: "webhook removed or disabled" });
      return;
    }

    let authHeaderValue: string | null = null;
    if (hook.auth_header_name && hook.auth_header_value) {
      try {
        authHeaderValue = this.cipher.decrypt(hook.auth_header_value);
      } catch {
        this.logger.warn(`Webhook ${hook.id}: could not decrypt auth header — sending without it.`);
      }
    }

    const result = await sendWebhook(
      {
        url: hook.url,
        secret: hook.secret,
        authHeaderName: hook.auth_header_name,
        authHeaderValue,
      },
      envelope,
      { deliveryId: delivery.id, timeoutMs: REQUEST_TIMEOUT_MS },
    );

    if (result.ok) {
      await this.finish(delivery.id, "delivered", result);
      await this.db
        .updateTable("webhooks")
        .set({ consecutive_failures: 0 })
        .where("id", "=", hook.id)
        .execute();
      return;
    }

    await this.recordFailure(delivery, result);
    const failures = hook.consecutive_failures + 1;
    if (failures >= DISABLE_AFTER_CONSECUTIVE_FAILURES) {
      await this.db
        .updateTable("webhooks")
        .set({ status: "disabled", consecutive_failures: failures })
        .where("id", "=", hook.id)
        .execute();
      await this.db
        .insertInto("notifications")
        .values({
          workspace_id: delivery.workspace_id,
          type: "webhook_disabled",
          title: "A webhook was disabled after repeated failures",
          body: `Deliveries to ${hook.url} kept failing (${failures} consecutive errors). Fix the endpoint, then re-enable the webhook in Settings → Webhooks.`,
        })
        .execute();
      this.logger.warn(`Webhook ${hook.id} auto-disabled after ${failures} consecutive failures.`);
    } else {
      await this.db
        .updateTable("webhooks")
        .set({ consecutive_failures: failures })
        .where("id", "=", hook.id)
        .execute();
    }
  }

  /** Deliver to an integration connection: Slack incoming-webhook POST. */
  protected async deliverToConnection(
    delivery: ClaimedDelivery,
    envelope: EventEnvelope,
  ): Promise<void> {
    const connection = await this.db
      .selectFrom("integration_connections")
      .select(["id", "provider", "status", "config"])
      .where("id", "=", delivery.connection_id!)
      .executeTakeFirst();
    if (!connection || connection.status !== "active" || connection.provider !== "slack") {
      await this.finish(delivery.id, "failed", {
        ok: false,
        error: "connection removed or disabled",
      });
      return;
    }

    const config = (connection.config ?? {}) as { webhook_url_enc?: string };
    let webhookUrl: string | null = null;
    if (config.webhook_url_enc) {
      try {
        webhookUrl = this.cipher.decrypt(config.webhook_url_enc);
      } catch {
        // fall through — treated as a hard failure below
      }
    }
    if (!webhookUrl) {
      await this.finish(delivery.id, "failed", {
        ok: false,
        error: "Slack webhook URL missing or undecryptable",
      });
      return;
    }

    const result = await postSlack(webhookUrl, formatSlackMessage(envelope));
    if (result.ok) {
      await this.finish(delivery.id, "delivered", result);
      return;
    }
    // 404/410 = the incoming webhook was revoked in Slack → disable + notify.
    if (result.status === 404 || result.status === 410) {
      await this.finish(delivery.id, "failed", result);
      await this.db
        .updateTable("integration_connections")
        .set({ status: "disabled" })
        .where("id", "=", connection.id)
        .execute();
      await this.db
        .insertInto("notifications")
        .values({
          workspace_id: delivery.workspace_id,
          type: "slack_disconnected",
          title: "Slack notifications stopped",
          body: "Your Slack webhook URL was revoked or removed. Reconnect Slack in Settings → Integrations.",
        })
        .execute();
      this.logger.warn(`Slack connection ${connection.id} disabled (webhook revoked).`);
      return;
    }
    await this.recordFailure(delivery, result);
  }

  /** Terminal write for one attempt: delivered, retry-scheduled, or failed. */
  private async recordFailure(delivery: ClaimedDelivery, result: SendResult): Promise<void> {
    // delivery.attempt counts STARTED attempts (incremented at claim); attempt N
    // failing schedules retry N via RETRY_BACKOFF_MS[N-1], exhausted → failed.
    const backoff = RETRY_BACKOFF_MS[delivery.attempt - 1];
    if (backoff === undefined) {
      await this.finish(delivery.id, "failed", result);
      return;
    }
    await this.db
      .updateTable("webhook_deliveries")
      .set({
        status: "pending",
        response_code: result.status ?? null,
        error: result.error ?? null,
        next_attempt_at: new Date(Date.now() + backoff).toISOString(),
      })
      .where("id", "=", delivery.id)
      .execute();
  }

  private async finish(
    deliveryId: string,
    status: Extract<DeliveryStatus, "delivered" | "failed">,
    result: SendResult,
  ): Promise<void> {
    await this.db
      .updateTable("webhook_deliveries")
      .set({
        status,
        response_code: result.status ?? null,
        error: result.error ?? null,
        ...(status === "delivered" ? { delivered_at: new Date().toISOString() } : {}),
      })
      .where("id", "=", deliveryId)
      .execute();
  }

  /** Retention: drop delivery/event rows older than RETENTION_DAYS (batched). */
  async prune(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
    await this.db
      .deleteFrom("webhook_deliveries")
      .where("id", "in", (qb) =>
        qb
          .selectFrom("webhook_deliveries")
          .select("id")
          .where("created_at", "<", cutoff)
          .limit(1000),
      )
      .execute();
    // Old processed events cascade any leftover deliveries (FK on delete cascade);
    // retries max out within ~24h so nothing pending survives to the cutoff.
    await this.db
      .deleteFrom("integration_events")
      .where("id", "in", (qb) =>
        qb
          .selectFrom("integration_events")
          .select("id")
          .where("processed_at", "is not", null)
          .where("created_at", "<", cutoff)
          .limit(1000),
      )
      .execute();
  }
}
