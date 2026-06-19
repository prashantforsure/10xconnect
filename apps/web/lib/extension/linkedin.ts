// Bridge to the 10xConnect browser extension (apps/extension).
//
// The extension is the ONLY way to connect a LinkedIn account (CLAUDE.md §6). It
// reads the HttpOnly `li_at` session cookie from the user's logged-in LinkedIn
// tab — which the web page itself cannot read (cross-origin + HttpOnly) — and
// hands it back to this origin only. The page then sends it (plus the browser's
// own user-agent) to the API's `POST /accounts/connect`. No long-lived secret
// ever lives in the extension, and only our origin can talk to it (the content
// script is injected solely on the app origin).
//
// Protocol: page → window.postMessage({ source: APP_SOURCE, ... }); the content
// script replies window.postMessage({ source: EXT_SOURCE, ... }) on the same
// window, correlated by a nonce.

const APP_SOURCE = "10xconnect-app";
const EXT_SOURCE = "10xconnect-ext";

/**
 * Chrome Web Store listing URL for the 10xConnect extension. Set
 * NEXT_PUBLIC_EXTENSION_STORE_URL to the published listing URL; until the listing
 * is live this falls back to the store homepage so the "Add to Chrome" CTA still
 * points somewhere sensible.
 */
export const EXTENSION_STORE_URL =
  process.env.NEXT_PUBLIC_EXTENSION_STORE_URL ?? "https://chromewebstore.google.com/";

export type ExtensionErrorCode = "not_installed" | "not_logged_in" | "capture_failed";

export class ExtensionError extends Error {
  readonly code: ExtensionErrorCode;
  constructor(code: ExtensionErrorCode, message: string) {
    super(message);
    this.name = "ExtensionError";
    this.code = code;
  }
}

interface ExtMessage {
  source: typeof EXT_SOURCE;
  type: string;
  nonce: string;
  ok?: boolean;
  liAt?: string;
  code?: ExtensionErrorCode;
  message?: string;
}

function isExtMessage(data: unknown, nonce: string): data is ExtMessage {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const d = data as Record<string, unknown>;
  return d.source === EXT_SOURCE && d.nonce === nonce;
}

function newNonce(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Send one request to the extension and await the matching reply (by nonce), or
 * reject with ExtensionError("not_installed") on timeout (no content script to
 * answer). Used by both detect() and capture().
 */
function request(type: string, timeoutMs: number): Promise<ExtMessage> {
  return new Promise<ExtMessage>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new ExtensionError("not_installed", "Extension bridge is unavailable here."));
      return;
    }
    const nonce = newNonce();
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(
        new ExtensionError(
          "not_installed",
          "The 10xConnect extension didn't respond. Install it, then try again.",
        ),
      );
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.source !== window || !isExtMessage(event.data, nonce)) {
        return;
      }
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(event.data);
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ source: APP_SOURCE, type, nonce }, window.location.origin);
  });
}

/** True if the extension's content script is present on this page. */
export async function detectExtension(timeoutMs = 1200): Promise<boolean> {
  try {
    await request("ping", timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask the extension to capture the LinkedIn `li_at` session from the user's
 * logged-in tab. Throws ExtensionError with a precise code the UI can branch on.
 */
export async function captureLinkedInSession(timeoutMs = 10000): Promise<{ liAt: string }> {
  const reply = await request("capture-linkedin", timeoutMs);
  if (reply.ok && reply.liAt) {
    return { liAt: reply.liAt };
  }
  const code: ExtensionErrorCode = reply.code ?? "capture_failed";
  throw new ExtensionError(
    code,
    reply.message ??
      (code === "not_logged_in"
        ? "You're not signed in to LinkedIn in this browser. Sign in, then reconnect."
        : "Couldn't capture your LinkedIn session. Make sure you're signed in to LinkedIn."),
  );
}
