import type {
  AccountConnection,
  AccountRef,
  AccountStatus,
  ActionResult,
  ChannelAdapter,
  ConnectInput,
  ConnectionRequestOptions,
  Conversation,
  ConversationPage,
  ConversationSyncCapable,
  ConversationThread,
  CredentialsAuth,
  CredentialsReconnectCapable,
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
  MessageAttachment,
  MessageContent,
  ProxyConfig,
  RecentPost,
  SendOptions,
  Unsubscribe,
  VoiceNoteCapable,
  VoiceNoteRef,
} from "@10xconnect/core";

import type { InboundWebhookReceiver } from "../webhook-receiver";

import {
  buildConnectProxy,
  mapAccountStatus,
  mapConnectionDegree,
  mapHttpError,
  mapRecentPosts,
} from "./mappers";
import { generateTotp } from "./totp";
import { UnipileClient, UnipileHttpError } from "./unipile-client";
import type {
  UnipileAccountListItem,
  UnipileConfig,
  UnipileCreateAccountResponse,
  UnipileHostedAuthResponse,
  UnipilePostList,
  UnipileSendResponse,
  UnipileUserProfile,
} from "./unipile-types";
import { normalizeWebhook } from "./webhook-normalizer";

const VOICE_NOTE_UNSUPPORTED_REASON =
  "unipile: native voice notes are not supported by the current Unipile API";

/**
 * Response of POST /api/v1/accounts for the credentials (custom-auth) flow. It's
 * either the created account (`account_id`) or a checkpoint that must be solved
 * (2FA/OTP). Loose by design — shapes to confirm in a live test.
 */
interface UnipileCredentialsResponse {
  object?: string; // "Account" | "Checkpoint"
  account_id?: string;
  checkpoint?: { type?: string };
}

interface ChatListItem {
  id?: string;
  /** Set for LinkedIn promotional/system threads (ads/sponsored/offers) — skip these. */
  content_type?: string;
  attendee_provider_id?: string;
  timestamp?: string;
}
interface ChatList {
  items?: ChatListItem[];
  cursor?: string | null;
}
interface ChatAttendeeList {
  items?: {
    is_self?: boolean | number;
    name?: string;
    provider_id?: string;
    profile_url?: string;
    specifics?: { occupation?: string; network_distance?: string };
  }[];
}
interface ChatMessageList {
  items?: {
    id?: string;
    text?: string;
    is_sender?: boolean | number;
    timestamp?: string;
  }[];
}

/**
 * Real ChannelAdapter over the Unipile REST API. This is the ONLY place Unipile's
 * HTTP/types are touched. Mutating verbs return our typed ActionResult (errors are
 * returned, never thrown); reads throw mapped errors. Inbound webhooks are
 * ingested via ingestWebhook() and emitted through subscribeInboundEvents().
 *
 * Endpoint confidence (verified vs current docs):
 *   confirmed — accounts, users/{id} (profile), users/invite, chats, posts
 *               reaction/comments, webhook payload shapes.
 *   best-effort/to-confirm in live test — voice notes (no native endpoint),
 *               like/comment "last post" id lookup, followLead, replyComment,
 *               fetchConversation chat lookup.
 */
export class UnipileChannelAdapter
  implements
    ChannelAdapter,
    InboundWebhookReceiver,
    HostedAuthCapable,
    ConversationSyncCapable,
    VoiceNoteCapable,
    CredentialsReconnectCapable
{
  private readonly client: UnipileClient;
  private readonly handlers = new Set<InboundEventHandler>();
  /** Normalized DSN passed to Unipile as `api_url` in hosted-auth requests. */
  private readonly apiUrl: string;

  constructor(config: UnipileConfig) {
    this.client = new UnipileClient(config);
    this.apiUrl = /^https?:\/\//.test(config.dsn) ? config.dsn : `https://${config.dsn}`;
  }

  // --- account lifecycle ----------------------------------------------------

  async connectAccount(input: ConnectInput): Promise<AccountConnection> {
    // Extension connect: the browser extension captures the user's real li_at
    // session + the matching user-agent and hands them here (`cookie` is the same
    // transport carrier, used internally). Unipile validates the session at
    // creation, so an expired/invalid li_at fails here rather than persisting a
    // dead account. Always route through a region-matched IP (own proxy or
    // Unipile's country pool) — mismatched geography is the top cause of LinkedIn
    // logouts (§6/§14), and passing the source browser's user-agent prevents
    // disconnects (Unipile's strong recommendation).
    if (input.method === "credentials") {
      // Infinite login (CLAUDE.md §6): username/password login in a stable
      // residential-proxy context, auto-solving the 2FA checkpoint from the TOTP
      // secret. The provider then MAINTAINS the session and silently re-auths when
      // it drops (reconnectWithCredentials), so the account stays connected.
      const creds = input.credentials;
      if (!creds?.email || !creds.password) {
        throw new Error("credentials connect requires email + password");
      }
      const providerId = await this.loginWithCredentials(
        creds,
        buildConnectProxy(input),
        input.cookie?.userAgent,
      );
      return { accountId: providerId, providerAccountId: providerId, status: "warming" };
    }
    if (input.method !== "extension" && input.method !== "cookie") {
      throw new Error(
        "UnipileChannelAdapter.connectAccount supports the extension, cookie and credentials methods only",
      );
    }
    if (!input.cookie?.liAt) {
      throw new Error("extension connect requires the captured li_at session");
    }
    const proxyFields = buildConnectProxy(input);
    const res = await this.client.postJson<UnipileCreateAccountResponse>("/api/v1/accounts", {
      provider: "LINKEDIN",
      access_token: input.cookie.liAt,
      ...(input.cookie.userAgent ? { user_agent: input.cookie.userAgent } : {}),
      ...proxyFields,
    });
    return { accountId: res.account_id, providerAccountId: res.account_id, status: "warming" };
  }

  /**
   * Silent Infinite-login re-auth (CredentialsReconnectCapable). Called by
   * orchestration when a credentials account's session drops (Unipile CREDENTIALS
   * event → our restricted/disconnected). Re-logs in with the STORED credentials
   * and solves the 2FA checkpoint from the stored TOTP secret — no user action.
   */
  async reconnectWithCredentials(
    account: AccountRef,
    creds: CredentialsAuth,
    proxy?: ProxyConfig,
  ): Promise<AccountConnection> {
    const providerId = await this.loginWithCredentials(
      creds,
      buildConnectProxy({ proxy, country: proxy?.region }),
      undefined,
      account.providerAccountId,
    );
    return { accountId: account.accountId, providerAccountId: providerId, status: "warming" };
  }

  /**
   * Custom-auth login shared by the credentials connect + reconnect paths. Posts
   * username/password to /accounts; on a 2FA/OTP checkpoint, generates the current
   * TOTP from the shared secret and solves it. Endpoint + checkpoint payload shapes
   * follow Unipile's custom-auth + "solve checkpoint" docs (to confirm in a live
   * test — see the class-level endpoint-confidence note). Neither the password nor
   * the generated code is ever logged.
   */
  private async loginWithCredentials(
    creds: CredentialsAuth,
    proxyFields: Record<string, unknown>,
    userAgent?: string,
    reconnectProviderId?: string,
  ): Promise<string> {
    const res = await this.client.postJson<UnipileCredentialsResponse>("/api/v1/accounts", {
      provider: "LINKEDIN",
      username: creds.email,
      password: creds.password,
      ...(reconnectProviderId ? { reconnect_account: reconnectProviderId } : {}),
      ...(userAgent ? { user_agent: userAgent } : {}),
      ...proxyFields,
    });
    const accountId = res.account_id;
    if (!accountId) {
      throw new Error("Unipile credentials login did not return an account id");
    }
    const checkpointType =
      res.checkpoint?.type ?? (res.object?.toUpperCase() === "CHECKPOINT" ? "2FA" : undefined);
    if (checkpointType) {
      if (!creds.totpSecret) {
        throw new Error("LinkedIn requested a 2FA checkpoint but no TOTP secret is stored");
      }
      await this.client.postJson<UnipileCredentialsResponse>("/api/v1/accounts/checkpoint", {
        provider: "LINKEDIN",
        account_id: accountId,
        code: generateTotp(creds.totpSecret),
      });
    }
    return accountId;
  }

  async disconnectAccount(account: AccountRef): Promise<void> {
    await this.client.del(`/api/v1/accounts/${this.acc(account)}`);
  }

  async getAccountStatus(account: AccountRef): Promise<AccountStatus> {
    const acc = await this.client.getJson<UnipileAccountListItem>(
      `/api/v1/accounts/${this.acc(account)}`,
    );
    const status = acc.sources?.[0]?.status ?? "OK";
    return mapAccountStatus(status);
  }

  // --- hosted auth (provider-hosted connect; lowest friction) ---------------

  async createHostedAuthLink(params: HostedAuthLinkParams): Promise<HostedAuthLink> {
    const res = await this.client.postJson<UnipileHostedAuthResponse>(
      "/api/v1/hosted/accounts/link",
      {
        type: params.type,
        providers: ["LINKEDIN"],
        api_url: this.apiUrl,
        expiresOn: params.expiresAt,
        success_redirect_url: params.successRedirectUrl,
        failure_redirect_url: params.failureRedirectUrl,
        notify_url: params.notifyUrl,
        name: params.name,
        ...(params.type === "reconnect" && params.reconnectProviderAccountId
          ? { reconnect_account: params.reconnectProviderAccountId }
          : {}),
      },
    );
    return { url: res.url, expiresAt: params.expiresAt };
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

  // --- outreach actions -----------------------------------------------------

  sendConnectionRequest(
    account: AccountRef,
    lead: LeadRef,
    opts: ConnectionRequestOptions,
  ): Promise<ActionResult> {
    return this.run(opts.idempotencyKey, async () => {
      const providerId = await this.resolveProviderId(account, lead);
      const res = await this.client.postJson<UnipileSendResponse>("/api/v1/users/invite", {
        account_id: this.acc(account),
        provider_id: providerId,
        ...(opts.note ? { message: opts.note } : {}), // no-note default (§2)
      });
      return res.id ?? res.message_id;
    });
  }

  sendMessage(
    account: AccountRef,
    lead: LeadRef,
    content: MessageContent,
    opts: SendOptions,
  ): Promise<ActionResult> {
    return this.run(opts.idempotencyKey, () =>
      this.sendChat(account, lead, content.body, undefined, content.attachments),
    );
  }

  sendInMail(
    account: AccountRef,
    lead: LeadRef,
    content: InMailContent,
    opts: SendOptions,
  ): Promise<ActionResult> {
    return this.run(opts.idempotencyKey, () =>
      this.sendChat(account, lead, content.body, {
        "linkedin[api]": "classic",
        "linkedin[inmail]": "true",
      }),
    );
  }

  sendOpenProfileMessage(
    account: AccountRef,
    lead: LeadRef,
    content: MessageContent,
    opts: SendOptions,
  ): Promise<ActionResult> {
    return this.run(opts.idempotencyKey, () =>
      this.sendChat(account, lead, content.body, undefined, content.attachments),
    );
  }

  sendVoiceNote(
    _account: AccountRef,
    _lead: LeadRef,
    _audio: VoiceNoteRef,
    opts: SendOptions,
  ): Promise<ActionResult> {
    // Flagged (CLAUDE.md §14 vs docs): no native voice-note endpoint is documented
    // in the current Unipile API. Returned as a typed failure rather than guessing.
    return Promise.resolve({
      status: "failed",
      idempotencyKey: opts.idempotencyKey,
      error: {
        code: "invalid_request",
        message: VOICE_NOTE_UNSUPPORTED_REASON,
        retriable: false,
      },
    });
  }

  /**
   * Voice-note delivery capability (probed without sending). The current Unipile
   * API exposes no native LinkedIn voice-note endpoint, so this is NOT supported —
   * callers should construct the plan and stop, not attempt a send (Phase 7.1).
   */
  voiceNoteSupport(): { supported: boolean; reason?: string } {
    return { supported: false, reason: VOICE_NOTE_UNSUPPORTED_REASON };
  }

  likePost(account: AccountRef, lead: LeadRef, opts: SendOptions): Promise<ActionResult> {
    return this.run(opts.idempotencyKey, async () => {
      const postId = await this.latestPostId(account, lead);
      // Unipile reactions are body-addressed: POST /api/v1/posts/reaction with the
      // post's social_id in the body (NOT /posts/{id}/reaction, which 404s). Use the
      // social_id urn for reliability per Unipile's post-action guidance.
      await this.client.postJson(`/api/v1/posts/reaction`, {
        account_id: this.acc(account),
        post_id: postId,
        reaction_type: "like",
      });
      return postId;
    });
  }

  commentPost(
    account: AccountRef,
    lead: LeadRef,
    text: string,
    opts: SendOptions,
  ): Promise<ActionResult> {
    return this.run(opts.idempotencyKey, async () => {
      const postId = await this.latestPostId(account, lead);
      const res = await this.client.postJson<UnipileSendResponse>(
        `/api/v1/posts/${postId}/comments`,
        { account_id: this.acc(account), text },
      );
      return res.id;
    });
  }

  replyComment(
    _account: AccountRef,
    _lead: LeadRef,
    _text: string,
    opts: SendOptions,
  ): Promise<ActionResult> {
    // Replying to a SPECIFIC comment needs a target comment id, which LeadRef does
    // not model. Returned as a typed failure pending a richer target (to revisit).
    return Promise.resolve({
      status: "failed",
      idempotencyKey: opts.idempotencyKey,
      error: {
        code: "invalid_request",
        message: "unipile: replyComment requires a target comment id (not modeled yet)",
        retriable: false,
      },
    });
  }

  visitProfile(account: AccountRef, lead: LeadRef, opts: SendOptions): Promise<ActionResult> {
    // A profile view is a side-effect of fetching the profile (no dedicated action).
    return this.run(opts.idempotencyKey, async () => {
      const identifier = lead.providerId ?? publicIdentifier(lead.linkedinUrl);
      if (!identifier) {
        throw new UnipileHttpError(422, { detail: "lead has no providerId or linkedinUrl" });
      }
      await this.client.getJson(`/api/v1/users/${encodeURIComponent(identifier)}`, {
        account_id: this.acc(account),
      });
      return undefined;
    });
  }

  followLead(account: AccountRef, lead: LeadRef, opts: SendOptions): Promise<ActionResult> {
    // Best-effort: the follow endpoint is not clearly documented — to confirm live.
    return this.run(opts.idempotencyKey, async () => {
      const providerId = await this.resolveProviderId(account, lead);
      await this.client.postJson("/api/v1/users/follow", {
        account_id: this.acc(account),
        provider_id: providerId,
      });
      return providerId;
    });
  }

  // --- reads ----------------------------------------------------------------

  async fetchProfile(account: AccountRef, linkedinUrl: string): Promise<EnrichedProfile> {
    const identifier = publicIdentifier(linkedinUrl) ?? linkedinUrl;
    const p = await this.client.getJson<UnipileUserProfile>(
      `/api/v1/users/${encodeURIComponent(identifier)}`,
      { account_id: this.acc(account) },
    );
    const { firstName, lastName } = dropAnonymousName(p.first_name, p.last_name);
    // Pull recent activity ("what they've been up to") so the AI can open on a
    // specific, current observation — best-effort, never fails the enrichment.
    const recentPosts = p.provider_id ? await this.fetchRecentPosts(account, p.provider_id) : [];
    // Current employer: LinkedIn's full profile has no flat company field — it's
    // the current (or most-recent) work-experience entry. Fall back to the flat
    // field for surfaces that do send it.
    const currentRole = p.work_experience?.find((w) => w.current || !w.end) ?? p.work_experience?.[0];
    const company = p.current_company ?? currentRole?.company;
    const role = p.occupation ?? currentRole?.position;
    // Profile photo — read the variants Unipile uses (prefer the large one).
    const avatarUrl = p.profile_picture_url_large ?? p.profile_picture_url ?? p.picture_url;
    return {
      linkedinUrl,
      providerId: p.provider_id,
      firstName,
      lastName,
      ...(avatarUrl ? { avatarUrl } : {}),
      headline: p.headline,
      about: p.summary,
      ...(company ? { company } : {}),
      ...(role ? { role } : {}),
      location: p.location,
      connectionDegree: mapConnectionDegree(p.network_distance),
      ...(recentPosts.length ? { recentPosts } : {}),
    };
  }

  /**
   * Best-effort recent posts for enrichment. A posts failure (or activity hidden
   * by the prospect) returns [] — it must NEVER break profile enrichment. Consumes
   * the profile-visit budget (an extra read), accounted for by the caller.
   */
  private async fetchRecentPosts(account: AccountRef, providerId: string): Promise<RecentPost[]> {
    try {
      const list = await this.client.getJson<UnipilePostList>(
        `/api/v1/users/${encodeURIComponent(providerId)}/posts`,
        { account_id: this.acc(account), limit: "5" },
      );
      return mapRecentPosts(list, 3);
    } catch {
      return [];
    }
  }

  async fetchConversation(account: AccountRef, lead: LeadRef): Promise<Conversation> {
    // Best-effort: find a chat with this attendee, then its messages.
    if (!lead.providerId) {
      return { lead, channel: "linkedin", messages: [] };
    }
    // The `attendee_id` chat filter is unreliable against the live Unipile chat
    // API (verified: it returns no items even when a 1:1 chat with that attendee
    // exists). Try it first, then fall back to scanning the account's chats and
    // matching attendee_provider_id (the same id listConversations resolves by).
    const filtered = await this.client.getJson<ChatList>("/api/v1/chats", {
      account_id: this.acc(account),
      attendee_id: lead.providerId,
    });
    let chatId = filtered.items?.[0]?.id;
    if (!chatId) {
      const all = await this.client.getJson<ChatList>("/api/v1/chats", {
        account_id: this.acc(account),
        limit: "50",
      });
      chatId = all.items?.find((c) => c.attendee_provider_id === lead.providerId)?.id;
    }
    if (!chatId) {
      return { lead, channel: "linkedin", messages: [] };
    }
    const msgs = await this.client.getJson<ChatMessageList>(
      `/api/v1/chats/${chatId}/messages`,
      {},
    );
    const messages: Message[] = (msgs.items ?? []).map((m) => ({
      providerMessageId: m.id,
      direction: m.is_sender ? "outbound" : "inbound",
      channel: "linkedin",
      body: m.text,
      sentAt: m.timestamp ?? new Date().toISOString(),
    }));
    return { lead, channel: "linkedin", messages };
  }

  /**
   * Bulk-list the account's existing conversations for an inbox sync
   * (ConversationSyncCapable). Pulls chats, skips LinkedIn promotional/system
   * threads (content_type set), and resolves each thread's other attendee +
   * messages. Best-effort against the current Unipile chat API; verified against
   * a live account (chat.attendee_provider_id, message.is_sender, attendees).
   */
  async listConversations(
    account: AccountRef,
    opts?: ListConversationsOptions,
  ): Promise<ConversationPage> {
    const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 50);
    const chats = await this.client.getJson<ChatList>("/api/v1/chats", {
      account_id: this.acc(account),
      limit: String(limit),
      cursor: opts?.cursor,
    });

    const threads: ConversationThread[] = [];
    for (const chat of chats.items ?? []) {
      if (!chat.id || chat.content_type) {
        continue; // skip ads / sponsored / offer threads
      }
      const messages = await this.chatMessages(chat.id);
      if (messages.length === 0) {
        continue;
      }
      threads.push({
        providerChatId: chat.id,
        channel: "linkedin",
        attendee: await this.chatAttendee(chat),
        messages,
      });
    }

    const page: ConversationPage = { threads };
    if (chats.cursor) {
      page.nextCursor = chats.cursor;
    }
    return page;
  }

  /** The other party (not the account owner) of a chat, with name + profile. */
  private async chatAttendee(chat: ChatListItem): Promise<ConversationThread["attendee"]> {
    try {
      const res = await this.client.getJson<ChatAttendeeList>(
        `/api/v1/chats/${encodeURIComponent(chat.id!)}/attendees`,
        {},
      );
      const other = (res.items ?? []).find((a) => !a.is_self) ?? res.items?.[0];
      if (other) {
        const attendee: ConversationThread["attendee"] = {};
        const providerId = other.provider_id ?? chat.attendee_provider_id;
        if (providerId) attendee.providerId = providerId;
        const url =
          other.profile_url ??
          (providerId ? `https://www.linkedin.com/in/${providerId}` : undefined);
        if (url) attendee.linkedinUrl = url;
        if (other.name) attendee.name = other.name;
        if (other.specifics?.occupation) attendee.headline = other.specifics.occupation;
        const degree = mapConnectionDegree(other.specifics?.network_distance);
        if (degree !== undefined) attendee.connectionDegree = degree;
        return attendee;
      }
    } catch {
      // Fall through to the chat-level provider id below.
    }
    return chat.attendee_provider_id ? { providerId: chat.attendee_provider_id } : {};
  }

  /** A chat's text messages, oldest-first, mapped to our Message shape. */
  private async chatMessages(chatId: string): Promise<Message[]> {
    const res = await this.client.getJson<ChatMessageList>(
      `/api/v1/chats/${encodeURIComponent(chatId)}/messages`,
      { limit: "50" },
    );
    const messages: Message[] = [];
    for (const m of res.items ?? []) {
      const body = (m.text ?? "").trim();
      if (!body) {
        continue; // skip attachment-only / system messages (no renderable text)
      }
      messages.push({
        ...(m.id ? { providerMessageId: m.id } : {}),
        direction: m.is_sender ? "outbound" : "inbound",
        channel: "linkedin",
        body,
        sentAt: m.timestamp ?? new Date().toISOString(),
      });
    }
    // Unipile returns newest-first; store oldest-first for natural thread order.
    return messages.reverse();
  }

  // --- inbound --------------------------------------------------------------

  subscribeInboundEvents(handler: InboundEventHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** InboundWebhookReceiver: normalize a raw Unipile webhook + emit it. */
  async ingestWebhook(payload: unknown): Promise<void> {
    const event = normalizeWebhook(payload);
    if (event) {
      await this.emit(event);
    }
  }

  // --- internals ------------------------------------------------------------

  private async sendChat(
    account: AccountRef,
    lead: LeadRef,
    text: string,
    extra?: Record<string, string>,
    attachments?: MessageAttachment[],
  ): Promise<string | undefined> {
    const providerId = await this.resolveProviderId(account, lead);
    const fields = {
      account_id: this.acc(account),
      attendees_ids: providerId,
      text,
      ...extra,
    };
    // Unipile delivers attachments via multipart (≤15MB, image/video/file). The
    // transport needs the bytes, so each attachment must carry a fetchable url.
    const files = await this.buildAttachmentFiles(attachments);
    const res = files.length
      ? await this.client.postMultipart<UnipileSendResponse>("/api/v1/chats", fields, files)
      : await this.client.postForm<UnipileSendResponse>("/api/v1/chats", fields);
    return res.chat_id ?? res.message_id ?? res.id;
  }

  /**
   * Download each attachment's bytes (from its signed/public url) into a Blob for
   * multipart upload. An attachment with no fetchable url is a clean typed failure
   * (via UnipileHttpError → run()) — we never silently drop media.
   */
  private async buildAttachmentFiles(
    attachments?: MessageAttachment[],
  ): Promise<{ field: string; blob: Blob; filename: string }[]> {
    if (!attachments?.length) {
      return [];
    }
    const files: { field: string; blob: Blob; filename: string }[] = [];
    for (const a of attachments) {
      if (!a.url) {
        throw new UnipileHttpError(422, {
          detail: `attachment ${a.name ?? a.ref} has no fetchable URL (storage-ref resolution not wired)`,
        });
      }
      const r = await fetch(a.url);
      if (!r.ok) {
        throw new UnipileHttpError(502, { detail: `failed to fetch attachment ${a.name ?? a.ref}` });
      }
      const buf = await r.arrayBuffer();
      const blob = a.mime ? new Blob([buf], { type: a.mime }) : new Blob([buf]);
      files.push({ field: "attachments", blob, filename: a.name ?? a.ref.split("/").pop() ?? "attachment" });
    }
    return files;
  }

  private async resolveProviderId(account: AccountRef, lead: LeadRef): Promise<string> {
    if (lead.providerId) {
      return lead.providerId;
    }
    const identifier = publicIdentifier(lead.linkedinUrl);
    if (!identifier) {
      throw new UnipileHttpError(422, { detail: "lead has no providerId or linkedinUrl" });
    }
    const profile = await this.client.getJson<UnipileUserProfile>(
      `/api/v1/users/${encodeURIComponent(identifier)}`,
      { account_id: this.acc(account) },
    );
    if (!profile.provider_id) {
      throw new UnipileHttpError(404, { detail: "provider_id not found for lead" });
    }
    return profile.provider_id;
  }

  private async latestPostId(account: AccountRef, lead: LeadRef): Promise<string> {
    const providerId = await this.resolveProviderId(account, lead);
    const posts = await this.client.getJson<UnipilePostList>(
      `/api/v1/users/${encodeURIComponent(providerId)}/posts`,
      { account_id: this.acc(account) },
    );
    const postId = posts.items?.[0]?.social_id ?? posts.items?.[0]?.id;
    if (!postId) {
      throw new UnipileHttpError(404, { detail: "no recent post found for lead" });
    }
    return postId;
  }

  private async run(
    idempotencyKey: string,
    fn: () => Promise<string | undefined>,
  ): Promise<ActionResult> {
    try {
      const providerRef = await fn();
      return {
        status: "success",
        idempotencyKey,
        providerRef,
        at: new Date().toISOString(),
      };
    } catch (err) {
      return { status: "failed", idempotencyKey, error: mapHttpError(err) };
    }
  }

  private async emit(event: InboundEvent): Promise<void> {
    await Promise.all([...this.handlers].map((handler) => handler(event)));
  }

  /** The Unipile account id the API addresses (provider handle, else our id). */
  private acc(account: AccountRef): string {
    return account.providerAccountId ?? account.accountId;
  }
}

/**
 * LinkedIn returns the anonymized name "LinkedIn Member" for profiles the viewing
 * account can't see by name (out-of-network / privacy). That's not a usable name,
 * so drop it — the lead keeps whatever name we derived from its URL slug instead
 * of displaying a confusing "LinkedIn Member" contact (§2: no broken data).
 */
function dropAnonymousName(
  first?: string,
  last?: string,
): { firstName?: string; lastName?: string } {
  const full = [first, last].filter(Boolean).join(" ").trim().toLowerCase();
  if (full === "linkedin member") {
    return {};
  }
  return { firstName: first, lastName: last };
}

/** Extract the LinkedIn public identifier (the /in/{slug} part) from a URL. */
function publicIdentifier(linkedinUrl?: string): string | undefined {
  if (!linkedinUrl) {
    return undefined;
  }
  const match = linkedinUrl.match(/\/in\/([^/?#]+)/i);
  if (match) {
    return decodeURIComponent(match[1]);
  }
  // Not a /in/ URL — if it's already a bare identifier, use it.
  return /^[a-z0-9-]+$/i.test(linkedinUrl) ? linkedinUrl : undefined;
}
