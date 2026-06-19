import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActionResult, ChannelAdapter } from "@10xconnect/core";

import { executeTransportAction, type ExecuteInput } from "./executor";
import type { LeadRow } from "./types";

function lead(enrichment: Record<string, unknown>): LeadRow {
  return {
    id: "lead-1",
    workspace_id: "ws-1",
    linkedin_url: "https://linkedin.com/in/x",
    email: null,
    enrichment: enrichment as LeadRow["enrichment"],
    tags: [],
    custom_columns: {},
    connection_degree: 1,
  };
}

/** Minimal adapter that records the body passed to sendMessage. */
function captureAdapter(sink: { body?: string }): ChannelAdapter {
  const ok: ActionResult = {
    status: "success",
    idempotencyKey: "k",
    at: new Date().toISOString(),
  };
  return {
    sendMessage: async (_a: unknown, _l: unknown, content: { body: string }) => {
      sink.body = content.body;
      return ok;
    },
  } as unknown as ChannelAdapter;
}

function input(over: Partial<ExecuteInput> & { adapter: ChannelAdapter }): ExecuteInput {
  return {
    accountRef: { accountId: "acc-1" },
    leadRef: { leadId: "lead-1" },
    workspaceId: "ws-1",
    nodeType: "send_message",
    config: {},
    idempotencyKey: "k",
    lead: lead({}),
    ...over,
  };
}

test("executor renders a structured body with fallback + skip-on-empty (no broken merge)", async () => {
  const sink: { body?: string } = {};
  const adapter = captureAdapter(sink);
  const messageBody = {
    v: 1,
    segments: [
      { type: "text", text: "Hi " },
      { type: "variable", key: "first_name", fallback: "there" },
      { type: "text", text: ", saw " },
      { type: "variable", key: "company" },
      { type: "text", text: " is hiring" },
    ],
  };
  // No enrichment: first_name → fallback "there"; company → dropped.
  await executeTransportAction(input({ adapter, config: { messageBody } }));
  assert.equal(sink.body, "Hi there, saw is hiring");

  // With enrichment, both variables resolve.
  await executeTransportAction(
    input({ adapter, config: { messageBody }, lead: lead({ firstName: "Jane", company: "Acme" }) }),
  );
  assert.equal(sink.body, "Hi Jane, saw Acme is hiring");
});

test("executor renders a legacy {token} body with skip-on-empty", async () => {
  const sink: { body?: string } = {};
  await executeTransportAction(
    input({ adapter: captureAdapter(sink), config: { body: "Hi {first_name}," } }),
  );
  assert.equal(sink.body, "Hi,");
});

test("executor routes AI-bearing bodies through resolveContent", async () => {
  const sink: { body?: string } = {};
  await executeTransportAction(
    input({
      adapter: captureAdapter(sink),
      config: { messageBody: { v: 1, segments: [{ type: "ai", prompt: "observe" }] }, aiPrompt: "observe" },
      lead: lead({ firstName: "Jane" }),
      resolveContent: () => "AI LINE",
    }),
  );
  assert.equal(sink.body, "AI LINE");
});
