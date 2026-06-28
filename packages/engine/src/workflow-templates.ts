// Workflow templates (Phase 6) — save a whole campaign's SHAPE as a reusable,
// shareable template, and APPLY it as a frozen clone into a fresh draft campaign.
// Backed by workflow_templates. Shared so the API and the test gate run the same
// logic.
//
// Two invariants this module enforces (Test Gate 6):
//  1. STRIP — a template stores graph + message skeletons + AI prompts + cadence +
//     brain defaults + required_inputs ONLY. It NEVER stores leads, accounts,
//     resolved/previewed per-contact messages, or knowledge-base content. We strip
//     account/media/resolved keys from every node config and we never read leads,
//     account_id, knowledge_base_id, or voice_profile_id into the template.
//  2. FROZEN CLONE — apply() deep-copies the structure into a NEW draft campaign
//     with 0 contacts (no FK back to the template), so editing the original
//     template later never mutates campaigns already spawned from it.

import { randomUUID } from "node:crypto";

import {
  computeRequiredInputs,
  defaultDailyCaps,
  defaultWeekSchedule,
  type GenNode,
  readMessageBody,
  type RequiredInput,
} from "@10xconnect/core";
import type { DB, Json, WorkflowTemplateScope } from "@10xconnect/db";
import type { Kysely } from "kysely";

// --- Shapes ----------------------------------------------------------------

/** A structure-only node in a stored template graph (edges by template-local key). */
export interface TemplateNode {
  key: string;
  kind: "action" | "condition";
  type: string;
  config: Record<string, unknown>;
  next: string | null;
  true: string | null;
  false: string | null;
  delayDays: number | null;
}

export interface MessageSkeleton {
  key: string;
  type: string;
  messageBody: unknown;
}

export interface WorkflowTemplateView {
  id: string;
  name: string;
  scope: WorkflowTemplateScope;
  templateVersion: number;
  graph: TemplateNode[];
  messages: MessageSkeleton[];
  aiPrompts: { key: string; prompt: string }[];
  cadence: { caps: unknown; schedule: unknown };
  brainDefaults: Record<string, unknown>;
  requiredInputs: RequiredInput[];
  createdAt?: string;
}

// Node config keys (matched case-INSENSITIVELY, at ANY nesting depth) that carry
// account / lead / media / resolved / voice-profile data — these are the applying
// user's required_inputs, never template content. Plus any key containing
// "resolved"/"preview" (a per-contact cache). Keep message SKELETONS, waits, notes,
// send conditions, subjects.
const STRIPPED_CONFIG_KEYS = new Set([
  // sender / account bindings (every casing + alias the permissive config allows)
  "senders",
  "sender",
  "senderid",
  "senderaccountid",
  "sendingaccountid",
  "from",
  "fromaccount",
  "accountid",
  "account_id",
  "accountids",
  // media + voice assets (workspace-private storage paths / profile ids)
  "attachments",
  "audioref",
  "audio_ref",
  "voiceprofileid",
  "voice_profile_id",
]);

function isStrippedKey(k: string): boolean {
  const key = k.toLowerCase();
  return STRIPPED_CONFIG_KEYS.has(key) || key.includes("resolved") || key.includes("preview");
}

/** Recursively drop stripped keys from any nested object/array, copying the rest. */
function stripValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isStrippedKey(k)) continue;
      out[k] = stripValue(v);
    }
    return out;
  }
  return value;
}

// Text-bearing node types whose body is a reusable message SKELETON.
const TEXT_BEARING = new Set([
  "send_message",
  "send_voice_note",
  "inmail",
  "send_message_to_open_profile",
  "comment_last_post",
  "reply_comment",
]);

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Strip a node config down to its reusable SKELETON: drop sender/account refs,
 * media attachments, and any "resolved"/"preview" cache field. Keeps message
 * structure (messageBody/body/text/aiPrompt), send conditions, notes, waits.
 */
export function stripNodeConfig(config: unknown): Record<string, unknown> {
  return stripValue(asObject(config)) as Record<string, unknown>;
}

interface NodeRow {
  id: string;
  kind: "action" | "condition";
  type: string;
  config: unknown;
  next_node_id: string | null;
  true_node_id: string | null;
  false_node_id: string | null;
  delay_days: number | null;
}

/** Convert sequence_nodes rows → a structure-only template graph (keys, stripped). */
export function templateGraphFromNodes(rows: NodeRow[]): TemplateNode[] {
  const keyById = new Map<string, string>();
  rows.forEach((r, i) => keyById.set(r.id, `t${i}`));
  const mapKey = (id: string | null): string | null => (id ? (keyById.get(id) ?? null) : null);
  return rows.map((r) => ({
    key: keyById.get(r.id) as string,
    kind: r.kind === "condition" ? "condition" : "action",
    type: r.type,
    config: stripNodeConfig(r.config),
    next: mapKey(r.next_node_id),
    true: mapKey(r.true_node_id),
    false: mapKey(r.false_node_id),
    delayDays: r.delay_days ?? null,
  }));
}

function messagesFromGraph(graph: TemplateNode[]): MessageSkeleton[] {
  return graph
    .filter((n) => TEXT_BEARING.has(n.type))
    .map((n) => ({ key: n.key, type: n.type, messageBody: readMessageBody(n.config) }));
}

function aiPromptsFromGraph(graph: TemplateNode[]): { key: string; prompt: string }[] {
  const out: { key: string; prompt: string }[] = [];
  for (const n of graph) {
    if (!TEXT_BEARING.has(n.type)) continue;
    const body = readMessageBody(n.config);
    for (const seg of body.segments) {
      if (seg.type === "ai" && seg.prompt && seg.prompt.trim()) {
        out.push({ key: n.key, prompt: seg.prompt.trim() });
      }
    }
  }
  return out;
}

/** The template graph as GenNode[] (kind/type/config) for required-input analysis. */
function toGenNodes(graph: TemplateNode[]): GenNode[] {
  return graph.map((n) => ({ kind: n.kind, type: n.type, config: n.config }));
}

function toView(row: {
  id: string;
  name: string;
  scope: string;
  template_version: number;
  graph: unknown;
  messages: unknown;
  ai_prompts: unknown;
  cadence: unknown;
  brain_defaults: unknown;
  required_inputs: unknown;
  created_at?: string;
}): WorkflowTemplateView {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope as WorkflowTemplateScope,
    templateVersion: Number(row.template_version),
    graph: asArray(row.graph) as TemplateNode[],
    messages: asArray(row.messages) as MessageSkeleton[],
    aiPrompts: asArray(row.ai_prompts) as { key: string; prompt: string }[],
    cadence: asObject(row.cadence) as { caps: unknown; schedule: unknown },
    brainDefaults: asObject(row.brain_defaults),
    requiredInputs: asArray(row.required_inputs) as RequiredInput[],
    createdAt: row.created_at,
  };
}

const SELECT = [
  "id",
  "name",
  "scope",
  "template_version",
  "graph",
  "messages",
  "ai_prompts",
  "cadence",
  "brain_defaults",
  "required_inputs",
  "created_at",
] as const;

const CAMPAIGN_BRAIN_COLS = ["objective", "guardrails", "voice", "autonomy", "limits", "budget"] as const;

// --- Save (campaign → template, with STRIP) --------------------------------

export interface SaveWorkflowTemplateInput {
  workspaceId: string;
  userId?: string | null;
  campaignId: string;
  name: string;
  scope?: WorkflowTemplateScope;
}

/**
 * Snapshot a campaign's SHAPE into a reusable template. Returns null if the
 * campaign isn't in the workspace. Strips all lead/account/resolved/KB data.
 */
export async function saveWorkflowTemplate(
  db: Kysely<DB>,
  input: SaveWorkflowTemplateInput,
): Promise<WorkflowTemplateView | null> {
  const campaign = await db
    .selectFrom("campaigns")
    .select(["id", "caps", "schedule", ...CAMPAIGN_BRAIN_COLS])
    .where("workspace_id", "=", input.workspaceId)
    .where("id", "=", input.campaignId)
    .executeTakeFirst();
  if (!campaign) return null;

  const rows = await db
    .selectFrom("sequence_nodes")
    .select(["id", "kind", "type", "config", "next_node_id", "true_node_id", "false_node_id", "delay_days"])
    .where("workspace_id", "=", input.workspaceId)
    .where("campaign_id", "=", input.campaignId)
    .orderBy("created_at", "asc")
    .execute();

  const graph = templateGraphFromNodes(rows as NodeRow[]);
  const messages = messagesFromGraph(graph);
  const aiPrompts = aiPromptsFromGraph(graph);
  const requiredInputs = computeRequiredInputs(toGenNodes(graph));
  // brain_defaults excludes knowledge_base_id / voice_profile_id / account_id by
  // construction — only the policy/config columns travel with the template.
  const brainDefaults: Record<string, unknown> = {};
  for (const col of CAMPAIGN_BRAIN_COLS) {
    brainDefaults[col] = (campaign as Record<string, unknown>)[col] ?? {};
  }
  const cadence = { caps: campaign.caps ?? {}, schedule: campaign.schedule ?? {} };

  const inserted = await db
    .insertInto("workflow_templates")
    .values({
      workspace_id: input.workspaceId,
      name: input.name,
      scope: input.scope ?? "private",
      graph: JSON.stringify(graph) as unknown as Json,
      messages: JSON.stringify(messages) as unknown as Json,
      ai_prompts: JSON.stringify(aiPrompts) as unknown as Json,
      cadence: JSON.stringify(cadence) as unknown as Json,
      brain_defaults: JSON.stringify(brainDefaults) as unknown as Json,
      required_inputs: JSON.stringify(requiredInputs) as unknown as Json,
      template_version: 1,
      created_by: input.userId ?? null,
    })
    .returning(SELECT)
    .executeTakeFirstOrThrow();
  return toView(inserted);
}

// --- List / get ------------------------------------------------------------

export async function listWorkflowTemplates(
  db: Kysely<DB>,
  input: { workspaceId: string; scope?: WorkflowTemplateScope },
): Promise<WorkflowTemplateView[]> {
  let q = db.selectFrom("workflow_templates").select(SELECT).orderBy("created_at", "desc");
  if (input.scope === "community") {
    q = q.where("scope", "=", "community");
  } else if (input.scope) {
    q = q.where("workspace_id", "=", input.workspaceId).where("scope", "=", input.scope);
  } else {
    q = q.where("workspace_id", "=", input.workspaceId);
  }
  return (await q.execute()).map(toView);
}

/** Load one template visible to the workspace (own workspace OR a community one). */
export async function getWorkflowTemplate(
  db: Kysely<DB>,
  input: { workspaceId: string; id: string },
): Promise<WorkflowTemplateView | null> {
  const row = await db
    .selectFrom("workflow_templates")
    .select(SELECT)
    .where("id", "=", input.id)
    .where((eb) => eb.or([eb("workspace_id", "=", input.workspaceId), eb("scope", "=", "community")]))
    .executeTakeFirst();
  return row ? toView(row) : null;
}

// --- Apply (template → fresh draft campaign clone) -------------------------

const DEFAULT_CAMPAIGN_SETTINGS = {
  skip_already_contacted: true,
  exclude_conn_req_from_reply_rate: true,
  follow_up_cap: 3,
};

export interface ApplyResult {
  campaignId: string;
  requiredInputs: RequiredInput[];
}

/**
 * Clone a template into a fresh DRAFT campaign with 0 contacts and surface the
 * required_inputs the user must supply (sender account, contacts, knowledge base,
 * voice). A pure copy — no link back to the template (frozen). Returns null if the
 * template isn't visible to the workspace.
 */
export async function applyWorkflowTemplate(
  db: Kysely<DB>,
  input: { workspaceId: string; templateId: string; name?: string },
): Promise<ApplyResult | null> {
  const t = await getWorkflowTemplate(db, { workspaceId: input.workspaceId, id: input.templateId });
  if (!t) return null;

  const brain = t.brainDefaults;
  const caps = t.cadence.caps && Object.keys(asObject(t.cadence.caps)).length > 0 ? t.cadence.caps : defaultDailyCaps();
  const schedule =
    t.cadence.schedule && Object.keys(asObject(t.cadence.schedule)).length > 0
      ? t.cadence.schedule
      : defaultWeekSchedule();

  return db.transaction().execute(async (trx) => {
    const campaign = await trx
      .insertInto("campaigns")
      .values({
        workspace_id: input.workspaceId,
        name: input.name?.trim() || `${t.name}`,
        status: "draft",
        account_id: null, // user supplies (required_input)
        caps: JSON.stringify(caps) as unknown as Json,
        schedule: JSON.stringify(schedule) as unknown as Json,
        settings: JSON.stringify(DEFAULT_CAMPAIGN_SETTINGS) as unknown as Json,
        objective: JSON.stringify(brain.objective ?? {}) as unknown as Json,
        guardrails: JSON.stringify(brain.guardrails ?? {}) as unknown as Json,
        voice: JSON.stringify(brain.voice ?? {}) as unknown as Json,
        autonomy: JSON.stringify(brain.autonomy ?? {}) as unknown as Json,
        limits: JSON.stringify(brain.limits ?? {}) as unknown as Json,
        budget: JSON.stringify(brain.budget ?? {}) as unknown as Json,
        knowledge_base_id: null, // user supplies (required_input)
        voice_profile_id: null, // user supplies if voice notes are used
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    // Deep-copy the graph: template-local keys → fresh uuids, edges preserved.
    const idByKey = new Map<string, string>();
    for (const n of t.graph) idByKey.set(n.key, randomUUID());
    const mapId = (key: string | null): string | null => (key ? (idByKey.get(key) ?? null) : null);

    if (t.graph.length > 0) {
      await trx
        .insertInto("sequence_nodes")
        .values(
          t.graph.map((n) => ({
            id: idByKey.get(n.key) as string,
            workspace_id: input.workspaceId,
            campaign_id: campaign.id,
            kind: n.kind,
            type: n.type,
            config: JSON.stringify(n.config ?? {}) as unknown as Json,
            next_node_id: mapId(n.next),
            true_node_id: mapId(n.true),
            false_node_id: mapId(n.false),
            delay_days: n.delayDays ?? null,
          })),
        )
        .execute();
    }

    return { campaignId: campaign.id, requiredInputs: t.requiredInputs };
  });
}

// --- Update / delete -------------------------------------------------------

/** Edit a template (rename / re-scope / replace graph). Bumps template_version on
 * a structural (graph) edit. Editing here NEVER touches campaigns already cloned. */
export async function updateWorkflowTemplate(
  db: Kysely<DB>,
  input: { workspaceId: string; id: string; name?: string; scope?: WorkflowTemplateScope; graph?: TemplateNode[] },
): Promise<WorkflowTemplateView | null> {
  const current = await db
    .selectFrom("workflow_templates")
    .select(["template_version"])
    .where("workspace_id", "=", input.workspaceId)
    .where("id", "=", input.id)
    .executeTakeFirst();
  if (!current) return null;

  const row = await db
    .updateTable("workflow_templates")
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.graph !== undefined
        ? {
            graph: JSON.stringify(input.graph) as unknown as Json,
            template_version: Number(current.template_version) + 1,
          }
        : {}),
    })
    .where("workspace_id", "=", input.workspaceId)
    .where("id", "=", input.id)
    .returning(SELECT)
    .executeTakeFirst();
  return row ? toView(row) : null;
}

export async function deleteWorkflowTemplate(
  db: Kysely<DB>,
  input: { workspaceId: string; id: string },
): Promise<void> {
  await db
    .deleteFrom("workflow_templates")
    .where("workspace_id", "=", input.workspaceId)
    .where("id", "=", input.id)
    .execute();
}
