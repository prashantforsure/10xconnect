// Provider-agnostic domain types for the transport boundary (CLAUDE.md §5).
// RULE: ZERO provider/SDK imports may ever appear in this package — these types
// are pure TypeScript and are the single contract the app + orchestration layers
// reference. Adapters (packages/adapters) translate provider payloads to/from
// these shapes.

// --- Accounts --------------------------------------------------------------

export type AccountStatus = "active" | "warming" | "paused" | "restricted" | "disconnected";

export type ConnectionMethod = "extension" | "credentials" | "cookie";
export type ProxyMode = "bundled" | "own";

export interface ProxyConfig {
  mode: ProxyMode;
  /** Country/region the proxy should match (the account's region). */
  region?: string;
  /** Only for mode === "own". */
  url?: string;
}

export interface ConnectInput {
  /**
   * Connect method. The product exposes only `extension` (CLAUDE.md §6): the
   * browser extension captures the user's real, already-authenticated LinkedIn
   * session. `cookie` remains as the equivalent internal transport carrier (the
   * extension feeds a li_at), so adapters treat the two identically.
   */
  method: ConnectionMethod;
  /** ISO country of the account — proxy + session are matched to it. */
  country?: string;
  proxy?: ProxyConfig;
  /**
   * Session material captured by the extension: the LinkedIn `li_at` cookie plus
   * the matching browser user-agent. The provider validates the session at
   * connect time, so an expired/invalid li_at fails fast instead of saving a dead
   * account; passing the source browser's user-agent is what keeps LinkedIn from
   * logging the account out (CLAUDE.md §6/§14). SECRET — MUST never be logged.
   */
  cookie?: { liAt: string; userAgent?: string };
}

export interface AccountConnection {
  accountId: string;
  providerAccountId: string;
  status: AccountStatus;
  /** Provider-reported display name / handle, if available. */
  name?: string;
}

// --- Hosted auth (provider-hosted connect flow) ---------------------------
// The lowest-friction connect path (CLAUDE.md §6): the user logs in once on the
// provider's hosted page; the provider establishes + maintains the session in a
// consistent browser/proxy context (the most logout-resistant option) and calls
// our webhook on completion.

export interface HostedAuthLinkParams {
  /** "create" a new account, or "reconnect" an existing one. */
  type: "create" | "reconnect";
  /** Provider account id to reconnect (required when type === "reconnect"). */
  reconnectProviderAccountId?: string;
  /** Our one-time correlation token — echoed back in the completion callback. */
  name: string;
  /** Where the provider redirects the user's browser after success/failure. */
  successRedirectUrl: string;
  failureRedirectUrl: string;
  /** Server webhook the provider calls when the account is connected. */
  notifyUrl: string;
  /** Link expiry (ISO 8601). Keep short (minutes). */
  expiresAt: string;
}

export interface HostedAuthLink {
  /** The provider-hosted URL to send the user to. */
  url: string;
  expiresAt: string;
}

export interface HostedAuthCallback {
  /** Provider account id of the newly connected/reconnected account. */
  providerAccountId: string;
  /** The correlation token we passed as `name`. */
  name: string;
  status: "created" | "reconnected";
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

// --- Conversation sync (bulk "extract all conversations"; §8/§9) -----------

/**
 * One whole conversation thread pulled during an inbox sync (list-all-chats).
 * Unlike `Conversation` (keyed by a known LeadRef), a synced thread carries the
 * OTHER party's identity so the app can resolve it to — or create — a lead.
 */
export interface ConversationThread {
  /** Provider chat/thread id, for correlation. */
  providerChatId?: string;
  channel: MessageChannel;
  /** The other party in the thread (never the account owner). */
  attendee: {
    providerId?: string;
    linkedinUrl?: string;
    name?: string;
    headline?: string;
    /** 1 = 1st-degree, 2 = 2nd, 3 = 3rd. */
    connectionDegree?: number;
  };
  messages: Message[];
}

export interface ListConversationsOptions {
  /** Max threads to pull in this page. */
  limit?: number;
  /** Opaque pagination cursor from a previous ConversationPage.nextCursor. */
  cursor?: string;
}

export interface ConversationPage {
  threads: ConversationThread[];
  /** Present when more threads remain; pass back as ListConversationsOptions.cursor. */
  nextCursor?: string;
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
