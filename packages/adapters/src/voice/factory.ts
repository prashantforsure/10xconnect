import { env } from "@10xconnect/config";
import type { VoiceGenerationAdapter } from "@10xconnect/core";

import { ElevenLabsVoiceAdapter } from "./elevenlabs-voice-adapter";
import { MockVoiceAdapter } from "./mock-voice-adapter";

/**
 * Resolve the voice-generation adapter (mirrors createTextAdapter). Voice is a paid
 * feature, so it is mock-safe by default — it never silently requires a key:
 *  - VOICE_PROVIDER=mock                         → deterministic MockVoiceAdapter
 *  - VOICE_API_KEY / TTS_API_KEY set (elevenlabs) → ElevenLabsVoiceAdapter
 *  - no key + ADAPTER=mock (dev/test)            → MockVoiceAdapter (offline)
 *  - no key + ADAPTER=unipile (prod)             → null (caller surfaces "not configured")
 */
export function createVoiceAdapter(): VoiceGenerationAdapter | null {
  if (env.VOICE_PROVIDER === "mock") {
    return new MockVoiceAdapter();
  }
  const apiKey = env.VOICE_API_KEY ?? env.TTS_API_KEY;
  if (apiKey) {
    return new ElevenLabsVoiceAdapter({ apiKey, model: env.VOICE_MODEL });
  }
  return env.ADAPTER === "mock" ? new MockVoiceAdapter() : null;
}

export function isVoiceConfigured(): boolean {
  return createVoiceAdapter() !== null;
}
