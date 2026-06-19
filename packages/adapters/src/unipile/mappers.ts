import type { AccountStatus, ChannelError, ChannelErrorCode, ProxyConfig } from "@10xconnect/core";

import { UnipileHttpError } from "./unipile-client";
import type { UnipileErrorBody, UnipileProxy } from "./unipile-types";

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

/**
 * Build the proxy-related fields for a Unipile account connect (Unipile LinkedIn
 * docs). Routing the account through an IP that matches the owner's region is the
 * #1 defense against LinkedIn's "impossible travel" logout (CLAUDE.md §6/§14):
 *  - own proxy  → a `proxy` object { host, port, username?, password? }
 *  - bundled    → top-level `country` (ISO alpha-2) so Unipile assigns a
 *                 region-matched residential IP from its managed pool.
 * Returns {} when nothing usable is provided (connect proceeds on Unipile's default).
 */
export function buildConnectProxy(input: { proxy?: ProxyConfig; country?: string }): Record<string, unknown> {
  if (input.proxy?.mode === "own" && input.proxy.url) {
    const proxy = parseProxyUrl(input.proxy.url);
    return proxy ? { proxy } : {};
  }
  const country = isoAlpha2(input.country ?? input.proxy?.region);
  return country ? { country } : {};
}

/**
 * Parse a proxy string into Unipile's proxy object. Accepts a URL
 * (`http://user:pass@host:port`, `socks5://host:port`) or a bare
 * `host:port` / `host:port:user:pass` (common residential-proxy format).
 */
export function parseProxyUrl(raw: string): UnipileProxy | undefined {
  const value = raw.trim();
  if (!value) {
    return undefined;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      const port = Number(u.port);
      if (!u.hostname || !Number.isInteger(port) || port <= 0) {
        return undefined;
      }
      const proxy: UnipileProxy = { host: u.hostname, port };
      if (u.username) proxy.username = decodeURIComponent(u.username);
      if (u.password) proxy.password = decodeURIComponent(u.password);
      return proxy;
    } catch {
      return undefined;
    }
  }
  const parts = value.split(":");
  if (parts.length < 2) {
    return undefined;
  }
  const host = parts[0];
  const port = Number(parts[1]);
  if (!host || !Number.isInteger(port) || port <= 0) {
    return undefined;
  }
  const proxy: UnipileProxy = { host, port };
  if (parts.length >= 4) {
    proxy.username = parts[2];
    proxy.password = parts.slice(3).join(":");
  }
  return proxy;
}

function isoAlpha2(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const v = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : undefined;
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
