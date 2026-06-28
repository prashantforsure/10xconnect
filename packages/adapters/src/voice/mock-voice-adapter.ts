// Deterministic, offline voice-generation adapter (Phase 7.1). Produces fake but
// STABLE + DISTINCT audio per (voice, text) so the per-prospect cloned-voice flow
// is fully testable with no ElevenLabs key. No network, no real audio — the bytes
// are a base64 encoding of a deterministic payload, sized ~proportional to text.

import {
  assertVoiceConsent,
  estimateVoiceDurationMs,
  type VoiceCloneRequest,
  type VoiceCloneResult,
  type VoiceGenerationAdapter,
  type VoiceSynthesisRequest,
  type VoiceSynthesisResult,
} from "@10xconnect/core";

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export class MockVoiceAdapter implements VoiceGenerationAdapter {
  readonly provider = "mock" as const;

  async cloneVoice(req: VoiceCloneRequest): Promise<VoiceCloneResult> {
    // Consent is required to train a clone (the user's own consented voice).
    assertVoiceConsent(req.consent);
    return { provider: "mock", providerVoiceId: `mock-voice-${hash(req.name + req.sampleRefs.join(","))}` };
  }

  async synthesize(req: VoiceSynthesisRequest): Promise<VoiceSynthesisResult> {
    assertVoiceConsent(req.voice.consent);
    // Deterministic "audio": a synthetic WAV-ish header tag + the rendered payload,
    // unique per (voice, text). Distinct text → distinct bytes (proves per-prospect).
    const payload = `MOCKVOICE|${req.voice.providerVoiceId}|${req.text}`;
    const audioBase64 = Buffer.from(payload, "utf8").toString("base64");
    const byteLength = Buffer.from(audioBase64, "base64").length;
    return {
      audioBase64,
      mimeType: req.format === "wav" ? "audio/wav" : "audio/mpeg",
      byteLength,
      durationMs: estimateVoiceDurationMs(req.text),
      providerVoiceId: req.voice.providerVoiceId,
    };
  }
}
