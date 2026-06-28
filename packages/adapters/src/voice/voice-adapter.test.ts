import assert from "node:assert/strict";
import { test } from "node:test";

import { type VoiceConsent, VoiceConsentError, voiceNoteDeliveryCapability } from "@10xconnect/core";

import { UnipileChannelAdapter } from "../unipile/unipile-channel-adapter";

import { createVoiceAdapter } from "./factory";
import { MockVoiceAdapter } from "./mock-voice-adapter";

const CONSENT: VoiceConsent = { consented: true, subjectName: "Dana", method: "self_recorded" };

const voice = {
  provider: "mock" as const,
  providerVoiceId: "mock-voice-1",
  consent: CONSENT,
};

test("MockVoiceAdapter clones + synthesizes cloned audio (distinct per contact, consent enforced)", async () => {
  const adapter = new MockVoiceAdapter();

  const clone = await adapter.cloneVoice({ name: "Dana", consent: CONSENT, sampleRefs: ["s1.mp3", "s2.mp3"] });
  assert.equal(clone.provider, "mock");
  assert.ok(clone.providerVoiceId.startsWith("mock-voice-"));

  const a = await adapter.synthesize({ voice, text: "Hi Ana, congrats on the raise." });
  const b = await adapter.synthesize({ voice, text: "Hi Ben, saw your hiring push." });
  assert.ok(a.audioBase64.length > 0 && a.byteLength > 0, "audio produced");
  assert.equal(a.mimeType, "audio/mpeg");
  assert.notEqual(a.audioBase64, b.audioBase64, "distinct audio per contact");

  // Deterministic: same input → identical bytes (mock-safe).
  const a2 = await adapter.synthesize({ voice, text: "Hi Ana, congrats on the raise." });
  assert.equal(a.audioBase64, a2.audioBase64, "deterministic");

  // Consent is mandatory for both clone + synthesis.
  await assert.rejects(
    () => adapter.synthesize({ voice: { ...voice, consent: { consented: false } }, text: "x" }),
    VoiceConsentError,
  );
  await assert.rejects(
    () => adapter.cloneVoice({ name: "X", consent: { consented: false }, sampleRefs: [] }),
    VoiceConsentError,
  );
});

test("createVoiceAdapter resolves the mock by default (voice works offline / keyless)", () => {
  const adapter = createVoiceAdapter();
  assert.ok(adapter, "voice adapter resolved");
  assert.equal(adapter!.provider, "mock");
});

test("Unipile transport CANNOT deliver a voice note — capability + typed failure confirmed", async () => {
  const unipile = new UnipileChannelAdapter({ apiKey: "test-key", dsn: "api.unipile.test" });

  // Capability probe (no send): unsupported with a clean typed reason.
  const cap = voiceNoteDeliveryCapability(unipile);
  assert.equal(cap.supported, false);
  assert.match(cap.reason ?? "", /not supported by the current Unipile API/);

  // And the verb itself returns a clean typed failure (never throws / never guesses).
  const result = await unipile.sendVoiceNote(
    { accountId: "a", providerAccountId: "p" },
    { leadId: "l" },
    { audioRef: "x" },
    { idempotencyKey: "vn:1" },
  );
  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" && result.error.code, "invalid_request");
  assert.equal(result.status === "failed" && result.error.retriable, false);
});
