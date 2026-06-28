// Per-prospect cloned voice notes (Phase 7.1) — pure domain layer.
//
// Pipeline: a CONSENTED voice clone (the user's own voice, ElevenLabs Professional
// Voice Cloning) → per-contact text → synthesized audio → a DELIVERY PLAN. We do
// NOT send here: LinkedIn voice notes are mobile-only and the current Unipile API
// has no native voice-note endpoint (CLAUDE.md §14), so delivery capability is
// probed and the plan is constructed but never executed.
//
// Safety/compliance (this is a transparency-sensitive feature):
//  - Consent is MANDATORY: synthesis is refused without an explicit consent record
//    on the voice profile (the user cloning THEIR OWN voice, recorded).
//  - Disclosure is MANDATORY: every AI-voice note must carry AI_VOICE_DISCLOSURE
//    (EU AI Act Art. 50 transparency obligations apply from 2026-08-02).
//  - Provider SDKs live ONLY in packages/adapters; this file is provider-free.

import type { AccountRef, ChannelAdapter, LeadRef, VoiceNoteRef } from "../channel";

// --- Consent + disclosure --------------------------------------------------

/** Where the cloning audio came from (for the consent audit trail). */
export type VoiceConsentMethod = "self_recorded" | "uploaded_with_consent";

/** A consent record attached to a cloned voice. Without `consented:true`, synthesis is refused. */
export interface VoiceConsent {
  consented: boolean;
  /** Who the voice belongs to (the consenting subject). */
  subjectName?: string;
  consentedAt?: string;
  method?: VoiceConsentMethod;
}

/**
 * The disclosure that MUST accompany every AI-generated voice note (EU AI Act
 * Art. 50 transparency; effective 2026-08-02). Surfaced to the user on send and
 * intended to be disclosed to the recipient.
 */
export const AI_VOICE_DISCLOSURE =
  "This voice note uses an AI-generated clone of the sender's own voice. A real person reads and is responsible for every reply.";

export class VoiceConsentError extends Error {
  readonly code = "voice_consent_required";
  constructor(message = "Voice cloning/synthesis requires an explicit consent record on the voice profile.") {
    super(message);
    this.name = "VoiceConsentError";
  }
}

/** Throws VoiceConsentError unless the profile carries a valid consent record. */
export function assertVoiceConsent(consent: VoiceConsent | undefined | null): asserts consent is VoiceConsent {
  if (!consent || consent.consented !== true) {
    throw new VoiceConsentError();
  }
}

// --- Voice profile + generation adapter ------------------------------------

export type VoiceProvider = "elevenlabs" | "mock";

/** A trained, consented voice clone — the provider's voice id + the consent record. */
export interface VoiceProfile {
  provider: VoiceProvider;
  /** Provider-side voice id (e.g. an ElevenLabs PVC voice id). */
  providerVoiceId: string;
  consent: VoiceConsent;
  /** Display label, e.g. "Dana's voice". */
  label?: string;
}

/** Input to train a clone from consented audio samples. */
export interface VoiceCloneRequest {
  name: string;
  consent: VoiceConsent;
  /** Reference(s) to consented training audio (storage keys/URLs). */
  sampleRefs: string[];
}

export interface VoiceCloneResult {
  provider: VoiceProvider;
  providerVoiceId: string;
}

/** Per-contact synthesis request: a personalized script rendered in the cloned voice. */
export interface VoiceSynthesisRequest {
  voice: VoiceProfile;
  /** The personalized note text (already resolved per contact). */
  text: string;
  /** Optional correlation id (the contact/lead) — for cache keys, not sent to the provider. */
  contactId?: string;
  /** Output container; defaults to mp3. */
  format?: "mp3" | "wav";
}

export interface VoiceSynthesisResult {
  /** Base64-encoded audio bytes in the cloned voice. */
  audioBase64: string;
  mimeType: string;
  /** Decoded byte length (audioBase64 decoded). */
  byteLength: number;
  /** Estimated spoken duration. */
  durationMs: number;
  providerVoiceId: string;
}

/**
 * Swappable voice-generation provider (ElevenLabs PVC | mock). Implemented ONLY in
 * packages/adapters. `cloneVoice` trains/registers a clone from consented samples;
 * `synthesize` renders per-contact text in that clone. Errors are thrown (mapped by
 * the adapter), like TextGenerationAdapter.
 */
export interface VoiceGenerationAdapter {
  readonly provider: VoiceProvider;
  cloneVoice(req: VoiceCloneRequest): Promise<VoiceCloneResult>;
  synthesize(req: VoiceSynthesisRequest): Promise<VoiceSynthesisResult>;
}

/** Rough spoken-duration estimate (~150 wpm) used for the ≤30s voice-note meter. */
export function estimateVoiceDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.round((words / 150) * 60_000);
}

// --- Delivery capability (probe, never executes) ---------------------------

/**
 * Optional adapter capability: report whether the transport can actually DELIVER a
 * native LinkedIn voice note. Distinct from the always-present sendVoiceNote verb —
 * a provider may expose the verb but have no native endpoint (it then returns a
 * typed failure). Narrow with isVoiceNoteCapable, like HostedAuthCapable.
 */
export interface VoiceNoteCapable {
  voiceNoteSupport(): { supported: boolean; reason?: string };
}

export function isVoiceNoteCapable(value: unknown): value is VoiceNoteCapable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { voiceNoteSupport?: unknown }).voiceNoteSupport === "function"
  );
}

/** Probe whether `adapter` can deliver a voice note — WITHOUT attempting a send. */
export function voiceNoteDeliveryCapability(adapter: ChannelAdapter): { supported: boolean; reason?: string } {
  if (isVoiceNoteCapable(adapter)) {
    return adapter.voiceNoteSupport();
  }
  // Unknown capability → assume the interface verb works (the dispatch path still
  // surfaces a typed failure if it doesn't).
  return { supported: true };
}

// --- Delivery-path construction (CONSTRUCTS, never sends) -------------------

export interface PrepareVoiceNoteInput {
  voiceAdapter: VoiceGenerationAdapter;
  /** Transport — used ONLY to probe delivery capability here, never to send. */
  channelAdapter: ChannelAdapter;
  voice: VoiceProfile;
  text: string;
  account: AccountRef;
  lead: LeadRef;
  idempotencyKey: string;
  /** Where the audio would be stored (storage key). Optional in mock/preview. */
  audioRef?: string;
  contactId?: string;
}

/** A constructed-but-unexecuted voice-note dispatch (the exact call dispatch WOULD make). */
export interface PlannedVoiceDelivery {
  type: "voice_note";
  account: AccountRef;
  lead: LeadRef;
  voiceNote: VoiceNoteRef;
  idempotencyKey: string;
  /** Always false here — Phase 7.1 never sends a real voice note. */
  executed: false;
}

export interface PreparedVoiceNote {
  /** Generated audio in the cloned voice (base64). */
  audio: VoiceSynthesisResult;
  /** The disclosure that must accompany the note (EU AI Act). */
  disclosure: string;
  delivery: {
    /** Whether the transport can deliver a native voice note. */
    capable: boolean;
    /** Typed reason when not capable (e.g. Unipile has no native endpoint). */
    reason?: string;
    plan: PlannedVoiceDelivery;
  };
}

/**
 * Generate a per-contact cloned voice note and CONSTRUCT its delivery plan, without
 * sending. Refuses without consent; attaches the mandatory disclosure; probes (but
 * never invokes) the transport's voice-note capability. This is the seam a future
 * dispatch node reuses — it would call channelAdapter.sendVoiceNote(plan...) only
 * once delivery is supported and a human has approved.
 */
export async function prepareVoiceNote(input: PrepareVoiceNoteInput): Promise<PreparedVoiceNote> {
  assertVoiceConsent(input.voice.consent);

  const audio = await input.voiceAdapter.synthesize({
    voice: input.voice,
    text: input.text,
    contactId: input.contactId,
  });

  const capability = voiceNoteDeliveryCapability(input.channelAdapter);
  const voiceNote: VoiceNoteRef = {
    audioRef: input.audioRef ?? `pending:voice/${input.idempotencyKey}`,
    durationMs: audio.durationMs,
  };

  return {
    audio,
    disclosure: AI_VOICE_DISCLOSURE,
    delivery: {
      capable: capability.supported,
      reason: capability.reason,
      plan: {
        type: "voice_note",
        account: input.account,
        lead: input.lead,
        voiceNote,
        idempotencyKey: input.idempotencyKey,
        executed: false,
      },
    },
  };
}
