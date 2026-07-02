import type {
  AccountConnection,
  AccountRef,
  AccountStatus,
  ActionResult,
  ConnectInput,
  ConnectMailboxInput,
  ConnectionRequestOptions,
  Conversation,
  ConversationPage,
  CredentialsAuth,
  EmailContent,
  EnrichedProfile,
  HostedAuthCallback,
  HostedAuthLink,
  HostedAuthLinkParams,
  InboundEvent,
  InMailContent,
  LeadRef,
  ListConversationsOptions,
  MailboxConnection,
  MailboxHealth,
  MailboxRef,
  MessageContent,
  ProxyConfig,
  SendOptions,
  VoiceNoteRef,
} from "./types";

/** Handler for webhook-driven inbound events. May be async. */
export type InboundEventHandler = (event: InboundEvent) => void | Promise<void>;

/** Cancels an inbound-event subscription. */
export type Unsubscribe = () => void;

/**
 * The LinkedIn transport boundary (CLAUDE.md §5). The app + orchestration layers
 * NEVER touch a provider SDK directly — everything goes through this interface.
 *
 * Contract:
 *  - Every mutating verb is idempotent: the caller supplies opts.idempotencyKey
 *    and the adapter returns a typed ActionResult echoing it.
 *  - Account restriction/captcha is RETURNED (ActionResult error / inbound
 *    account_status_changed), never thrown — it is a domain event (§2).
 *  - Connection requests default to NO note (§2).
 */
export interface ChannelAdapter {
  // account lifecycle
  connectAccount(input: ConnectInput): Promise<AccountConnection>;
  disconnectAccount(account: AccountRef): Promise<void>;
  getAccountStatus(account: AccountRef): Promise<AccountStatus>;

  // outreach actions (idempotent → ActionResult)
  sendConnectionRequest(
    account: AccountRef,
    lead: LeadRef,
    opts: ConnectionRequestOptions,
  ): Promise<ActionResult>;
  sendMessage(
    account: AccountRef,
    lead: LeadRef,
    content: MessageContent,
    opts: SendOptions,
  ): Promise<ActionResult>;
  sendVoiceNote(
    account: AccountRef,
    lead: LeadRef,
    audio: VoiceNoteRef,
    opts: SendOptions,
  ): Promise<ActionResult>;
  sendInMail(
    account: AccountRef,
    lead: LeadRef,
    content: InMailContent,
    opts: SendOptions,
  ): Promise<ActionResult>;
  sendOpenProfileMessage(
    account: AccountRef,
    lead: LeadRef,
    content: MessageContent,
    opts: SendOptions,
  ): Promise<ActionResult>;
  likePost(account: AccountRef, lead: LeadRef, opts: SendOptions): Promise<ActionResult>;
  commentPost(
    account: AccountRef,
    lead: LeadRef,
    text: string,
    opts: SendOptions,
  ): Promise<ActionResult>;
  replyComment(
    account: AccountRef,
    lead: LeadRef,
    text: string,
    opts: SendOptions,
  ): Promise<ActionResult>;
  visitProfile(account: AccountRef, lead: LeadRef, opts: SendOptions): Promise<ActionResult>;
  followLead(account: AccountRef, lead: LeadRef, opts: SendOptions): Promise<ActionResult>;

  // reads
  fetchProfile(account: AccountRef, linkedinUrl: string): Promise<EnrichedProfile>;
  fetchConversation(account: AccountRef, lead: LeadRef): Promise<Conversation>;

  // inbound (webhooks): replies, accepts, opens, account status changes
  subscribeInboundEvents(handler: InboundEventHandler): Unsubscribe;
}

/**
 * Optional adapter capability: a provider-hosted connect flow (e.g. Unipile
 * Hosted Auth). Not every adapter implements it — narrow with isHostedAuthCapable
 * before use, like InboundWebhookReceiver. Provider payload parsing stays in the
 * adapter (§5): the app never inspects the raw callback body.
 */
export interface HostedAuthCapable {
  createHostedAuthLink(params: HostedAuthLinkParams): Promise<HostedAuthLink>;
  parseHostedAuthCallback(payload: unknown): HostedAuthCallback | null;
}

export function isHostedAuthCapable(value: unknown): value is HostedAuthCapable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { createHostedAuthLink?: unknown }).createHostedAuthLink === "function" &&
    typeof (value as { parseHostedAuthCallback?: unknown }).parseHostedAuthCallback === "function"
  );
}

/**
 * Optional adapter capability: the "Infinite login" re-auth (CLAUDE.md §6). When a
 * credentials-connected account's session drops (provider emits a disconnect /
 * CREDENTIALS event), orchestration silently re-logs in with the STORED
 * credentials and, on the LinkedIn 2FA checkpoint, generates a TOTP from the
 * stored `totpSecret` and solves it — no end-user action. Narrow with
 * isCredentialsReconnectCapable before use. Not every adapter implements it.
 */
export interface CredentialsReconnectCapable {
  reconnectWithCredentials(
    account: AccountRef,
    creds: CredentialsAuth,
    proxy?: ProxyConfig,
  ): Promise<AccountConnection>;
}

export function isCredentialsReconnectCapable(value: unknown): value is CredentialsReconnectCapable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { reconnectWithCredentials?: unknown }).reconnectWithCredentials === "function"
  );
}

/**
 * Optional adapter capability: bulk-list the connected account's existing
 * conversations, for the "extract all conversations" inbox sync (CLAUDE.md §8/§9).
 * Not every adapter implements it — narrow with isConversationSyncCapable before
 * use (like HostedAuthCapable). Provider payload mapping stays in the adapter (§5).
 */
export interface ConversationSyncCapable {
  listConversations(account: AccountRef, opts?: ListConversationsOptions): Promise<ConversationPage>;
}

export function isConversationSyncCapable(value: unknown): value is ConversationSyncCapable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { listConversations?: unknown }).listConversations === "function"
  );
}

/**
 * The email transport boundary (CLAUDE.md §5; Phase 11). Split out from
 * ChannelAdapter so LinkedIn implementers are not forced to stub email verbs and
 * vice versa. Shares the same ActionResult / idempotency / event contract.
 */
export interface EmailAdapter {
  connectMailbox(input: ConnectMailboxInput): Promise<MailboxConnection>;
  getMailboxHealth(mailbox: MailboxRef): Promise<MailboxHealth>;
  sendEmail(
    mailbox: MailboxRef,
    lead: LeadRef,
    email: EmailContent,
    opts: SendOptions,
  ): Promise<ActionResult>;
  subscribeInboundEvents(handler: InboundEventHandler): Unsubscribe;
}
