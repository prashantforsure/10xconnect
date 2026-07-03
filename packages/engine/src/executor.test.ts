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

/** Voice adapter spy: counts sends + reports a delivery capability. */
function voiceAdapter(support: boolean, calls: { sent: number }): ChannelAdapter {
  return {
    voiceNoteSupport: () => ({ supported: support, reason: support ? undefined : "no native voice endpoint" }),
    sendVoiceNote: async (_a: unknown, _l: unknown, _audio: unknown, opts: { idempotencyKey: string }) => {
      calls.sent += 1;
      return { status: "success", idempotencyKey: opts.idempotencyKey, at: new Date().toISOString() } as ActionResult;
    },
  } as unknown as ChannelAdapter;
}

test("executor REFUSES voice-note dispatch when the transport can't deliver (no send) — safety gate", async () => {
  const calls = { sent: 0 };
  const result = await executeTransportAction(
    input({ adapter: voiceAdapter(false, calls), nodeType: "send_voice_note", config: { audioRef: "x", durationMs: 20_000 } }),
  );
  assert.equal(result.status, "failed", "dispatch refused in our layer");
  assert.equal(result.status === "failed" && result.error.code, "invalid_request");
  assert.equal(calls.sent, 0, "transport.sendVoiceNote NEVER called — the guarantee is ours, not the provider's");
});

test("executor sends a voice note only when the transport reports it can deliver", async () => {
  const calls = { sent: 0 };
  const result = await executeTransportAction(
    input({ adapter: voiceAdapter(true, calls), nodeType: "send_voice_note", config: { audioRef: "x" } }),
  );
  assert.equal(result.status, "success");
  assert.equal(calls.sent, 1, "send happens only behind an explicit capability");
});

test("executor SIMULATES: simulate=true never touches the transport — safe production testing", async () => {
  const calls = { sent: 0 };
  const spy = {
    sendMessage: async () => {
      calls.sent += 1;
      return { status: "success", idempotencyKey: "k", at: new Date().toISOString() } as ActionResult;
    },
  } as unknown as ChannelAdapter;
  const result = await executeTransportAction(input({ adapter: spy, config: { body: "Hi" }, simulate: true }));
  assert.equal(result.status, "success", "pipeline still advances on a synthetic success");
  assert.equal(result.status === "success" && result.providerRef, "SIMULATED");
  assert.equal(calls.sent, 0, "transport.sendMessage NEVER called in simulation mode");
});
