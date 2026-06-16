/**
 * Implemented by adapters that ingest provider webhooks (e.g. Unipile). The API's
 * inbound webhook controller calls ingestWebhook with the raw parsed body; the
 * adapter normalizes it into an InboundEvent and emits it to subscribers. The
 * payload is `unknown` so NO provider types cross the package boundary.
 */
export interface InboundWebhookReceiver {
  ingestWebhook(payload: unknown): Promise<void>;
}

export function isInboundWebhookReceiver(value: unknown): value is InboundWebhookReceiver {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { ingestWebhook?: unknown }).ingestWebhook === "function"
  );
}
