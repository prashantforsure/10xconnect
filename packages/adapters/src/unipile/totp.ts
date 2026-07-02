import { createHmac } from "node:crypto";

/**
 * RFC 6238 TOTP generation — used to auto-solve LinkedIn's 2FA checkpoint during
 * the Infinite-login re-auth (CLAUDE.md §6). The account's authenticator-app 2FA
 * shared secret ("setup key") is stored encrypted; when the provider throws a
 * code checkpoint we generate the current code here and submit it, so re-auth is
 * silent. Zero dependencies — LinkedIn/authenticator apps use the RFC defaults
 * (SHA-1, 6 digits, 30-second step). SECRET in / code out; neither is logged.
 */
export interface TotpOptions {
  /** Unix time in ms (defaults to now). */
  timeMs?: number;
  /** Time step in seconds (default 30). */
  step?: number;
  /** Number of digits (default 6). */
  digits?: number;
}

/** Decode an RFC 4648 base32 string (case-insensitive, padding/spacing tolerated). */
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) {
      continue; // skip any non-base32 character defensively
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Generate the current TOTP code for a base32 shared secret. */
export function generateTotp(secret: string, opts: TotpOptions = {}): string {
  const step = opts.step ?? 30;
  const digits = opts.digits ?? 6;
  const timeMs = opts.timeMs ?? Date.now();
  const counter = Math.floor(timeMs / 1000 / step);

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const key = base32Decode(secret);
  const hmac = createHmac("sha1", key).update(counterBuf).digest();

  // Dynamic truncation (RFC 4226 §5.3).
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, "0");
}
