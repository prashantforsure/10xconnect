// Prebuilt workflows → ready-to-run builder graphs for the Workflows picker. Each
// is a curated, high-performing B2B LinkedIn sequence aligned with our methodology
// (CLAUDE.md §2/§7: start conversations not pitches, no-note connection requests,
// switch medium on follow-up). Picking one drops a complete GraphNode[] onto the
// canvas; the user then fills/edits message bodies in the composer.
//
// Pure (no React) so it can be unit-tested and reused by the picker. The `icon`
// is a key the picker maps to a lucide component.

import { type GraphNode, linearChain } from "./graph";
import { buildTemplate } from "./templates";

export interface PrebuiltWorkflow {
  key: string;
  title: string;
  description: string;
  /** Lucide icon name, mapped to a component in the picker. */
  icon: "Handshake" | "Flame" | "Mic" | "GitBranch";
  /** A short why-it-works note shown under the title. */
  hint: string;
  /** Build a fresh GraphNode[] (new ids each call) ready for the canvas. */
  build: () => GraphNode[];
}

// A soft, methodology-aligned opener (personalized observation + low-friction
// question, no pitch). Users personalize per-campaign in the composer.
const CONNECTED_OPENER =
  "Hi {first_name}, thanks for connecting! What are you focused on at {company} this quarter?";
const VOICE_CONTEXT =
  "Hi {first_name}, just sent a quick voice note with some context — would love your take.";

/** Classic connector: like → connect (no note) → on accept → wait → soft message. */
function classicConnector(): GraphNode[] {
  return linearChain([
    { kind: "action", type: "like_last_post" },
    { kind: "action", type: "send_connection_request" },
    { kind: "condition", type: "invite_accepted" },
    { kind: "action", type: "wait_x_days", config: { days: 1 } },
    { kind: "action", type: "send_message", config: { body: CONNECTED_OPENER } },
  ]);
}

/**
 * Warm-up before connect: visit + like first, THEN connect. Pre-engaging the
 * prospect lifts acceptance rate — the top restriction-risk metric (CLAUDE.md §6/§14).
 */
function warmupBeforeConnect(): GraphNode[] {
  return linearChain([
    { kind: "action", type: "visit_profile" },
    { kind: "action", type: "like_last_post" },
    { kind: "action", type: "wait_x_days", config: { days: 1 } },
    { kind: "action", type: "send_connection_request" },
    { kind: "condition", type: "invite_accepted" },
    { kind: "action", type: "wait_x_days", config: { days: 1 } },
    { kind: "action", type: "send_message", config: { body: CONNECTED_OPENER } },
  ]);
}

/**
 * Voice-note breakthrough: connect → message → switch medium to a native voice
 * note (+ short context text) — our highest-differentiation follow-up (CLAUDE.md §7).
 * The voice node carries no audio here; the composer/voice gate handles recording.
 */
function voiceNoteBreakthrough(): GraphNode[] {
  return linearChain([
    { kind: "action", type: "send_connection_request" },
    { kind: "condition", type: "invite_accepted" },
    { kind: "action", type: "wait_x_days", config: { days: 1 } },
    { kind: "action", type: "send_message", config: { body: CONNECTED_OPENER } },
    { kind: "action", type: "wait_x_days", config: { days: 3 } },
    { kind: "action", type: "send_voice_note" },
    { kind: "action", type: "send_message", config: { body: VOICE_CONTEXT } },
  ]);
}

/** Connected vs not connected: DM 1st-degree directly; connect-then-message others. */
function connectedVsNot(): GraphNode[] {
  return buildTemplate("connected_split").chain;
}

export const PREBUILT_WORKFLOWS: PrebuiltWorkflow[] = [
  {
    key: "classic_connector",
    title: "Classic connector",
    description: "Like → connect (no note) → on accept, wait a day, then a soft opener.",
    icon: "Handshake",
    hint: "The dependable starting point for most LinkedIn outreach.",
    build: classicConnector,
  },
  {
    key: "warmup_before_connect",
    title: "Warm-up before connect",
    description: "Visit + like first, then connect, then message on accept.",
    icon: "Flame",
    hint: "Pre-engaging lifts acceptance rate — the top account-safety metric.",
    build: warmupBeforeConnect,
  },
  {
    key: "voice_note_breakthrough",
    title: "Voice-note breakthrough",
    description: "Connect → message → switch to a native voice note + context.",
    icon: "Mic",
    hint: "Switching medium stands out and restarts a stalled conversation.",
    build: voiceNoteBreakthrough,
  },
  {
    key: "connected_vs_not",
    title: "Connected vs not connected",
    description: "DM 1st-degree directly; connect-then-message everyone else.",
    icon: "GitBranch",
    hint: "One workflow that adapts to whether you're already connected.",
    build: connectedVsNot,
  },
];
