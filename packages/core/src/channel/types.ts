// Provider-agnostic domain types for the transport boundary (CLAUDE.md §5).
// RULE: ZERO provider/SDK imports may ever appear in this package — these types
// are pure TypeScript and are the single contract the app + orchestration layers
// reference. Adapters (packages/adapters) translate provider payloads to/from
// these shapes.

// --- Accounts --------------------------------------------------------------

export type AccountStatus = "active" | "warming" | "paused" | "restricted" | "disconnected";

export type ConnectionMethod = "extension" | "credentials";
export type ProxyMode = "bundled" | "own";

export interface ProxyConfig {
  mode: ProxyMode;
  /** Country/region the proxy should match (the account's region). */
  region?: string;
  /** Only for mode === "own". */
  url?: string;
}

export interface ConnectInput {
  method: ConnectionMethod;
  /** ISO country of the account — proxy + session are matched to it. */
  country?: string;
  proxy?: ProxyConfig;
  /** credentials method only; MUST never be logged. 2FA guidance is mandatory. */
  credentials?: { email: string; password: string; twoFactorCode?: string };
  /** extension method only: handle to the captured authenticated session. */
  sessionToken?: string;
}

export interface AccountConnection {
  accountId: string;
  providerAccountId: string;
  status: AccountStatus;
  /** Provider-reported display name / handle, if available. */
  name?: string;
}

/**
 * Reference to a sending account passed to adapter verbs. Structured (not a bare
 * id) so the adapter stays DB-free: it carries our correlation id plus the
 * provider-addressable handle.
 */
export interface AccountRef {
  /** Our sending_accounts.id — echoed back in results/events for correlation. */
  accountId: string;
  /** Provider session/account handle the adapter actually addresses. */
  providerAccountId?: string;
}

/**
 * Reference to a lead/prospect (see AccountRef). Outbound verbs are always called
 * with our `leadId`; inbound webhook events may carry only a provider id
 * (`providerId`/`linkedinUrl`) until orchestration resolves it to our lead — so
 * `leadId` is optional. Callers should populate whatever identifiers they have.
 */
export interface LeadRef {
  /** Our leads.id — present for outbound calls; may be absent on inbound events. */
  leadId?: string;
  linkedinUrl?: string;
  /** Provider member/thread id. */
  providerId?: string;
  email?: string;
}

// --- Actions, results, and the error taxonomy ------------------------------

/**
 * The transport-dispatchable actions (each maps to a ChannelAdapter/EmailAdapter
 * verb and to the actions.type column). This is the transport SUBSET of the §7
 * sequence nodes — orchestration-only nodes (add_tag, wait_x_days) and condition
 * nodes are NOT transport actions and live with the sequence engine.
 */
export type ActionType =
  | "connection_request"
  | "message"
  | "voice_note"
  | "inmail"
  | "open_profile_message"
  | "like_post"
  | "comment_post"
  | "reply_comment"
  | "visit_profile"
  | "follow_lead"
  | "email";

export type ChannelErrorCode =
  | "rate_limited"
  | "account_restricted"
  | "account_disconnected"
  | "captcha_required"
  | "not_connected"
  | "lead_not_found"
  | "invalid_request"
  | "provider_error"
  | "timeout"
  | "unknown";

/** Explicit, typed failure — adapters return this, they never throw raw strings. */
export interface ChannelError {
  code: ChannelErrorCode;
  /** Human-readable, safe to log — never contains secrets. */
  message: string;
  /** Transient failure → safe to retry later. */
  retriable: boolean;
  /** Backoff hint in ms (e.g. for rate_limited). */
  retryAfterMs?: number;
  /** Provider reference for debugging, if any. */
  providerRef?: string;
  /** Opaque underlying cause; MUST never be a leaked provider type. */
  cause?: unknown;
}

export interface ActionSuccess {
  status: "success";
  /** Echoes the key the caller supplied (idempotency-first). */
  idempotencyKey: string;
  /** Provider-side id of the created action/message. */
  providerRef?: string;
  /** True if the provider recognized a replay and did NOT re-send. */
  deduplicated?: boolean;
  /** ISO timestamp the action executed. */
  at: string;
}

export interface ActionFailure {
  status: "failed";
  idempotencyKey: string;
  error: ChannelError;
}

/** Discriminated result of every mutating verb. */
export type ActionResult = ActionSuccess | ActionFailure;

/** Base options every mutating verb carries — idempotency is mandatory. */
export interface SendOptions {
  idempotencyKey: string;
}

export interface ConnectionRequestOptions extends SendOptions {
  /** Optional connection note. Default is NO note (CLAUDE.md §2 "thou shalt not sell"). */
  note?: string;
}

// --- Content ---------------------------------------------------------------

export interface MessageContent {
  body: string;
}

export interface InMailContent {
  subject?: string;
  body: string;
}

export interface VoiceNoteRef {
  /** Reference to stored audio (e.g. a Supabase Storage key/URL). */
  audioRef: string;
  durationMs?: number;
}

export interface EmailContent {
  subject: string;
  body: string;
  /** Optional reply threading. */
  inReplyToMessageId?: string;
}

// --- Profiles / conversations ---------------------------------------------

export interface RecentPost {
  postId: string;
  url?: string;
  text?: string;
  postedAt?: string;
}

export interface EnrichedProfile {
  linkedinUrl: string;
  providerId?: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  about?: string;
  company?: string;
  role?: string;
  location?: string;
  /** 1 = 1st-degree, 2 = 2nd, 3 = 3rd. */
  connectionDegree?: number;
  recentPosts?: RecentPost[];
  /** Email discovered/verified during enrichment, if any. */
  email?: string;
}

export type MessageChannel = "linkedin" | "email";
export type MessageDirection = "inbound" | "outbound";

export interface Message {
  providerMessageId?: string;
  direction: MessageDirection;
  channel: MessageChannel;
  body?: string;
  /** Reference to a voice-note payload (LinkedIn native voice notes). */
  voiceRef?: string;
  /** ISO timestamp. */
  sentAt: string;
}

export interface Conversation {
  lead: LeadRef;
  channel: MessageChannel;
  messages: Message[];
}

// --- Inbound events (webhook-driven) --------------------------------------

interface InboundEventBase {
  /**
   * Provider event id — the DEDUP KEY for idempotent webhook processing
   * (CLAUDE.md §2 "no double-sends / idempotent webhook handling").
   */
  id: string;
  accountId: string;
  channel: MessageChannel;
  /** ISO timestamp the event occurred at the provider. */
  occurredAt: string;
}

/**
 * Discriminated union of inbound events. `reply` drives auto-stop + inbox;
 * `invite_accepted` advances the sequence; opens/clicks/bounces feed analytics;
 * `account_status_changed` drives the restriction → auto-pause domain event.
 */
export type InboundEvent =
  | (InboundEventBase & { type: "reply"; lead: LeadRef; message: Message })
  | (InboundEventBase & { type: "invite_accepted"; lead: LeadRef })
  | (InboundEventBase & { type: "message_opened"; lead: LeadRef })
  | (InboundEventBase & { type: "email_opened"; lead: LeadRef })
  | (InboundEventBase & { type: "email_clicked"; lead: LeadRef; url?: string })
  | (InboundEventBase & { type: "email_bounced"; lead: LeadRef; bounceType?: "hard" | "soft" })
  | (InboundEventBase & { type: "account_status_changed"; status: AccountStatus });

export type InboundEventType = InboundEvent["type"];

// --- Mailboxes (email; Phase 11) ------------------------------------------

export interface MailboxRef {
  mailboxId: string;
  providerMailboxId?: string;
}

export interface ConnectMailboxInput {
  email: string;
  /** e.g. "google" | "microsoft" | "smtp". */
  provider?: string;
  /** Provider credentials; MUST never be logged. */
  credentials?: Record<string, unknown>;
}

export interface MailboxConnection {
  mailboxId: string;
  providerMailboxId: string;
  email: string;
  status: AccountStatus;
}

export interface MailboxHealth {
  status: AccountStatus;
  /** 0–100 deliverability/health score. */
  score?: number;
  spfAligned?: boolean;
  dkimAligned?: boolean;
  dmarcAligned?: boolean;
  bounceRate?: number;
  blocklisted?: boolean;
}
