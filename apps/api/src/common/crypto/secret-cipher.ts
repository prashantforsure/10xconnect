import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { env } from "@10xconnect/config";
import { Injectable, Optional } from "@nestjs/common";

/**
 * Authenticated symmetric encryption for credential / session material at rest
 * (CLAUDE.md §11). AES-256-GCM: confidentiality + integrity (the auth tag
 * detects tampering on decrypt).
 *
 * Payload format (URL-safe base64, dot-separated, version-tagged so the scheme
 * can evolve without breaking stored rows):
 *
 *   v1.<iv>.<authTag>.<ciphertext>
 *
 * The key comes from SECRETS_ENCRYPTION_KEY (server-only env). It NEVER leaves
 * the server and is never logged. Plaintext is never persisted or logged.
 */
const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256

@Injectable()
export class SecretCipher {
  private cachedKey: Buffer | null = null;

  /**
   * @param keyOverride optional raw key (hex or base64). When omitted (the DI /
   * production path) the key is read from SECRETS_ENCRYPTION_KEY. Tests pass it
   * explicitly for determinism without touching env.
   */
  constructor(@Optional() private readonly keyOverride?: string) {}

  /** True if a usable encryption key is configured. */
  isConfigured(): boolean {
    try {
      this.getKey();
      return true;
    } catch {
      return false;
    }
  }

  /** Encrypt UTF-8 plaintext → versioned, base64url payload string. */
  encrypt(plaintext: string): string {
    const key = this.getKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [VERSION, b64url(iv), b64url(authTag), b64url(ciphertext)].join(".");
  }

  /** Decrypt a payload produced by {@link encrypt}. Throws on tamper / bad key. */
  decrypt(payload: string): string {
    const parts = payload.split(".");
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error("Malformed or unsupported secret payload");
    }
    const [, ivPart, tagPart, ctPart] = parts;
    const key = this.getKey();
    const decipher = createDecipheriv(ALGORITHM, key, fromB64url(ivPart));
    decipher.setAuthTag(fromB64url(tagPart));
    const plaintext = Buffer.concat([decipher.update(fromB64url(ctPart)), decipher.final()]);
    return plaintext.toString("utf8");
  }

  /** Encrypt a JSON-serializable object. */
  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  /** Decrypt + parse a JSON payload produced by {@link encryptJson}. */
  decryptJson<T>(payload: string): T {
    return JSON.parse(this.decrypt(payload)) as T;
  }

  /**
   * Resolve + validate the 32-byte key from SECRETS_ENCRYPTION_KEY. Accepts hex
   * (64 chars) or base64. Cached after first parse. Throws (never logging the
   * value) if missing or the wrong length.
   */
  private getKey(): Buffer {
    if (this.cachedKey) {
      return this.cachedKey;
    }
    const raw = this.keyOverride ?? env.SECRETS_ENCRYPTION_KEY;
    if (!raw) {
      throw new Error(
        "SECRETS_ENCRYPTION_KEY is not configured (required to encrypt account credentials)",
      );
    }
    const key = parseKey(raw);
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `SECRETS_ENCRYPTION_KEY must be ${KEY_BYTES} bytes (hex or base64); got ${key.length}`,
      );
    }
    this.cachedKey = key;
    return key;
  }
}

function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  return Buffer.from(trimmed, "base64");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}
