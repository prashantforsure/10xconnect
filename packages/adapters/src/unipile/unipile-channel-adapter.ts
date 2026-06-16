import type {
  AccountConnection,
  AccountRef,
  AccountStatus,
  ActionResult,
  ChannelAdapter,
  ConnectInput,
  ConnectionRequestOptions,
  Conversation,
  EnrichedProfile,
  InboundEvent,
  InboundEventHandler,
  InMailContent,
  LeadRef,
  Message,
  MessageContent,
  SendOptions,
  Unsubscribe,
  VoiceNoteRef,
} from "@10xconnect/core";

import type { InboundWebhookReceiver } from "../webhook-receiver";

import { mapAccountStatus, mapConnectionDegree, mapHttpError } from "./mappers";
import { UnipileClient, UnipileHttpError } from "./unipile-client";
import type {
  UnipileAccountListItem,
  UnipileConfig,
  UnipileCreateAccountResponse,
  UnipileSendResponse,
  UnipileUserProfile,
} from "./unipile-types";
import { normalizeWebhook } from "./webhook-normalizer";

interface UserPostList {
  items?: { id?: string; social_id?: string }[];
}
interface ChatList {
  items?: { id?: string }[];
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
export class UnipileChannelAdapter implements ChannelAdapter, InboundWebhookReceiver {
  private readonly client: UnipileClient;
  private readonly handlers = new Set<InboundEventHandler>();

  constructor(config: UnipileConfig) {
    this.client = new UnipileClient(config);
  }

  // --- account lifecycle ----------------------------------------------------

  async connectAccount(input: ConnectInput): Promise<AccountConnection> {
    if (input.method !== "credentials" || !input.credentials) {
      throw new Error(
        "UnipileChannelAdapter.connectAccount supports the credentials method here; " +
          "production connects should use Unipile hosted auth (added in the accounts step).",
      );
    }
    const res = await this.client.postJson<UnipileCreateAccountResponse>("/api/v1/accounts", {
      provider: "LINKEDIN",
      username: input.credentials.email,
      password: input.credentials.password,
    });
    // 2FA/checkpoint flows are not handled here (documented limitation).
    return { accountId: res.account_id, providerAccountId: res.account_id, status: "warming" };
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
    return this.run(opts.idempotencyKey, () => this.sendChat(account, lead, content.body));
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
    return this.run(opts.idempotencyKey, () => this.sendChat(account, lead, content.body));
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
        message: "unipile: native voice notes are not supported by the current Unipile API",
        retriable: false,
      },
    });
  }

  likePost(account: AccountRef, lead: LeadRef, opts: SendOptions): Promise<ActionResult> {
    return this.run(opts.idempotencyKey, async () => {
      const postId = await this.latestPostId(account, lead);
      await this.client.postJson(`/api/v1/posts/${postId}/reaction`, {
        account_id: this.acc(account),
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
    return {
      linkedinUrl,
      providerId: p.provider_id,
      firstName: p.first_name,
      lastName: p.last_name,
      headline: p.headline,
      about: p.summary,
      company: p.current_company,
      role: p.occupation,
      location: p.location,
      connectionDegree: mapConnectionDegree(p.network_distance),
    };
  }

  async fetchConversation(account: AccountRef, lead: LeadRef): Promise<Conversation> {
    // Best-effort: find a chat with this attendee, then its messages.
    if (!lead.providerId) {
      return { lead, channel: "linkedin", messages: [] };
    }
    const chats = await this.client.getJson<ChatList>("/api/v1/chats", {
      account_id: this.acc(account),
      attendee_id: lead.providerId,
    });
    const chatId = chats.items?.[0]?.id;
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
  ): Promise<string | undefined> {
    const providerId = await this.resolveProviderId(account, lead);
    const res = await this.client.postForm<UnipileSendResponse>("/api/v1/chats", {
      account_id: this.acc(account),
      attendees_ids: providerId,
      text,
      ...extra,
    });
    return res.chat_id ?? res.message_id ?? res.id;
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
    const posts = await this.client.getJson<UserPostList>(
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
