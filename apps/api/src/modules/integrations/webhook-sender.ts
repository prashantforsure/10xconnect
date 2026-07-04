// Pure outbound-webhook send: build the envelope, sign it, POST it. No DB, no
// DI — unit-testable and reused by both the delivery poller and the
// "send test" endpoint. Signing is Stripe-style so receivers can verify
// authenticity AND reject replays:
//
//   X-10xC-Signature: t=<unix-seconds>,v1=<hex hmacSHA256(secret, `${t}.${body}`)>
//
// Legacy webhooks (created before Phase B) have no secret → the header is
// simply omitted; recreate the webhook to get a signing secret.

import { createHmac } from "node:crypto";

export interface EventEnvelope {
  /** integration_events.id — receivers can use it as an idempotency key. */
  id: string;
  type: string;
  created_at: string;
  workspace_id: string;
  data: unknown;
}

export interface WebhookTarget {
  url: string;
  secret: string | null;
  /** Optional user-provided auth header (Aimfox parity), value ALREADY decrypted. */
  authHeaderName?: string | null;
  authHeaderValue?: string | null;
}

export interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export const SIGNATURE_HEADER = "x-10xc-signature";
export const EVENT_HEADER = "x-10xc-event";
export const DELIVERY_ID_HEADER = "x-10xc-delivery-id";

export function signBody(secret: string, timestampSec: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestampSec}.${body}`).digest("hex");
}

/** POST a Block Kit message to a Slack incoming-webhook URL. Never throws. */
export async function postSlack(
  webhookUrl: string,
  message: { text: string; blocks: unknown[] },
  timeoutMs = 10_000,
): Promise<SendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
      signal: controller.signal,
    });
    void res.arrayBuffer().catch(() => {});
    return res.ok
      ? { ok: true, status: res.status }
      : { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (error) {
    const message_ =
      error instanceof Error && error.name === "AbortError"
        ? "timeout"
        : ((error as Error).message ?? "request failed");
    return { ok: false, error: message_.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

/** POST one envelope to one webhook target. Never throws — returns SendResult. */
export async function sendWebhook(
  target: WebhookTarget,
  envelope: EventEnvelope,
  opts: { deliveryId: string; timeoutMs?: number },
): Promise<SendResult> {
  const body = JSON.stringify(envelope);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "10xConnect-Webhooks/1.0",
    [EVENT_HEADER]: envelope.type,
    [DELIVERY_ID_HEADER]: opts.deliveryId,
  };
  if (target.secret) {
    const t = Math.floor(Date.now() / 1000);
    headers[SIGNATURE_HEADER] = `t=${t},v1=${signBody(target.secret, t, body)}`;
  }
  if (target.authHeaderName && target.authHeaderValue) {
    headers[target.authHeaderName.toLowerCase()] = target.authHeaderValue;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
      redirect: "error", // a webhook endpoint should not redirect
    });
    // Drain (bounded) so keep-alive sockets are reusable; body content is ignored.
    void res.arrayBuffer().catch(() => {});
    return res.ok
      ? { ok: true, status: res.status }
      : { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "timeout"
        : ((error as Error).message ?? "request failed");
    return { ok: false, error: message.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}
