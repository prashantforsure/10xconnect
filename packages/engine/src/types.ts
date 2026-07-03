// Engine dependency surface + shared row shapes. The engine is DB-backed but
// provider-agnostic: it receives a ChannelAdapter (interface) and a Kysely client.
// No provider SDKs here — those stay in packages/adapters.

import type { ChannelAdapter, EmbeddingAdapter, TextGenerationAdapter } from "@10xconnect/core";
import type { DB, Json } from "@10xconnect/db";
import type { Kysely } from "kysely";

/** Dispatch cadence + demo knobs (sourced from env in the app/worker). */
export interface DispatchConfig {
  minSpacingMs: number;
  jitterMs: number;
  ignoreWorkingHours: boolean;
  /** Max due actions processed per tick. */
  batchSize: number;
}

/**
 * Optional hook to resolve a node's outbound text per-lead (AI personalization,
 * variable injection). Wired in M6; until then the engine uses the raw config.
 */
export type ContentResolver = (input: {
  workspaceId: string;
  nodeType: string;
  template: string;
  config: Record<string, unknown>;
  lead: LeadRow;
  /** Phase 5: node + campaign context for the per-prospect preview cache. */
  nodeId?: string;
  campaignId?: string;
}) => Promise<string> | string;

/**
 * Mint a fresh fetchable URL for a storage ref at dispatch time. Compose-time
 * signed URLs expire (1h TTL) long before a late sequence step fires; the host
 * (api/worker) implements this against Supabase Storage. Return null (never
 * throw) to fall back to the stored URL.
 */
export type AttachmentUrlResolver = (ref: string) => Promise<string | null>;

export interface EngineDeps {
  db: Kysely<DB>;
  adapter: ChannelAdapter;
  config: DispatchConfig;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  resolveContent?: ContentResolver;
  /** Fresh signed URLs for message attachments at dispatch (see the type doc). */
  resolveAttachmentUrl?: AttachmentUrlResolver;
  /** Conversation-brain (Phase 2): reasoning-model drafts. Absent → no AI drafts. */
  textAdapter?: TextGenerationAdapter | null;
  /** Conversation-brain (Phase 2): KB/fact embeddings. Absent → no grounding. */
  embeddingAdapter?: EmbeddingAdapter | null;
  /** Model id for Phase 3 cost metering/pricing (e.g. "gemini-2.0-flash"|"mock"). */
  modelLabel?: string;
  log?: (msg: string) => void;
}

export interface LeadRow {
  id: string;
  workspace_id: string;
  linkedin_url: string | null;
  email: string | null;
  enrichment: Json;
  tags: string[];
  custom_columns: Json;
  connection_degree: number | null;
}

export interface SequenceNodeRow {
  id: string;
  campaign_id: string;
  workspace_id: string;
  kind: "action" | "condition";
  type: string;
  config: Json;
  next_node_id: string | null;
  true_node_id: string | null;
  false_node_id: string | null;
  delay_days: number | null;
}

export interface LeadStateRow {
  id: string;
  workspace_id: string;
  lead_id: string;
  campaign_id: string;
  current_node_id: string | null;
  status: string;
  history: Json;
}

/** One entry appended to lead_campaign_state.history as a lead progresses. */
export interface HistoryEntry {
  nodeId: string;
  type: string;
  at: string;
  stepSeq: number;
  outcome?: string;
}
