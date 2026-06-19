import type { UnipileConfig } from "./unipile-types";

/** Internal error carrying the HTTP status + parsed body for the error mapper. */
export class UnipileHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly retryAfterMs?: number,
  ) {
    super(`Unipile HTTP ${status}`);
    this.name = "UnipileHttpError";
  }
}

/**
 * Thin HTTP client over the Unipile REST API. The API key is sent in the
 * X-API-KEY header and is NEVER logged or included in thrown errors. The DSN may
 * be a bare host:port (scheme is added). Private to the unipile adapter.
 */
export class UnipileClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: UnipileConfig) {
    if (!config.apiKey || !config.dsn) {
      throw new Error("Unipile adapter requires UNIPILE_API_KEY and UNIPILE_DSN");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = normalizeDsn(config.dsn);
  }

  getJson<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value != null) {
          url.searchParams.set(key, value);
        }
      }
    }
    return this.send<T>(url.toString(), { method: "GET", headers: this.headers() });
  }

  postJson<T>(path: string, body: unknown, query?: Record<string, string | undefined>): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value != null) {
          url.searchParams.set(key, value);
        }
      }
    }
    return this.send<T>(url.toString(), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
  }

  postForm<T>(path: string, fields: Record<string, string | string[] | undefined>): Promise<T> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value == null) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          form.append(key, item);
        }
      } else {
        form.append(key, value);
      }
    }
    return this.send<T>(this.baseUrl + path, { method: "POST", headers: this.headers(), body: form });
  }

  del<T>(path: string): Promise<T> {
    return this.send<T>(this.baseUrl + path, { method: "DELETE", headers: this.headers() });
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { "X-API-KEY": this.apiKey, accept: "application/json", ...extra };
  }

  private async send<T>(url: string, init: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    const text = await res.text();
    const data: unknown = text ? safeJsonParse(text) : null;
    if (!res.ok) {
      const retryAfter = res.headers.get("retry-after");
      const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
      throw new UnipileHttpError(
        res.status,
        data,
        retryAfterMs != null && Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
      );
    }
    return data as T;
  }
}

function normalizeDsn(dsn: string): string {
  const trimmed = dsn.trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
