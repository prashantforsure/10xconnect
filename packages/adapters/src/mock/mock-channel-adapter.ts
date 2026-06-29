import type {
  AccountConnection,
  AccountRef,
  AccountStatus,
  ActionResult,
  ActionType,
  ChannelAdapter,
  ChannelError,
  ChannelErrorCode,
  ConnectInput,
  ConnectionRequestOptions,
  Conversation,
  ConversationPage,
  ConversationSyncCapable,
  ConversationThread,
  EnrichedProfile,
  HostedAuthCallback,
  HostedAuthCapable,
  HostedAuthLink,
  HostedAuthLinkParams,
  InboundEvent,
  InboundEventHandler,
  InMailContent,
  LeadRef,
  ListConversationsOptions,
  Message,
  MessageContent,
  SendOptions,
  Unsubscribe,
  VoiceNoteCapable,
  VoiceNoteRef,
} from "@10xconnect/core";

/**
 * Behavior knobs for tests/dev. Deterministic by default: no latency, no
 * failures, no forced errors — randomness (failureRate) only kicks in when
 * explicitly set. `forceError` makes every send fail with that code (used to
 * exercise the rate governor / health monitor in Phase 4).
 */
export interface MockAdapterConfig {
  latencyMs?: number;
  /** Probability 0..1 that a send fails with provider_error (default 0). */
  failureRate?: number;
  /** When set, every send fails with this error code. */
  forceError?: ChannelErrorCode | null;
  /** Injectable clock for deterministic timestamps in tests. */
  clock?: () => string;
}

export interface RecordedAction {
  type: ActionType;
  idempotencyKey: string;
  account: AccountRef;
  lead?: LeadRef;
  providerRef: string;
  at: string;
  detail?: Record<string, unknown>;
}

const RETRIABLE_CODES: ReadonlySet<ChannelErrorCode> = new Set([
  "rate_limited",
  "timeout",
  "provider_error",
]);

/**
 * In-memory ChannelAdapter for local dev + tests (CLAUDE.md §5). Fake sends are
 * recorded; profiles/conversations are synthesized; inbound events are driven
 * manually via the simulate* hooks. This is what the whole system is developed
 * and tested against until a step explicitly needs Unipile.
 */
export class MockChannelAdapter
  implements ChannelAdapter, HostedAuthCapable, ConversationSyncCapable, VoiceNoteCapable
{
  private readonly config: MockAdapterConfig;
  private readonly clock: () => string;

  private seq = 0;
  private readonly actions: RecordedAction[] = [];
  private readonly actionsByKey = new Map<string, RecordedAction>();
  private readonly conversations = new Map<string, Message[]>();
  private readonly accountStatus = new Map<string, AccountStatus>();
  private readonly leadRefs = new Map<string, LeadRef>();
  private readonly accountForLead = new Map<string, string>();
  private readonly handlers = new Set<InboundEventHandler>();

  constructor(config: MockAdapterConfig = {}) {
    this.config = { ...config };
    this.clock = config.clock ?? (() => new Date().toISOString());
  }

  // --- account lifecycle ----------------------------------------------------

  async connectAccount(input: ConnectInput): Promise<AccountConnection> {
    await this.delay();
    const accountId = this.nextId("account");
    const providerAccountId = this.nextId("provider-account");
    // Simulate provider-side validation so the connect flow's verification step
    // can be exercised in dev: an obviously-bad/empty li_at connects "disconnected"
    // (rejected on verify); everything else begins warming (CLAUDE.md §6).
    const liAt = input.cookie?.liAt?.toLowerCase() ?? "";
    const invalid = liAt === "" || liAt.includes("invalid");
    const status: AccountStatus = invalid ? "disconnected" : "warming";
    this.accountStatus.set(accountId, status);
    return {
      accountId,
      providerAccountId,
      status,
      name: `Mock ${input.method} account`,
    };
  }

  async disconnectAccount(account: AccountRef): Promise<void> {
    await this.delay();
    this.accountStatus.set(account.accountId, "disconnected");
  }

  async getAccountStatus(account: AccountRef): Promise<AccountStatus> {
    await this.delay();
    return this.accountStatus.get(account.accountId) ?? "active";
  }

  // --- hosted auth (dev simulation) ----------------------------------------

  async createHostedAuthLink(params: HostedAuthLinkParams): Promise<HostedAuthLink> {
    await this.delay();
    // No real provider: point at the API's dev completion route, which fires the
    // same callback the real notify_url would, then redirects back to the app.
    const base = params.notifyUrl.replace(
      /\/webhooks\/hosted\/unipile$/,
      "/dev/hosted-auth/complete",
    );
    const url =
      `${base}?token=${encodeURIComponent(params.name)}` +
      `&type=${params.type}` +
      `&redirect=${encodeURIComponent(params.successRedirectUrl)}`;
    return { url, expiresAt: params.expiresAt };
  }

  parseHostedAuthCallback(payload: unknown): HostedAuthCallback | null {
    if (typeof payload !== "object" || payload === null) {
      return null;
    }
    const p = payload as { status?: unknown; account_id?: unknown; name?: unknown };
    if (typeof p.account_id !== "string" || typeof p.name !== "string") {
      return null;
    }
    const status = typeof p.status === "string" ? p.status.toUpperCase() : "";
    if (status === "CREATION_SUCCESS") {
      return { providerAccountId: p.account_id, name: p.name, status: "created" };
    }
    if (status === "RECONNECTED") {
      return { providerAccountId: p.account_id, name: p.name, status: "reconnected" };
    }
    return null;
  }

  // --- outreach actions (idempotent) ---------------------------------------

  sendConnectionRequest(
    account: AccountRef,
    lead: LeadRef,
    opts: ConnectionRequestOptions,
  ): Promise<ActionResult> {
    return this.perform("connection_request", account, lead, opts, { note: opts.note ?? null });
  }

  sendMessage(
    account: AccountRef,
    lead: LeadRef,
    content: MessageContent,
    opts: SendOptions,
  ): Promise<ActionResult> {
    return this.performMessage(
      "message",
      account,
      lead,
      opts,
      { direction: "outbound", channel: "linkedin", body: content.body },
      // Record delivered media so tests can assert attachments went through the
      // adapter (the mock "delivers" them).
      content.attachments?.length ? { attachments: content.attachments } : undefined,
    );
  }

  sendVoiceNote(
    account: AccountRef,
    lead: LeadRef,
    audio: VoiceNoteRef,
    opts: SendOptions,
  ): Promise<ActionResult> {
    return this.performMessage("voice_note", account, lead, opts, {
      direction: "outbound",
      channel: "linkedin",
      voiceRef: audio.audioRef,
    });
  }

  /** The mock transport simulates native voice notes (records the send). */
  voiceNoteSupport(): { supported: boolean; reason?: string } {
    return { supported: true };
  }

  sendInMail(
    account: AccountRef,
    lead: LeadRef,
    content: InMailContent,
    opts: SendOptions,
  ): Promise<ActionResult> {
    return this.performMessage("inmail", account, lead, opts, {
      direction: "outbound",
      channel: "linkedin",
      body: content.body,
    });
  }

  sendOpenProfileMessage(
    account: AccountRef,
    lead: LeadRef,
    content: MessageContent,
    opts: SendOptions,
  ): Promise<ActionResult> {
    return this.performMessage("open_profile_message", account, lead, opts, {
      direction: "outbound",
      channel: "linkedin",
      body: content.body,
    });
  }

  likePost(account: AccountRef, lead: LeadRef, opts: SendOptions): Promise<ActionResult> {
    return this.perform("like_post", account, lead, opts);
  }

  commentPost(
    account: AccountRef,
    lead: LeadRef,
    text: string,
    opts: SendOptions,
  ): Promise<ActionResult> {
    return this.perform("comment_post", account, lead, opts, { text });
  }

  replyComment(
    account: AccountRef,
    lead: LeadRef,
    text: string,
    opts: SendOptions,
  ): Promise<ActionResult> {
    return this.perform("reply_comment", account, lead, opts, { text });
  }

  visitProfile(account: AccountRef, lead: LeadRef, opts: SendOptions): Promise<ActionResult> {
    return this.perform("visit_profile", account, lead, opts);
  }

  followLead(account: AccountRef, lead: LeadRef, opts: SendOptions): Promise<ActionResult> {
    return this.perform("follow_lead", account, lead, opts);
  }

  // --- reads ----------------------------------------------------------------

  async fetchProfile(_account: AccountRef, linkedinUrl: string): Promise<EnrichedProfile> {
    await this.delay();
    const slug = linkedinUrl.split("/").filter(Boolean).pop() ?? "jordan-prospect";
    const parts = slug.split("-").filter(Boolean);
    const firstName = capitalize(parts[0] ?? "Jordan");
    const lastName = capitalize(parts.slice(1).join(" ") || "Prospect");
    const company = "Northwind Labs";
    const role = "Head of Growth";
    return {
      linkedinUrl,
      firstName,
      lastName,
      headline: `${role} at ${company}`,
      about: `${firstName} leads growth at ${company}. (mock enrichment)`,
      company,
      role,
      location: "San Francisco, CA",
      connectionDegree: 2,
      recentPosts: [
        {
          postId: this.nextId("post"),
          text: "We just shipped a new onboarding flow — early numbers look great.",
          postedAt: this.clock(),
        },
        {
          postId: this.nextId("post"),
          text: "Hiring two growth engineers this quarter — DMs open if you know anyone sharp.",
          postedAt: this.clock(),
        },
        {
          postId: this.nextId("post"),
          text: "Hot take: most B2B activation problems are really onboarding-copy problems.",
          postedAt: this.clock(),
        },
      ],
    };
  }

  async fetchConversation(_account: AccountRef, lead: LeadRef): Promise<Conversation> {
    await this.delay();
    return {
      lead,
      channel: "linkedin",
      messages: [...(this.conversations.get(this.leadKey(lead)) ?? [])],
    };
  }

  /**
   * Bulk-list conversations for an inbox sync (ConversationSyncCapable). Returns
   * deterministic synthetic threads so the "extract all conversations" flow is
   * demoable/testable offline. Stable: the same call yields the same threads, so
   * a re-sync dedupes to zero new rows.
   */
  async listConversations(
    _account: AccountRef,
    opts?: ListConversationsOptions,
  ): Promise<ConversationPage> {
    await this.delay();
    const firsts = ["Jordan", "Avery", "Riley", "Casey", "Morgan", "Taylor"];
    const lasts = ["Bennett", "Carter", "Donovan", "Ellison", "Fletcher", "Grant"];
    const count = Math.min(opts?.limit ?? 6, 6);
    const threads: ConversationThread[] = [];
    for (let i = 0; i < count; i += 1) {
      const first = firsts[i % firsts.length]!;
      const last = lasts[(i * 5) % lasts.length]!;
      const slug = `${first.toLowerCase()}-${last.toLowerCase()}-conn-${i + 1}`;
      const t0 = new Date(Date.now() - (i + 1) * 3_600_000).toISOString();
      const t1 = new Date(Date.now() - (i + 1) * 3_600_000 + 600_000).toISOString();
      threads.push({
        providerChatId: `mock-chat-${i + 1}`,
        channel: "linkedin",
        attendee: {
          providerId: `mock-attendee-${i + 1}`,
          linkedinUrl: `https://www.linkedin.com/in/${slug}`,
          name: `${first} ${last}`,
          headline: "Head of Growth at Northwind Labs",
          connectionDegree: 1,
        },
        messages: [
          {
            providerMessageId: `mock-cmsg-${i + 1}-1`,
            direction: "outbound",
            channel: "linkedin",
            body: "Hey — great to connect! What are you focused on this quarter?",
            sentAt: t0,
          },
          {
            providerMessageId: `mock-cmsg-${i + 1}-2`,
            direction: "inbound",
            channel: "linkedin",
            body: "Likewise! Mostly scaling our outbound. Curious what you do.",
            sentAt: t1,
          },
        ],
      });
    }
    return { threads };
  }

  // --- inbound subscription -------------------------------------------------

  subscribeInboundEvents(handler: InboundEventHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  // --- simulation hooks (mock-only; drive InboundEvents) --------------------

  async simulateInviteAccepted(leadId: string): Promise<void> {
    await this.emit({
      id: this.nextId("evt"),
      type: "invite_accepted",
      accountId: this.accountForLead.get(leadId) ?? "mock-account",
      channel: "linkedin",
      occurredAt: this.clock(),
      lead: this.leadRef(leadId),
    });
  }

  async simulateReply(leadId: string, body: string): Promise<void> {
    const message: Message = {
      providerMessageId: this.nextId("msg"),
      direction: "inbound",
      channel: "linkedin",
      body,
      sentAt: this.clock(),
    };
    this.appendMessage(leadId, message);
    await this.emit({
      id: this.nextId("evt"),
      type: "reply",
      accountId: this.accountForLead.get(leadId) ?? "mock-account",
      channel: "linkedin",
      occurredAt: this.clock(),
      lead: this.leadRef(leadId),
      message,
    });
  }

  async simulateMessageOpened(leadId: string): Promise<void> {
    await this.emit({
      id: this.nextId("evt"),
      type: "message_opened",
      accountId: this.accountForLead.get(leadId) ?? "mock-account",
      channel: "linkedin",
      occurredAt: this.clock(),
      lead: this.leadRef(leadId),
    });
  }

  async simulateRestriction(accountId: string): Promise<void> {
    this.accountStatus.set(accountId, "restricted");
    await this.emit({
      id: this.nextId("evt"),
      type: "account_status_changed",
      accountId,
      channel: "linkedin",
      occurredAt: this.clock(),
      status: "restricted",
    });
  }

  // --- test/dev controls ----------------------------------------------------

  /** Mutate behavior at runtime (e.g. flip on a failure rate mid-test). */
  setConfig(config: Partial<MockAdapterConfig>): void {
    Object.assign(this.config, config);
  }

  /** All recorded outbound actions, in order. */
  get recordedActions(): readonly RecordedAction[] {
    return this.actions;
  }

  /** Clear all in-memory state (handy between tests). */
  reset(): void {
    this.seq = 0;
    this.actions.length = 0;
    this.actionsByKey.clear();
    this.conversations.clear();
    this.accountStatus.clear();
    this.leadRefs.clear();
    this.accountForLead.clear();
  }

  // --- internals ------------------------------------------------------------

  private async perform(
    type: ActionType,
    account: AccountRef,
    lead: LeadRef,
    opts: SendOptions,
    detail?: Record<string, unknown>,
  ): Promise<ActionResult> {
    await this.delay();

    // Idempotency: a repeated key is a no-op replay, never a double-send (§2).
    const existing = this.actionsByKey.get(opts.idempotencyKey);
    if (existing) {
      return {
        status: "success",
        idempotencyKey: opts.idempotencyKey,
        providerRef: existing.providerRef,
        deduplicated: true,
        at: existing.at,
      };
    }

    if (this.config.forceError) {
      return this.fail(opts.idempotencyKey, this.config.forceError);
    }
    if (this.config.failureRate && Math.random() < this.config.failureRate) {
      return this.fail(opts.idempotencyKey, "provider_error");
    }

    const at = this.clock();
    const providerRef = this.nextId("action");
    const record: RecordedAction = { type, idempotencyKey: opts.idempotencyKey, account, lead, providerRef, at, detail };
    this.actions.push(record);
    this.actionsByKey.set(opts.idempotencyKey, record);
    const key = this.leadKey(lead);
    this.leadRefs.set(key, lead);
    this.accountForLead.set(key, account.accountId);

    return { status: "success", idempotencyKey: opts.idempotencyKey, providerRef, at };
  }

  /** Like perform(), but also appends the outbound message to the conversation. */
  private async performMessage(
    type: ActionType,
    account: AccountRef,
    lead: LeadRef,
    opts: SendOptions,
    message: Omit<Message, "providerMessageId" | "sentAt">,
    extraDetail?: Record<string, unknown>,
  ): Promise<ActionResult> {
    const result = await this.perform(type, account, lead, opts, { ...message, ...(extraDetail ?? {}) });
    if (result.status === "success" && !result.deduplicated) {
      this.appendMessage(this.leadKey(lead), {
        ...message,
        providerMessageId: result.providerRef,
        sentAt: result.at,
      });
    }
    return result;
  }

  private fail(idempotencyKey: string, code: ChannelErrorCode): ActionResult {
    const error: ChannelError = {
      code,
      message: `mock adapter: ${code}`,
      retriable: RETRIABLE_CODES.has(code),
      ...(code === "rate_limited" ? { retryAfterMs: 60_000 } : {}),
    };
    return { status: "failed", idempotencyKey, error };
  }

  private appendMessage(leadId: string, message: Message): void {
    const thread = this.conversations.get(leadId) ?? [];
    thread.push(message);
    this.conversations.set(leadId, thread);
  }

  private leadRef(leadId: string): LeadRef {
    return this.leadRefs.get(leadId) ?? { leadId };
  }

  private leadKey(lead: LeadRef): string {
    return lead.leadId ?? lead.providerId ?? lead.linkedinUrl ?? lead.email ?? "unknown";
  }

  private async emit(event: InboundEvent): Promise<void> {
    await Promise.all([...this.handlers].map((handler) => handler(event)));
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `mock-${prefix}-${this.seq}`;
  }

  private async delay(): Promise<void> {
    if (this.config.latencyMs && this.config.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.latencyMs));
    }
  }
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
