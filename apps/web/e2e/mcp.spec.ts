// The LIVE MCP endpoint (POST /api/v1/mcp) authenticates with a workspace API
// key, speaks JSON-RPC over stateless Streamable HTTP, exposes the tool set, and
// hides mutating tools from a read-only key. Keys are seeded directly (no UI) so
// this is a pure API check against the running server. No LinkedIn/adapter
// activity — read tools + gating only.

import { expect, test } from "@playwright/test";

import { API_URL } from "./helpers/config";
import { loadContext, seedApiKey } from "./helpers/supabase";

const MCP = `${API_URL}/api/v1/mcp`;

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "e2e-client", version: "1.0.0" },
  },
};

/** enableJsonResponse → plain JSON; tolerate an SSE-framed body just in case. */
function parseRpc(text: string): Record<string, unknown> {
  const jsonText = text.startsWith("event:")
    ? (text.split("\n").find((l) => l.startsWith("data:")) ?? "data: {}").slice(5)
    : text;
  return JSON.parse(jsonText || "{}") as Record<string, unknown>;
}

function toolNames(json: Record<string, unknown>): string[] {
  const result = json.result as { tools?: Array<{ name: string }> } | undefined;
  return (result?.tools ?? []).map((t) => t.name);
}

function serverName(json: Record<string, unknown>): string | undefined {
  const result = json.result as { serverInfo?: { name?: string } } | undefined;
  return result?.serverInfo?.name;
}

function toolIsError(json: Record<string, unknown>): boolean {
  const result = json.result as { isError?: boolean } | undefined;
  return Boolean(result?.isError);
}

test("MCP: live endpoint authenticates, lists tools, gates read-only", async ({ request }) => {
  const { workspaceId } = loadContext();
  const allKey = await seedApiKey(workspaceId, "all");
  const roKey = await seedApiKey(workspaceId, "read_only");

  async function rpc(
    key: string | null,
    body: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await request.post(MCP, {
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      data: JSON.stringify(body),
    });
    return { status: res.status(), json: parseRpc(await res.text()) };
  }

  // --- Auth: no key is rejected ----------------------------------------------
  const noKey = await rpc(null, INITIALIZE);
  expect(noKey.status).toBe(401);

  // --- initialize handshake --------------------------------------------------
  const init = await rpc(allKey, INITIALIZE);
  expect(init.status).toBe(200);
  expect(serverName(init.json)).toBe("10xconnect");

  // --- tools/list (All key) exposes read + write tools -----------------------
  const list = await rpc(allKey, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = toolNames(list.json);
  for (const tool of [
    "list_campaigns",
    "list_conversations",
    "search_leads",
    "pause_campaign",
    "send_reply",
    "create_webhook",
  ]) {
    expect(names, `All key exposes ${tool}`).toContain(tool);
  }

  // --- tools/call a read tool succeeds ---------------------------------------
  const call = await rpc(allKey, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "list_campaigns", arguments: {} },
  });
  expect(call.status).toBe(200);
  expect(toolIsError(call.json), "list_campaigns did not error").toBeFalsy();

  // --- Read-only key: mutating tools are absent ------------------------------
  const roList = await rpc(roKey, { jsonrpc: "2.0", id: 4, method: "tools/list" });
  const roNames = toolNames(roList.json);
  expect(roNames).toContain("list_campaigns");
  for (const mutating of ["pause_campaign", "resume_campaign", "send_reply", "create_webhook"]) {
    expect(roNames, `${mutating} hidden from read-only key`).not.toContain(mutating);
  }
});
