import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { SecretCipher } from "./secret-cipher";

// Explicit key → deterministic, env-independent. Mirrors the DI path, which
// reads the same value from SECRETS_ENCRYPTION_KEY instead.
const KEY = randomBytes(32).toString("hex");
const newCipher = (): SecretCipher => new SecretCipher(KEY);

test("round-trips plaintext", () => {
  const cipher = newCipher();
  const secret = "linkedin-password-🔐-with-unicode";
  const payload = cipher.encrypt(secret);

  assert.match(payload, /^v1\./);
  assert.ok(!payload.includes(secret), "ciphertext must not contain plaintext");
  assert.equal(cipher.decrypt(payload), secret);
});

test("round-trips JSON credential bundles", () => {
  const cipher = newCipher();
  const bundle = { email: "user@example.com", password: "p@ss", proxyUrl: "http://h:1" };
  const payload = cipher.encryptJson(bundle);

  assert.deepEqual(cipher.decryptJson(payload), bundle);
});

test("uses a fresh IV per call (no deterministic ciphertext)", () => {
  const cipher = newCipher();
  assert.notEqual(cipher.encrypt("same"), cipher.encrypt("same"));
});

test("detects tampering via the GCM auth tag", () => {
  const cipher = newCipher();
  const payload = cipher.encrypt("sensitive");
  const [v, iv, tag, ct] = payload.split(".");
  // Flip a byte in the ciphertext segment.
  const tampered = Buffer.from(ct, "base64url");
  tampered[0] ^= 0xff;
  const bad = [v, iv, tag, tampered.toString("base64url")].join(".");

  assert.throws(() => cipher.decrypt(bad));
});

test("a different key cannot decrypt", () => {
  const payload = newCipher().encrypt("sensitive");
  const other = new SecretCipher(randomBytes(32).toString("hex"));
  assert.throws(() => other.decrypt(payload));
});

test("rejects malformed / unsupported payloads", () => {
  const cipher = newCipher();
  assert.throws(() => cipher.decrypt("not-a-payload"));
  assert.throws(() => cipher.decrypt("v2.a.b.c"));
});

test("rejects a wrong-length key", () => {
  const cipher = new SecretCipher("deadbeef"); // 4 bytes, too short
  assert.throws(() => cipher.encrypt("x"));
  assert.equal(cipher.isConfigured(), false);
});

test("isConfigured reflects a valid key", () => {
  assert.equal(newCipher().isConfigured(), true);
});
