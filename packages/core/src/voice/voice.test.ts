import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChannelAdapter } from "../channel";

import {
  AI_VOICE_DISCLOSURE,
  assertVoiceConsent,
  estimateVoiceDurationMs,
  prepareVoiceNote,
  type VoiceGenerationAdapter,
  type VoiceProfile,
  VoiceConsentError,
  voiceNoteDeliveryCapability,
} from "./index";

/** Local mock generator (engine/core never depend on @10xconnect/adapters). */
function mockVoiceAdapter(): VoiceGenerationAdapter {
  return {
    provider: "mock",
    cloneVoice: async (req) => ({ provider: "mock", providerVoiceId: `mock-voice-${req.name.length}` }),
    synthesize: async (req) => {
      const payload = `${req.voice.providerVoiceId}:${req.text}`;
      const audioBase64 = Buffer.from(payload, "utf8").toString("base64");
      return {
        audioBase64,
        mimeType: "audio/mpeg",
        byteLength: Buffer.from(audioBase64, "base64").length,
        durationMs: estimateVoiceDurationMs(req.text),
        providerVoiceId: req.voice.providerVoiceId,
      };
    },
  };
}

/** A ChannelAdapter spy that counts sends and reports a delivery capability. */
function spyChannel(support: { supported: boolean; reason?: string }) {
  const calls = { sendVoiceNote: 0 };
  const adapter = {
    voiceNoteSupport: () => support,
    sendVoiceNote: async () => {
      calls.sendVoiceNote += 1;
      return { status: "success" as const, idempotencyKey: "x", at: "now" };
    },
  } as unknown as ChannelAdapter;
  return { adapter, calls };
}

const CONSENTED: VoiceProfile = {
  provider: "mock",
  providerVoiceId: "mock-voice-1",
  label: "Dana's voice",
  consent: { consented: true, subjectName: "Dana", method: "self_recorded" },
};

test("assertVoiceConsent refuses synthesis without an explicit consent record", () => {
  assert.throws(() => assertVoiceConsent(undefined), VoiceConsentError);
  assert.throws(() => assertVoiceConsent({ consented: false }), VoiceConsentError);
  assert.doesNotThrow(() => assertVoiceConsent({ consented: true }));
});

test("prepareVoiceNote generates cloned audio + constructs delivery but NEVER sends", async () => {
  const voiceAdapter = mockVoiceAdapter();
  // Unipile-like transport: voice notes NOT supported.
  const { adapter, calls } = spyChannel({ supported: false, reason: "no native voice-note endpoint" });

  const prepared = await prepareVoiceNote({
    voiceAdapter,
    channelAdapter: adapter,
    voice: CONSENTED,
    text: "Hey Dana, quick voice note about your launch.",
    account: { accountId: "acc-1" },
    lead: { leadId: "lead-1" },
    idempotencyKey: "vn:lead-1",
  });

  // Audio was generated in the cloned voice.
  assert.ok(prepared.audio.audioBase64.length > 0, "audio produced");
  assert.ok(prepared.audio.byteLength > 0);
  assert.equal(prepared.audio.providerVoiceId, "mock-voice-1");
  assert.equal(prepared.audio.mimeType, "audio/mpeg");

  // Mandatory disclosure attached.
  assert.equal(prepared.disclosure, AI_VOICE_DISCLOSURE);

  // Delivery PLAN constructed, capability surfaced, and NOTHING was sent.
  assert.equal(prepared.delivery.plan.type, "voice_note");
  assert.equal(prepared.delivery.plan.executed, false);
  assert.equal(prepared.delivery.plan.idempotencyKey, "vn:lead-1");
  assert.equal(prepared.delivery.capable, false, "Unipile-like transport cannot deliver");
  assert.match(prepared.delivery.reason ?? "", /native voice-note endpoint/);
  assert.equal(calls.sendVoiceNote, 0, "delivery path constructed but NOT executed");
});

test("prepareVoiceNote produces DISTINCT audio per contact and refuses without consent", async () => {
  const voiceAdapter = mockVoiceAdapter();
  const { adapter } = spyChannel({ supported: true });

  const a = await prepareVoiceNote({
    voiceAdapter, channelAdapter: adapter, voice: CONSENTED,
    text: "Hi Ana, congrats on the seed round.", account: { accountId: "a" }, lead: { leadId: "1" }, idempotencyKey: "k1",
  });
  const b = await prepareVoiceNote({
    voiceAdapter, channelAdapter: adapter, voice: CONSENTED,
    text: "Hi Ben, saw your hiring push.", account: { accountId: "a" }, lead: { leadId: "2" }, idempotencyKey: "k2",
  });
  assert.notEqual(a.audio.audioBase64, b.audio.audioBase64, "distinct per-contact audio");
  assert.equal(a.delivery.capable, true, "capable transport reported as supported");

  // No consent → refused before any synthesis.
  await assert.rejects(
    () =>
      prepareVoiceNote({
        voiceAdapter, channelAdapter: adapter,
        voice: { ...CONSENTED, consent: { consented: false } },
        text: "x", account: { accountId: "a" }, lead: { leadId: "3" }, idempotencyKey: "k3",
      }),
    VoiceConsentError,
  );
});

test("voiceNoteDeliveryCapability narrows the capability interface", () => {
  const incapable = { voiceNoteSupport: () => ({ supported: false, reason: "nope" }) } as unknown as ChannelAdapter;
  const unknown = {} as ChannelAdapter;
  assert.deepEqual(voiceNoteDeliveryCapability(incapable), { supported: false, reason: "nope" });
  assert.deepEqual(voiceNoteDeliveryCapability(unknown), { supported: true }, "unknown → assume verb works");
});

test("estimateVoiceDurationMs tracks word count (~150 wpm)", () => {
  assert.equal(estimateVoiceDurationMs(""), 0);
  assert.ok(estimateVoiceDurationMs("one two three four five six seven eight nine ten") > 0);
});
