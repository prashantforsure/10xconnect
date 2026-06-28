-- Phase 6 — Workflow templates (whole-campaign blueprints, STRUCTURE ONLY).
-- A workflow_template is a reusable, shareable copy of a campaign's SHAPE: its
-- node graph, message skeletons (variables + AI chips, never resolved per-contact
-- text), referenced AI prompts, cadence (caps + schedule), brain defaults
-- (objective/guardrails/voice/autonomy/limits/budget), and the required_inputs the
-- user must supply on apply. It NEVER stores leads, accounts, resolved/previewed
-- messages, or knowledge-base content — those are always the applying user's input.
--
-- Apply CLONES the template into a fresh DRAFT campaign with 0 contacts (a frozen
-- copy): editing the original template afterward never touches campaigns already
-- spawned from it (no FK link, pure copy). template_version is bumped on edit but
-- there is NO auto-propagation.

create table public.workflow_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  scope text not null default 'private',  -- private (mine) | workspace (team) | community (public)
  graph jsonb not null default '[]'::jsonb,            -- structure-only node list (edges by template-local key)
  messages jsonb not null default '[]'::jsonb,         -- text-bearing message skeletons (no resolved text)
  ai_prompts jsonb not null default '[]'::jsonb,       -- AI-chip prompt skeletons referenced by the graph
  cadence jsonb not null default '{}'::jsonb,          -- { caps, schedule } structure
  brain_defaults jsonb not null default '{}'::jsonb,   -- { objective, guardrails, voice, autonomy, limits, budget }
  required_inputs jsonb not null default '[]'::jsonb,  -- [{ key, kind, label, required }] the user must supply
  template_version integer not null default 1,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_workflow_templates_workspace on public.workflow_templates (workspace_id);
create index idx_workflow_templates_scope on public.workflow_templates (workspace_id, scope);

create trigger workflow_templates_set_updated_at
  before update on public.workflow_templates
  for each row execute function public.set_updated_at();

alter table public.workflow_templates enable row level security;
-- Members see their workspace's templates AND community templates from anywhere
-- (so a shared/community workflow can be discovered + applied cross-workspace).
create policy "workflow_templates_read" on public.workflow_templates
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or scope = 'community');
create policy "workflow_templates_write" on public.workflow_templates
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
