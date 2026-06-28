// ElevenLabs Professional Voice Cloning adapter (Phase 7.1) — the ONLY place the
// ElevenLabs API is touched (CLAUDE.md §4). Trains a clone from the user's CONSENTED
// audio and synthesizes per-contact notes in that voice. fetch-based (no SDK dep);
// provider errors are mapped to throws like the text/embedding adapters.
//
// NOTE: this never DELIVERS a LinkedIn voice note (the transport can't — see
// UnipileChannelAdapter.voiceNoteSupport). It only produces the audio; the delivery
// plan is constructed elsewhere (core/prepareVoiceNote) and left unexecuted.

import {
  assertVoiceConsent,
  estimateVoiceDurationMs,
  type VoiceCloneRequest,
  type VoiceCloneResult,
  type VoiceGenerationAdapter,
  type VoiceSynthesisRequest,
  type VoiceSynthesisResult,
} from "@10xconnect/core";

export interface ElevenLabsConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const DEFAULT_BASE = "https://api.elevenlabs.io";

export class ElevenLabsVoiceAdapter implements VoiceGenerationAdapter {
  readonly provider = "elevenlabs" as const;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: ElevenLabsConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "eleven_multilingual_v2";
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE;
  }

  /**
   * Register a Professional Voice Clone from consented sample audio. The user must
   * have consented (their own voice); `sampleRefs` are fetchable audio URLs.
   */
  async cloneVoice(req: VoiceCloneRequest): Promise<VoiceCloneResult> {
    assertVoiceConsent(req.consent);
    const form = new FormData();
    form.append("name", req.name);
    for (const ref of req.sampleRefs) {
      const res = await fetch(ref).catch(() => null);
      if (!res?.ok) {
        throw new Error(`elevenlabs: could not fetch training sample ${ref}`);
      }
      form.append("files", await res.blob(), "sample.mp3");
    }
    const resp = await fetch(`${this.baseUrl}/v1/voices/add`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey },
      body: form,
    });
    if (!resp.ok) {
      throw new Error(`elevenlabs: voice clone failed (${resp.status})`);
    }
    const json = (await resp.json()) as { voice_id?: string };
    if (!json.voice_id) {
      throw new Error("elevenlabs: clone response missing voice_id");
    }
    return { provider: "elevenlabs", providerVoiceId: json.voice_id };
  }

  async synthesize(req: VoiceSynthesisRequest): Promise<VoiceSynthesisResult> {
    assertVoiceConsent(req.voice.consent);
    const resp = await fetch(`${this.baseUrl}/v1/text-to-speech/${req.voice.providerVoiceId}`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: req.text, model_id: this.model }),
    });
    if (!resp.ok) {
      throw new Error(`elevenlabs: synthesis failed (${resp.status})`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    return {
      audioBase64: buf.toString("base64"),
      mimeType: "audio/mpeg",
      byteLength: buf.length,
      durationMs: estimateVoiceDurationMs(req.text),
      providerVoiceId: req.voice.providerVoiceId,
    };
  }
}
