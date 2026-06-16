import assert from "node:assert/strict";
import { test } from "node:test";

import type { InboundEvent } from "@10xconnect/core";

import { MockChannelAdapter } from "./mock-channel-adapter";

const account = { accountId: "acc-1" };
const lead = { leadId: "lead-1", linkedinUrl: "https://www.linkedin.com/in/ada-lovelace" };

test("records sends and returns a success result echoing the idempotency key", async () => {
  const adapter = new MockChannelAdapter();
  const result = await adapter.sendMessage(account, lead, { body: "Hi Ada" }, { idempotencyKey: "k1" });

  assert.equal(result.status, "success");
  assert.equal(result.status === "success" && result.idempotencyKey, "k1");
  assert.equal(adapter.recordedActions.length, 1);
  assert.equal(adapter.recordedActions[0]?.type, "message");

  // The outbound message lands in the conversation.
  const convo = await adapter.fetchConversation(account, lead);
  assert.equal(convo.messages.length, 1);
  assert.equal(convo.messages[0]?.direction, "outbound");
});

test("is idempotent: a repeated idempotency key never double-sends", async () => {
  const adapter = new MockChannelAdapter();
  await adapter.sendConnectionRequest(account, lead, { idempotencyKey: "dup" });
  const second = await adapter.sendConnectionRequest(account, lead, { idempotencyKey: "dup" });

  assert.equal(adapter.recordedActions.length, 1);
  assert.equal(second.status, "success");
  assert.equal(second.status === "success" && second.deduplicated, true);
});

test("connection requests default to no note (CLAUDE.md §2)", async () => {
  const adapter = new MockChannelAdapter();
  await adapter.sendConnectionRequest(account, lead, { idempotencyKey: "k" });
  assert.equal(adapter.recordedActions[0]?.detail?.note, null);
});

test("simulateInviteAccepted and simulateReply emit inbound events", async () => {
  const adapter = new MockChannelAdapter();
  const events: InboundEvent[] = [];
  adapter.subscribeInboundEvents((event) => {
    events.push(event);
  });

  await adapter.sendConnectionRequest(account, lead, { idempotencyKey: "k" });
  await adapter.simulateInviteAccepted(lead.leadId);
  await adapter.simulateReply(lead.leadId, "Sure, let's talk");

  assert.equal(events.length, 2);
  assert.equal(events[0]?.type, "invite_accepted");
  assert.equal(events[0]?.accountId, account.accountId); // correlated to the acting account
  assert.equal(events[1]?.type, "reply");
  assert.equal(events[1]?.type === "reply" && events[1].message.body, "Sure, let's talk");

  // The inbound reply is recorded in the conversation thread.
  const convo = await adapter.fetchConversation(account, lead);
  assert.ok(convo.messages.some((m) => m.direction === "inbound"));
});

test("forceError makes every send fail with a typed ChannelError", async () => {
  const adapter = new MockChannelAdapter({ forceError: "account_restricted" });
  const result = await adapter.sendMessage(account, lead, { body: "x" }, { idempotencyKey: "k1" });

  assert.equal(result.status, "failed");
  assert.equal(result.status === "failed" && result.error.code, "account_restricted");
  assert.equal(result.status === "failed" && result.error.retriable, false);
  assert.equal(adapter.recordedActions.length, 0); // nothing recorded on failure
});

test("simulateRestriction flips account status and emits a status-change event", async () => {
  const adapter = new MockChannelAdapter();
  const events: InboundEvent[] = [];
  adapter.subscribeInboundEvents((event) => {
    events.push(event);
  });

  await adapter.simulateRestriction("acc-1");

  assert.equal(await adapter.getAccountStatus({ accountId: "acc-1" }), "restricted");
  assert.equal(events[0]?.type, "account_status_changed");
  assert.equal(events[0]?.type === "account_status_changed" && events[0].status, "restricted");
});

test("unsubscribe stops event delivery", async () => {
  const adapter = new MockChannelAdapter();
  const events: InboundEvent[] = [];
  const unsubscribe = adapter.subscribeInboundEvents((event) => {
    events.push(event);
  });

  unsubscribe();
  await adapter.simulateMessageOpened(lead.leadId);

  assert.equal(events.length, 0);
});

test("fetchProfile returns plausible, deterministic enrichment from the URL", async () => {
  const adapter = new MockChannelAdapter();
  const profile = await adapter.fetchProfile(account, "https://www.linkedin.com/in/ada-lovelace");

  assert.equal(profile.linkedinUrl, "https://www.linkedin.com/in/ada-lovelace");
  assert.equal(profile.firstName, "Ada");
  assert.equal(profile.lastName, "Lovelace");
  assert.equal(typeof profile.headline, "string");
});
