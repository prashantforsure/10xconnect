import type { AccountStatus, ChannelError, ChannelErrorCode } from "@10xconnect/core";

import { UnipileHttpError } from "./unipile-client";
import type { UnipileErrorBody } from "./unipile-types";

const RETRIABLE: ReadonlySet<ChannelErrorCode> = new Set([
  "rate_limited",
  "timeout",
  "provider_error",
]);

/**
 * Map a Unipile account-status `message` onto our AccountStatus. Note: Unipile
 * has no LinkedIn-specific "restricted" status — checkpoints/restrictions surface
 * as CREDENTIALS, which we map to `restricted` so the safety auto-pause triggers.
 */
export function mapAccountStatus(message: string): AccountStatus {
  switch (message.toUpperCase()) {
    case "OK":
    case "SYNC_SUCCESS":
    case "RECONNECTED":
    case "CREATION_SUCCESS":
      return "active";
    case "CONNECTING":
      return "warming";
    case "CREDENTIALS":
      return "restricted";
    case "ERROR":
    case "STOPPED":
    case "DELETED":
      return "disconnected";
    default:
      return "disconnected";
  }
}

/** Map a thrown error (UnipileHttpError or network error) onto our ChannelError. */
export function mapHttpError(err: unknown): ChannelError {
  if (err instanceof UnipileHttpError) {
    const body = (typeof err.body === "object" && err.body ? err.body : {}) as UnipileErrorBody;
    const detail = body.detail ?? body.title ?? body.message ?? `HTTP ${err.status}`;
    const code = classify(err.status, body);
    const retryAfterMs = err.retryAfterMs ?? (code === "rate_limited" ? 60_000 : undefined);
    return {
      code,
      message: `unipile: ${detail}`,
      retriable: RETRIABLE.has(code),
      ...(retryAfterMs != null ? { retryAfterMs } : {}),
    };
  }
  const message = err instanceof Error ? err.message : "unknown error";
  const isTimeout = /timeout|aborted|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(message);
  return {
    code: isTimeout ? "timeout" : "provider_error",
    message: `unipile: ${message}`,
    retriable: true,
  };
}

function classify(status: number, body: UnipileErrorBody): ChannelErrorCode {
  const marker = `${body.type ?? ""} ${body.title ?? ""} ${body.detail ?? ""}`.toLowerCase();
  if (/checkpoint|captcha|challenge/.test(marker)) {
    return "captcha_required";
  }
  if (/restrict|blocked|suspend|ban/.test(marker)) {
    return "account_restricted";
  }
  if (status !== 429 && /disconnect|reconnect|credential|session expired/.test(marker)) {
    return "account_disconnected";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 404) {
    return "lead_not_found";
  }
  if (status === 401 || status === 403 || status === 400 || status === 422) {
    return "invalid_request";
  }
  if (status >= 500) {
    return "provider_error";
  }
  return "unknown";
}

/** Map Unipile's network distance string to a numeric connection degree. */
export function mapConnectionDegree(networkDistance?: string): number | undefined {
  if (!networkDistance) {
    return undefined;
  }
  const d = networkDistance.toUpperCase();
  if (d.includes("SELF") || d === "DISTANCE_0") {
    return 0;
  }
  if (d.includes("FIRST") || d === "DISTANCE_1") {
    return 1;
  }
  if (d.includes("SECOND") || d === "DISTANCE_2") {
    return 2;
  }
  if (d.includes("THIRD") || d === "DISTANCE_3") {
    return 3;
  }
  return undefined;
}
