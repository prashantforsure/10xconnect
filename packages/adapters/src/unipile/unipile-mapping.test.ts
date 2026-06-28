import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildConnectProxy,
  mapAccountStatus,
  mapConnectionDegree,
  mapHttpError,
  mapRecentPosts,
  parseProxyUrl,
} from "./mappers";
import { UnipileHttpError } from "./unipile-client";
import { normalizeWebhook } from "./webhook-normalizer";

test("mapAccountStatus maps Unipile statuses onto our AccountStatus", () => {
  assert.equal(mapAccountStatus("OK"), "active");
  assert.equal(mapAccountStatus("SYNC_SUCCESS"), "active");
  assert.equal(mapAccountStatus("CONNECTING"), "warming");
  assert.equal(mapAccountStatus("CREDENTIALS"), "restricted"); // checkpoint/re-auth → restriction
  assert.equal(mapAccountStatus("ERROR"), "disconnected");
  assert.equal(mapAccountStatus("WHATEVER"), "disconnected");
});

test("mapHttpError classifies HTTP statuses into the error taxonomy", () => {
  const rate = mapHttpError(new UnipileHttpError(429, { detail: "slow down" }, 30_000));
  assert.equal(rate.code, "rate_limited");
  assert.equal(rate.retriable, true);
  assert.equal(rate.retryAfterMs, 30_000);

  assert.equal(mapHttpError(new UnipileHttpError(404, {})).code, "lead_not_found");
  assert.equal(mapHttpError(new UnipileHttpError(401, {})).code, "invalid_request");
  assert.equal(mapHttpError(new UnipileHttpError(422, {})).code, "invalid_request");

  const checkpoint = mapHttpError(new UnipileHttpError(403, { detail: "Checkpoint required" }));
  assert.equal(checkpoint.code, "captcha_required");

  const server = mapHttpError(new UnipileHttpError(503, {}));
  assert.equal(server.code, "provider_error");
  assert.equal(server.retriable, true);

  const network = mapHttpError(new Error("connect ETIMEDOUT"));
  assert.equal(network.code, "timeout");
  assert.equal(network.retriable, true);
});

test("parseProxyUrl handles url and host:port[:user:pass] forms", () => {
  assert.deepEqual(parseProxyUrl("http://user:pass@host.com:1080"), {
    host: "host.com",
    port: 1080,
    username: "user",
    password: "pass",
  });
  assert.deepEqual(parseProxyUrl("socks5://1.2.3.4:9000"), { host: "1.2.3.4", port: 9000 });
  assert.deepEqual(parseProxyUrl("proxy.com:1123:bob:s3cr3t"), {
    host: "proxy.com",
    port: 1123,
    username: "bob",
    password: "s3cr3t",
  });
  assert.deepEqual(parseProxyUrl("proxy.com:8080"), { host: "proxy.com", port: 8080 });
  assert.equal(parseProxyUrl("not-a-proxy"), undefined);
  assert.equal(parseProxyUrl(""), undefined);
});

test("buildConnectProxy: own → proxy object, bundled → region country, else empty", () => {
  assert.deepEqual(
    buildConnectProxy({ country: "IN", proxy: { mode: "own", url: "host:1123:u:p" } }),
    { proxy: { host: "host", port: 1123, username: "u", password: "p" } },
  );
  // bundled uses the account country (region-matched residential IP)
  assert.deepEqual(buildConnectProxy({ country: "in", proxy: { mode: "bundled", region: "IN" } }), {
    country: "IN",
  });
  // bundled with no usable country → nothing (Unipile default)
  assert.deepEqual(buildConnectProxy({ proxy: { mode: "bundled" } }), {});
  // own with an unparseable url → nothing rather than a broken proxy
  assert.deepEqual(buildConnectProxy({ country: "US", proxy: { mode: "own", url: "garbage" } }), {});
});

test("mapRecentPosts reads varied post shapes defensively + skips empty/idless", () => {
  const posts = mapRecentPosts({
    items: [
      { social_id: "p1", text: "Shipped our new onboarding flow this week 🚀", date: "2026-06-20T00:00:00Z", share_url: "https://x/p1" },
      { id: "p2", commentary: "Hiring two data scientists", parsed_datetime: "2026-06-18T00:00:00Z" }, // alt field names
      { id: "p3", text: "   " }, // empty text → skipped
      { text: "no id here" }, // no postId → skipped
    ],
  });
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], {
    postId: "p1",
    text: "Shipped our new onboarding flow this week 🚀",
    postedAt: "2026-06-20T00:00:00Z",
    url: "https://x/p1",
  });
  assert.equal(posts[1]!.postId, "p2");
  assert.equal(posts[1]!.text, "Hiring two data scientists");
  assert.equal(posts[1]!.postedAt, "2026-06-18T00:00:00Z");
  // limit + empty list
  assert.equal(mapRecentPosts({ items: [{ id: "a", text: "x" }, { id: "b", text: "y" }] }, 1).length, 1);
  assert.deepEqual(mapRecentPosts(undefined), []);
});

test("mapConnectionDegree parses network distance", () => {
  assert.equal(mapConnectionDegree("FIRST_DEGREE"), 1);
  assert.equal(mapConnectionDegree("DISTANCE_2"), 2);
  assert.equal(mapConnectionDegree(undefined), undefined);
});

test("normalizeWebhook: account_status → account_status_changed", () => {
  const event = normalizeWebhook({
    AccountStatus: { account_id: "acc-1", account_type: "LINKEDIN", message: "CREDENTIALS" },
  });
  assert.equal(event?.type, "account_status_changed");
  assert.equal(event?.type === "account_status_changed" && event.status, "restricted");
  assert.equal(event?.accountId, "acc-1");
});

test("normalizeWebhook: inbound message_received → reply", () => {
  const event = normalizeWebhook({
    event: "message_received",
    account_id: "acc-1",
    chat_id: "chat-1",
    message: "Sounds good!",
    message_id: "msg-1",
    sender: { attendee_provider_id: "LEAD_PROVIDER" },
    account_info: { user_id: "OWNER_PROVIDER" },
  });
  assert.equal(event?.type, "reply");
  assert.equal(event?.id, "msg-1");
  assert.equal(event?.type === "reply" && event.message.body, "Sounds good!");
  assert.equal(event?.type === "reply" && event.lead.providerId, "LEAD_PROVIDER");
});

test("normalizeWebhook: own outbound message (sender == owner) is dropped", () => {
  const event = normalizeWebhook({
    event: "message_received",
    account_id: "acc-1",
    message: "I sent this",
    sender: { attendee_provider_id: "OWNER" },
    account_info: { user_id: "OWNER" },
  });
  assert.equal(event, null);
});

test("normalizeWebhook: message_read → message_opened", () => {
  const event = normalizeWebhook({
    event: "message_read",
    account_id: "acc-1",
    message_id: "msg-9",
    sender: { attendee_provider_id: "LEAD" },
  });
  assert.equal(event?.type, "message_opened");
});

test("normalizeWebhook: relations → invite_accepted", () => {
  const event = normalizeWebhook({
    event: "new_relation",
    account_id: "acc-1",
    user_provider_id: "NEW_CONN",
    user_public_identifier: "ada-lovelace",
  });
  assert.equal(event?.type, "invite_accepted");
  assert.equal(event?.type === "invite_accepted" && event.lead.providerId, "NEW_CONN");
  assert.equal(
    event?.type === "invite_accepted" && event.lead.linkedinUrl,
    "https://www.linkedin.com/in/ada-lovelace",
  );
});

test("normalizeWebhook: unrecognized payload → null", () => {
  assert.equal(normalizeWebhook({ foo: "bar" }), null);
  assert.equal(normalizeWebhook(null), null);
  assert.equal(normalizeWebhook("nope"), null);
});
