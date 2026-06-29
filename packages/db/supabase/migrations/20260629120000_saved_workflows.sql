-- Saved workflows (builder-only) — a lightweight, workspace-private store of a
-- builder canvas SHAPE so users can reuse a sequence they like across campaigns.
--
-- Distinct from workflow_templates (Phase 6): a workflow_template clones a WHOLE
-- campaign (graph + brain + cadence + required_inputs) into a fresh draft. A
-- saved_workflow stores ONLY the node graph and is loaded straight into the
-- builder canvas of the campaign you're already editing. Like templates, it holds
-- SHAPE ONLY: sender/account bindings, media/voice assets, and any resolved/
-- previewed per-contact data are stripped before insert (engine saved-workflows.ts).
--
-- No 'community' scope — saved workflows are always private to the workspace.

create table public.saved_workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  graph jsonb not null default '[]'::jsonb,  -- builder GraphNode[] (shape only, stripped)
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_saved_workflows_workspace on public.saved_workflows (workspace_id);

create trigger saved_workflows_set_updated_at
  before update on public.saved_workflows
  for each row execute function public.set_updated_at();

alter table public.saved_workflows enable row level security;
-- Workspace members can read + manage their workspace's saved workflows. No
-- cross-workspace/community visibility.
create policy "saved_workflows_read" on public.saved_workflows
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "saved_workflows_write" on public.saved_workflows
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
