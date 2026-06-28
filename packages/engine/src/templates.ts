// AI prompt template library (Phase 5) — named, variable-driven, shareable prompts
// backed by ai_prompt_templates. scope = private (mine) | workspace (shared with
// the team) | community (curated/public). run_count bumps each time a template is
// used (inserted into a composer AI chip). Shared so the API and the gate exercise
// the same logic.

import type { DB, PromptTemplateScope } from "@10xconnect/db";
import type { Kysely } from "kysely";

export interface PromptTemplate {
  id: string;
  name: string;
  scope: PromptTemplateScope;
  body: string;
  variables: string[];
  runCount: number;
}

function asVariables(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function toTemplate(row: { id: string; name: string; scope: string; body: string; variables: unknown; runCount: number | string }): PromptTemplate {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope as PromptTemplateScope,
    body: row.body,
    variables: asVariables(row.variables),
    runCount: Number(row.runCount),
  };
}

const SELECT = ["id", "name", "scope", "body", "variables", "run_count as runCount"] as const;

/** Save a new template (defaults to a private "mine" template). */
export async function saveTemplate(
  db: Kysely<DB>,
  input: { workspaceId: string; userId?: string | null; name: string; body: string; variables?: string[]; scope?: PromptTemplateScope },
): Promise<PromptTemplate> {
  const row = await db
    .insertInto("ai_prompt_templates")
    .values({
      workspace_id: input.workspaceId,
      name: input.name,
      body: input.body,
      scope: input.scope ?? "private",
      variables: JSON.stringify(input.variables ?? []),
      created_by: input.userId ?? null,
    })
    .returning(SELECT)
    .executeTakeFirstOrThrow();
  return toTemplate(row);
}

/**
 * List templates by scope. community = curated/public from ANY workspace; private
 * + workspace are scoped to this workspace. Omit scope → all of the workspace's.
 */
export async function listTemplates(
  db: Kysely<DB>,
  input: { workspaceId: string; scope?: PromptTemplateScope },
): Promise<PromptTemplate[]> {
  let q = db.selectFrom("ai_prompt_templates").select(SELECT).orderBy("run_count", "desc");
  if (input.scope === "community") {
    q = q.where("scope", "=", "community");
  } else if (input.scope) {
    q = q.where("workspace_id", "=", input.workspaceId).where("scope", "=", input.scope);
  } else {
    q = q.where("workspace_id", "=", input.workspaceId);
  }
  return (await q.execute()).map(toTemplate);
}

/** Edit a template (rename, edit body/variables, or change share scope). */
export async function updateTemplate(
  db: Kysely<DB>,
  input: { workspaceId: string; id: string; name?: string; body?: string; variables?: string[]; scope?: PromptTemplateScope },
): Promise<PromptTemplate | null> {
  const row = await db
    .updateTable("ai_prompt_templates")
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.variables !== undefined ? { variables: JSON.stringify(input.variables) } : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
    })
    .where("workspace_id", "=", input.workspaceId)
    .where("id", "=", input.id)
    .returning(SELECT)
    .executeTakeFirst();
  return row ? toTemplate(row) : null;
}

/** Bump run_count when a template is used; returns the new count (-1 if missing). */
export async function useTemplate(db: Kysely<DB>, input: { workspaceId: string; id: string }): Promise<{ runCount: number }> {
  const row = await db
    .updateTable("ai_prompt_templates")
    .set((eb) => ({ run_count: eb("run_count", "+", 1) }))
    .where("id", "=", input.id)
    .where((eb) => eb.or([eb("workspace_id", "=", input.workspaceId), eb("scope", "=", "community")]))
    .returning("run_count as runCount")
    .executeTakeFirst();
  return { runCount: row ? Number(row.runCount) : -1 };
}

export async function deleteTemplate(db: Kysely<DB>, input: { workspaceId: string; id: string }): Promise<void> {
  await db.deleteFrom("ai_prompt_templates").where("workspace_id", "=", input.workspaceId).where("id", "=", input.id).execute();
}
