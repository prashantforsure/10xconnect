import type { InboundEvent, LeadRef } from "@10xconnect/core";

import { mapAccountStatus } from "./mappers";
import type {
  UnipileAccountStatusWebhook,
  UnipileMessagingWebhook,
  UnipileRelationWebhook,
} from "./unipile-types";

let counter = 0;
function fallbackEventId(): string {
  counter += 1;
  return `unipile-evt-${Date.now()}-${counter}`;
}

/**
 * Normalize a raw Unipile webhook payload into our InboundEvent union, or null if
 * it isn't an event we drive on. Pure + provider-agnostic in its OUTPUT (no
 * Unipile types escape). Handles: account_status, messaging (message_received →
 * reply, message_read → message_opened), and relations (→ invite_accepted).
 *
 * Unipile includes the account's OWN sent messages in message_received, so we
 * drop events where sender == account owner (only true inbound replies pass).
 */
export function normalizeWebhook(raw: unknown): InboundEvent | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;

  // account_status: { AccountStatus: { account_id, message } }
  if ("AccountStatus" in obj) {
    const payload = (raw as UnipileAccountStatusWebhook).AccountStatus;
    if (!payload?.account_id || !payload.message) {
      return null;
    }
    return {
      id: fallbackEventId(),
      type: "account_status_changed",
      accountId: payload.account_id,
      channel: "linkedin",
      occurredAt: new Date().toISOString(),
      status: mapAccountStatus(payload.message),
    };
  }

  // messaging: event starts with "message"
  if (typeof obj.event === "string" && obj.event.startsWith("message") && typeof obj.account_id === "string") {
    const w = raw as UnipileMessagingWebhook;
    const occurredAt = w.timestamp ?? new Date().toISOString();
    const lead: LeadRef = { providerId: w.sender?.attendee_provider_id };

    if (w.event === "message_received") {
      const senderId = w.sender?.attendee_provider_id;
      const ownerId = w.account_info?.user_id;
      if (senderId && ownerId && senderId === ownerId) {
        return null; // the account's own outbound message — not a reply
      }
      return {
        id: w.message_id ?? fallbackEventId(),
        type: "reply",
        accountId: w.account_id,
        channel: "linkedin",
        occurredAt,
        lead,
        message: {
          providerMessageId: w.message_id,
          direction: "inbound",
          channel: "linkedin",
          body: w.message,
          sentAt: occurredAt,
        },
      };
    }

    if (w.event === "message_read") {
      return {
        id: w.message_id ?? fallbackEventId(),
        type: "message_opened",
        accountId: w.account_id,
        channel: "linkedin",
        occurredAt,
        lead,
      };
    }

    return null; // message_reaction / message_edited / etc. — not driven on yet
  }

  // relations: a new connection (invitation accepted). Payload shape is not fully
  // documented; read defensively.
  if (obj.event === "new_relation" || "user_provider_id" in obj || "user_public_identifier" in obj) {
    const w = raw as UnipileRelationWebhook;
    if (!w.account_id) {
      return null;
    }
    const publicId = w.user_public_identifier;
    return {
      id: fallbackEventId(),
      type: "invite_accepted",
      accountId: w.account_id,
      channel: "linkedin",
      occurredAt: w.timestamp ?? new Date().toISOString(),
      lead: {
        providerId: w.user_provider_id ?? w.provider_id,
        linkedinUrl: publicId ? `https://www.linkedin.com/in/${publicId}` : undefined,
      },
    };
  }

  return null;
}
