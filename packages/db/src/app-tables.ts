import type { ColumnType } from "kysely";

import type { Json } from "./database.types";

/**
 * Tables introduced by app migrations that are not yet reflected in the
 * generated `database.types.ts` (which mirrors `supabase gen types`). They live
 * here so Phase 3 can use them through Kysely WITHOUT editing the generated
 * types file (which is edited concurrently by other work). When the types are
 * next regenerated, fold these into database.types.ts and delete this file.
 *
 * The `DB` type in kysely.ts intersects these in, so they are first-class Kysely
 * tables everywhere the shared client is used.
 */

export type ImportStatus = "pending" | "running" | "completed" | "failed";

export type ImportSource =
  | "csv"
  | "linkedin_search"
  | "sales_navigator"
  | "event"
  | "post"
  | "group"
  | "list"
  | "lead_finder"
  // Manually-entered LinkedIn profile URLs (also backs "import selected
  // connections", which feeds the same pipeline). Column is `text`, no migration.
  | "profile_urls";

/** Column with a DB default → optional on insert, present on select. */
type WithDefault<T> = ColumnType<T, T | undefined, T>;
/** Nullable column with a DB default. */
type NullableWithDefault<T> = ColumnType<T | null, T | null | undefined, T | null>;

export interface ImportJobsTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  source: ColumnType<ImportSource, ImportSource, ImportSource>;
  status: WithDefault<ImportStatus>;
  list_id: NullableWithDefault<string>;
  campaign_id: NullableWithDefault<string>;
  params: WithDefault<Json>;
  total_count: WithDefault<number>;
  created_count: WithDefault<number>;
  duplicate_count: WithDefault<number>;
  failed_count: WithDefault<number>;
  error: NullableWithDefault<string>;
  created_by: NullableWithDefault<string>;
  started_at: NullableWithDefault<string>;
  finished_at: NullableWithDefault<string>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

export type ImportSourceStatus = "active" | "paused";

/** Recurring "live import" source definitions (continuous/auto-refresh import). */
export interface ImportSourcesTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  source: ColumnType<ImportSource, ImportSource, ImportSource>;
  params: WithDefault<Json>;
  list_id: NullableWithDefault<string>;
  campaign_id: NullableWithDefault<string>;
  interval_minutes: WithDefault<number>;
  status: WithDefault<ImportSourceStatus>;
  last_run_at: NullableWithDefault<string>;
  next_run_at: WithDefault<string>;
  last_job_id: NullableWithDefault<string>;
  created_by: NullableWithDefault<string>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

// ---------------------------------------------------------------------------
// MVP M0 tables (orchestration brain, sequence engine, inbox, AI).
// ---------------------------------------------------------------------------

export type ChannelType = "linkedin" | "email";

export interface LeadEventsTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  lead_id: NullableWithDefault<string>;
  account_id: NullableWithDefault<string>;
  campaign_id: NullableWithDefault<string>;
  type: ColumnType<string, string, string>;
  provider_event_id: NullableWithDefault<string>;
  channel: WithDefault<ChannelType>;
  occurred_at: WithDefault<string>;
  metadata: WithDefault<Json>;
  created_at: WithDefault<string>;
}

export interface SavedResponsesTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  title: ColumnType<string, string, string>;
  body: ColumnType<string, string, string>;
  created_by: NullableWithDefault<string>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

export interface AiPromptsTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  name: ColumnType<string, string, string>;
  template: ColumnType<string, string, string>;
  is_default: WithDefault<boolean>;
  run_count: WithDefault<number>;
  created_by: NullableWithDefault<string>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

export interface AiPromptFavoritesTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  user_id: ColumnType<string, string, string>;
  prompt_ref: ColumnType<string, string, string>;
  created_at: WithDefault<string>;
}

export interface DoNotContactTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  linkedin_url: NullableWithDefault<string>;
  email: NullableWithDefault<string>;
  reason: NullableWithDefault<string>;
  created_by: NullableWithDefault<string>;
  created_at: WithDefault<string>;
}

export interface NotificationsTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  type: ColumnType<string, string, string>;
  title: ColumnType<string, string, string>;
  body: NullableWithDefault<string>;
  account_id: NullableWithDefault<string>;
  read: WithDefault<boolean>;
  created_at: WithDefault<string>;
}

export type RelationshipStage =
  | "invited"
  | "awaiting_reply"
  | "in_conversation"
  | "objection"
  | "qualifying"
  | "hot_lead"
  | "nurture"
  | "closed_won"
  | "closed_lost";

/** The relationship axis (conversation brain) — one row per lead/person. */
export interface RelationshipStateTable {
  lead_id: ColumnType<string, string, string>; // PK
  workspace_id: ColumnType<string, string, string>;
  campaign_id: NullableWithDefault<string>;
  stage: WithDefault<RelationshipStage>;
  intent_score: WithDefault<number>;
  ai_turn_count: WithDefault<number>;
  last_ai_reply_at: NullableWithDefault<string>;
  do_not_reply: WithDefault<boolean>;
  sentiment: NullableWithDefault<string>;
  summary: NullableWithDefault<string>;
  next_action: NullableWithDefault<string>;
  next_action_at: NullableWithDefault<string>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

/**
 * New conversations columns (Phase 1) not yet in the generated database.types.ts.
 * Intersected into the generated conversations table by DB = GeneratedDB &
 * AppExtraTables, so `conversations` carries both the generated + these columns.
 */
export interface ConversationsExtraColumns {
  needs_attention: WithDefault<boolean>;
  is_important: WithDefault<boolean>;
  assigned_to: NullableWithDefault<string>;
}

/** Who wrote an outbound message: a human (manual / approved a draft) or the AI
 * SDR autonomously (auto-sent by the autonomy dial, no human in the loop). */
export type MessageAuthor = "human" | "ai";

/**
 * AI-SDR authorship marker on messages (not yet in the generated types).
 * Intersected into the generated messages table so `messages` carries it.
 */
export interface MessagesExtraColumns {
  authored_by: WithDefault<MessageAuthor>;
  /** Dispatcher-written outbound messages carry the action's idempotency key
   * (unique when set) so a retry after a mid-crash can't append the same
   * message to the thread twice. Null for inbound/manual inserts. */
  dispatch_key: NullableWithDefault<string>;
}

export type AccountLinkRequestType = "create" | "reconnect";
export type AccountLinkRequestStatus = "pending" | "completed" | "expired";

/** Pending hosted-auth (provider-hosted connect) requests, keyed by a one-time token. */
export interface AccountLinkRequestsTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  token: ColumnType<string, string, string>;
  type: ColumnType<AccountLinkRequestType, AccountLinkRequestType, AccountLinkRequestType>;
  reconnect_provider_account_id: NullableWithDefault<string>;
  /** Our sending_accounts.id to finalize on a reconnect (multi-account). */
  reconnect_account_id: NullableWithDefault<string>;
  country: ColumnType<string, string, string>;
  status: WithDefault<AccountLinkRequestStatus>;
  expires_at: ColumnType<string, string, string>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

/**
 * New sending_accounts column (multi-account) not yet in the generated types.
 * Intersected into the generated sending_accounts table.
 */
export interface SendingAccountsExtraColumns {
  label: NullableWithDefault<string>;
}

export type ApiKeyPermission = "all" | "read_only";

// ---------------------------------------------------------------------------
// Integrations build — outbox + outbound webhook delivery (Phase B) + provider
// connections (Phase C).
// ---------------------------------------------------------------------------

/** Domain events emitted to the integrations outbox (webhooks + Slack). */
export type IntegrationEventType =
  | "reply"
  | "accepted_invite"
  | "status_change"
  | "hot_lead"
  | "campaign_completed"
  | "message_sent";

export type WebhookStatus = "active" | "disabled";
export type DeliveryStatus = "pending" | "delivered" | "failed";
export type DeliveryTargetKind = "webhook" | "slack";

/**
 * The outbox: one row per domain event, deduped per workspace so idempotent
 * seams can re-emit safely (insert ON CONFLICT DO NOTHING). The delivery
 * poller fans unprocessed rows out into webhook_deliveries.
 */
export interface IntegrationEventsTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  type: ColumnType<IntegrationEventType, IntegrationEventType, IntegrationEventType>;
  dedupe_key: ColumnType<string, string, string>;
  payload: WithDefault<Json>;
  processed_at: NullableWithDefault<string>;
  created_at: WithDefault<string>;
}

/** One delivery attempt-chain per event x target (webhook or Slack connection). */
export interface WebhookDeliveriesTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  event_id: ColumnType<string, string, string>;
  target_kind: WithDefault<DeliveryTargetKind>;
  webhook_id: NullableWithDefault<string>;
  connection_id: NullableWithDefault<string>;
  event_type: ColumnType<string, string, string>;
  attempt: WithDefault<number>;
  status: WithDefault<DeliveryStatus>;
  response_code: NullableWithDefault<number>;
  error: NullableWithDefault<string>;
  next_attempt_at: WithDefault<string>;
  delivered_at: NullableWithDefault<string>;
  created_at: WithDefault<string>;
}

export type IntegrationProvider = "slack";

/**
 * Provider connections (Phase C): one per provider per workspace. config is
 * provider-specific jsonb; secret material inside it (e.g. the Slack incoming
 * webhook URL) is SecretCipher-encrypted before insert.
 */
export interface IntegrationConnectionsTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  provider: ColumnType<IntegrationProvider, IntegrationProvider, IntegrationProvider>;
  status: WithDefault<WebhookStatus>;
  config: WithDefault<Json>;
  events: WithDefault<string[]>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

/**
 * webhooks v2 columns (not in the generated types). secret is the per-webhook
 * signing secret (whsec_..., null for legacy rows = deliveries unsigned);
 * auth_header_value is SecretCipher-encrypted at rest.
 */
export interface WebhooksExtraColumns {
  name: WithDefault<string>;
  secret: NullableWithDefault<string>;
  auth_header_name: NullableWithDefault<string>;
  auth_header_value: NullableWithDefault<string>;
  status: WithDefault<WebhookStatus>;
  consecutive_failures: WithDefault<number>;
}

/**
 * API keys v2 columns (integrations build) not yet in the generated types.
 * Intersected into the generated api_keys table. `prefix` is the display
 * prefix of the plaintext (e.g. "10xc_a1b2c3d") — null for legacy keys created
 * before v2, whose plaintext is unrecoverable (only the sha256 hash is stored).
 */
export interface ApiKeysExtraColumns {
  name: WithDefault<string>;
  permission: WithDefault<ApiKeyPermission>;
  prefix: NullableWithDefault<string>;
  last_used_at: NullableWithDefault<string>;
}

// ---------------------------------------------------------------------------
// MVP M5 — conversation brain (knowledge base, facts, AI drafts, brain config).
// ---------------------------------------------------------------------------

/**
 * pgvector embedding columns are stored/read as the textual vector literal
 * `[0.1,0.2,...]` from Kysely (Postgres casts text→vector on insert); cosine
 * KNN retrieval uses raw `sql` with a `::vector` cast. Nullable (set after embed).
 */
type VectorColumn = NullableWithDefault<string>;

export interface KnowledgeBasesTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  name: ColumnType<string, string, string>;
  description: NullableWithDefault<string>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

export interface KbChunksTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  knowledge_base_id: ColumnType<string, string, string>;
  body: ColumnType<string, string, string>;
  embedding: VectorColumn;
  token_count: NullableWithDefault<number>;
  metadata: WithDefault<Json>;
  created_at: WithDefault<string>;
}

export interface FactsTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  lead_id: ColumnType<string, string, string>;
  campaign_id: NullableWithDefault<string>;
  topic: WithDefault<string>;
  body: ColumnType<string, string, string>;
  embedding: VectorColumn;
  source: NullableWithDefault<string>;
  confidence: NullableWithDefault<number>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

export type MessageDraftStatus = "pending" | "approved" | "discarded" | "escalated";

export interface MessageDraftsTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  conversation_id: ColumnType<string, string, string>;
  lead_id: NullableWithDefault<string>;
  campaign_id: NullableWithDefault<string>;
  status: WithDefault<MessageDraftStatus>;
  body: NullableWithDefault<string>;
  confidence: NullableWithDefault<number>;
  reasoning: WithDefault<Json>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

/**
 * Phase 2 brain + Phase 3 limits/budget columns added to the generated campaigns
 * table. `limits` = { max_ai_turns, cooldown_minutes }; `budget` =
 * { daily_usd_cap, alert_at_pct } (see packages/core/src/brain/limits.ts).
 */
export interface CampaignsBrainColumns {
  objective: NullableWithDefault<Json>;
  guardrails: WithDefault<Json>;
  voice: WithDefault<Json>;
  autonomy: WithDefault<Json>;
  knowledge_base_id: NullableWithDefault<string>;
  voice_profile_id: NullableWithDefault<string>;
  limits: WithDefault<Json>;
  budget: WithDefault<Json>;
}

// ---------------------------------------------------------------------------
// Phase 3 — limits + budget governor (conversation volume + LLM spend ledgers).
// ---------------------------------------------------------------------------

/**
 * Per-campaign, per-UTC-day LLM spend rollup (the budget governor). PK is
 * (campaign_id, window). `window` is a `date` and `usd_used` is a Postgres
 * `numeric` — both come back from the pg driver as STRINGS, so coerce on read.
 */
export interface BudgetLedgerTable {
  campaign_id: ColumnType<string, string, string>; // PK part
  window: ColumnType<string, string, string>; // PK part — date 'YYYY-MM-DD'
  workspace_id: ColumnType<string, string, string>;
  tokens_used: WithDefault<number>;
  cached_tokens_used: WithDefault<number>; // Phase 9.8 — cached prompt tokens (cheaper)
  usd_used: WithDefault<number | string>; // numeric → string on select
  soft_alerted: WithDefault<boolean>;
  hard_stopped: WithDefault<boolean>;
  updated_at: WithDefault<string>;
}

// ---------------------------------------------------------------------------
// Phase 5 — per-prospect preview cache + AI prompt templates.
// ---------------------------------------------------------------------------

/**
 * Resolved personalization output cached per (node, contact, prompt_version) so
 * dispatch reuses it without a second LLM call. PK is the three key columns.
 */
export interface PreviewCacheTable {
  node_id: ColumnType<string, string, string>; // PK part
  contact_id: ColumnType<string, string, string>; // PK part
  prompt_version: ColumnType<string, string, string>; // PK part
  workspace_id: ColumnType<string, string, string>;
  resolved_text: ColumnType<string, string, string>;
  tokens: WithDefault<number>;
  created_at: WithDefault<string>;
}

export type PromptTemplateScope = "private" | "workspace" | "community";

/** Named, variable-driven, shareable AI prompt templates (the library). */
export interface AiPromptTemplatesTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  name: ColumnType<string, string, string>;
  scope: WithDefault<PromptTemplateScope>;
  body: ColumnType<string, string, string>;
  variables: WithDefault<Json>;
  run_count: WithDefault<number>;
  created_by: NullableWithDefault<string>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

// ---------------------------------------------------------------------------
// Phase 6 — workflow templates (whole-campaign blueprints, structure-only).
// ---------------------------------------------------------------------------

export type WorkflowTemplateScope = "private" | "workspace" | "community";

/**
 * Reusable, shareable copy of a campaign's SHAPE (graph + message skeletons +
 * AI prompts + cadence + brain defaults + required_inputs). Never stores leads,
 * accounts, resolved/previewed messages, or KB content. Apply clones a frozen
 * copy into a fresh draft campaign (no FK link → no auto-propagation on edit).
 */
export interface WorkflowTemplatesTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  name: ColumnType<string, string, string>;
  scope: WithDefault<WorkflowTemplateScope>;
  graph: WithDefault<Json>;
  messages: WithDefault<Json>;
  ai_prompts: WithDefault<Json>;
  cadence: WithDefault<Json>;
  brain_defaults: WithDefault<Json>;
  required_inputs: WithDefault<Json>;
  template_version: WithDefault<number>;
  created_by: NullableWithDefault<string>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

/**
 * Builder-only saved workflow: a workspace-private snapshot of a builder canvas
 * SHAPE (the node graph), reused straight into a campaign's builder. Distinct from
 * workflow_templates (which clone a whole campaign). Holds shape only — sender/
 * account/media/resolved data is stripped before insert. No community scope.
 */
export interface SavedWorkflowsTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  name: ColumnType<string, string, string>;
  graph: WithDefault<Json>;
  created_by: NullableWithDefault<string>;
  created_at: WithDefault<string>;
  updated_at: WithDefault<string>;
}

/** Append-only per-LLM-call usage log (cost-per-conversation + routing audit). */
export interface LlmUsageTable {
  id: WithDefault<string>;
  workspace_id: ColumnType<string, string, string>;
  campaign_id: NullableWithDefault<string>;
  conversation_id: NullableWithDefault<string>;
  lead_id: NullableWithDefault<string>;
  kind: WithDefault<string>;
  model: ColumnType<string, string, string>;
  prompt_tokens: WithDefault<number>;
  completion_tokens: WithDefault<number>;
  total_tokens: WithDefault<number>;
  cached_tokens: WithDefault<number>; // Phase 9.8 — prompt tokens served from cache
  usd: WithDefault<number | string>; // numeric → string on select
  created_at: WithDefault<string>;
}

/** Extra Kysely tables intersected into DB (see kysely.ts). */
export interface AppExtraTables {
  import_jobs: ImportJobsTable;
  import_sources: ImportSourcesTable;
  lead_events: LeadEventsTable;
  saved_responses: SavedResponsesTable;
  ai_prompts: AiPromptsTable;
  ai_prompt_favorites: AiPromptFavoritesTable;
  do_not_contact: DoNotContactTable;
  notifications: NotificationsTable;
  account_link_requests: AccountLinkRequestsTable;
  // Augments the generated sending_accounts table with the multi-account label.
  sending_accounts: SendingAccountsExtraColumns;
  // Augments the generated api_keys table with the v2 public-API columns.
  api_keys: ApiKeysExtraColumns;
  // Integrations build — outbox + delivery log; webhooks v2 columns; connections.
  integration_events: IntegrationEventsTable;
  webhook_deliveries: WebhookDeliveriesTable;
  webhooks: WebhooksExtraColumns;
  integration_connections: IntegrationConnectionsTable;
  relationship_state: RelationshipStateTable;
  // Augments the generated conversations table with Phase 1 columns.
  conversations: ConversationsExtraColumns;
  // Augments the generated messages table with the AI-SDR authorship marker.
  messages: MessagesExtraColumns;
  // Phase 2 — conversation brain.
  knowledge_bases: KnowledgeBasesTable;
  kb_chunks: KbChunksTable;
  facts: FactsTable;
  message_drafts: MessageDraftsTable;
  // Augments the generated campaigns table with Phase 2 brain + Phase 3 columns.
  campaigns: CampaignsBrainColumns;
  // Phase 3 — limits + budget governor.
  budget_ledger: BudgetLedgerTable;
  llm_usage: LlmUsageTable;
  // Phase 5 — personalization preview cache + prompt templates.
  preview_cache: PreviewCacheTable;
  ai_prompt_templates: AiPromptTemplatesTable;
  // Phase 6 — workflow templates (whole-campaign blueprints).
  workflow_templates: WorkflowTemplatesTable;
  // Builder-only saved workflows (canvas shape, reused into the builder).
  saved_workflows: SavedWorkflowsTable;
}

/** Plain SELECT shape of an import_jobs row (for API view mapping). */
export interface ImportJobRow {
  id: string;
  workspace_id: string;
  source: ImportSource;
  status: ImportStatus;
  list_id: string | null;
  campaign_id: string | null;
  params: Json;
  total_count: number;
  created_count: number;
  duplicate_count: number;
  failed_count: number;
  error: string | null;
  created_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}
