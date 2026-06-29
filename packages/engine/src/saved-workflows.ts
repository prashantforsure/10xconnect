// Saved workflows (builder-only) — store a builder canvas SHAPE so a user can
// reuse a sequence they like across campaigns. Backed by saved_workflows. Shared
// so the API and its test gate run the same logic.
//
// Distinct from workflow-templates.ts: a workflow_template clones a WHOLE campaign
// (graph + brain + cadence + required_inputs) into a fresh draft. A saved_workflow
// holds ONLY the node graph and is loaded straight into the builder canvas of the
// campaign you're already editing.
//
// SHAPE-ONLY invariant (same as templates): every node config is run through
// stripNodeConfig() before insert, so sender/account bindings, media/voice assets,
// and any resolved/preview per-contact cache never travel with a saved workflow.

import type { DB, Json } from "@10xconnect/db";
import type { Kysely } from "kysely";

import { stripNodeConfig } from "./workflow-templates";

/** A builder canvas node (matches apps/web lib/campaigns/graph.ts GraphNode). */
export interface SavedWorkflowNode {
  id: string;
  kind: "action" | "condition";
  type: string;
  config: Record<string, unknown>;
  next: string | null;
  true: string | null;
  false: string | null;
  delayDays: number | null;
}

export interface SavedWorkflowView {
  id: string;
  name: string;
  graph: SavedWorkflowNode[];
  createdAt?: string;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Strip each node config down to its reusable skeleton (shape-only invariant). */
function sanitizeGraph(graph: SavedWorkflowNode[]): SavedWorkflowNode[] {
  return graph.map((n) => ({
    id: n.id,
    kind: n.kind === "condition" ? "condition" : "action",
    type: n.type,
    config: stripNodeConfig(n.config),
    next: n.next ?? null,
    true: n.true ?? null,
    false: n.false ?? null,
    delayDays: n.delayDays ?? null,
  }));
}

const SELECT = ["id", "name", "graph", "created_at"] as const;

function toView(row: { id: string; name: string; graph: unknown; created_at?: string }): SavedWorkflowView {
  return {
    id: row.id,
    name: row.name,
    graph: asArray(row.graph) as SavedWorkflowNode[],
    createdAt: row.created_at,
  };
}

export async function listSavedWorkflows(
  db: Kysely<DB>,
  input: { workspaceId: string },
): Promise<SavedWorkflowView[]> {
  const rows = await db
    .selectFrom("saved_workflows")
    .select(SELECT)
    .where("workspace_id", "=", input.workspaceId)
    .orderBy("created_at", "desc")
    .execute();
  return rows.map(toView);
}

export async function createSavedWorkflow(
  db: Kysely<DB>,
  input: { workspaceId: string; userId?: string | null; name: string; graph: SavedWorkflowNode[] },
): Promise<SavedWorkflowView> {
  const graph = sanitizeGraph(input.graph);
  const inserted = await db
    .insertInto("saved_workflows")
    .values({
      workspace_id: input.workspaceId,
      name: input.name,
      graph: JSON.stringify(graph) as unknown as Json,
      created_by: input.userId ?? null,
    })
    .returning(SELECT)
    .executeTakeFirstOrThrow();
  return toView(inserted);
}

export async function deleteSavedWorkflow(
  db: Kysely<DB>,
  input: { workspaceId: string; id: string },
): Promise<void> {
  await db
    .deleteFrom("saved_workflows")
    .where("workspace_id", "=", input.workspaceId)
    .where("id", "=", input.id)
    .execute();
}
