import type {
  AccountConnection,
  AccountRef,
  AccountStatus,
  ActionResult,
  ConnectInput,
  ConnectMailboxInput,
  ConnectionRequestOptions,
  Conversation,
  EmailContent,
  EnrichedProfile,
  InboundEvent,
  InMailContent,
  LeadRef,
  MailboxConnection,
  MailboxHealth,
  MailboxRef,
  MessageContent,
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
