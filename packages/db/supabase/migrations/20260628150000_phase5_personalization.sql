-- Phase 5 — Per-prospect preview cache + reusable AI prompt templates.
-- The preview cache stores the resolved personalization output per (node, contact,
-- prompt_version) so dispatch reuses it with NO second LLM call; editing the
-- prompt changes prompt_version, so the stale row is never read (invalidation).
-- ai_prompt_templates is the named, variable-driven, shareable prompt library.

-- ---------------------------------------------------------------------------
-- preview_cache: resolved personalization per (node, contact, prompt_version).
-- PK lets dispatch look the row up cheaply; a new prompt_version = a fresh row.
-- ---------------------------------------------------------------------------
create table public.preview_cache (
  node_id uuid not null references public.sequence_nodes (id) on delete cascade,
  contact_id uuid not null references public.leads (id) on delete cascade,
  prompt_version text not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  resolved_text text not null,
  tokens integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (node_id, contact_id, prompt_version)
);
create index idx_preview_cache_workspace on public.preview_cache (workspace_id);
create index idx_preview_cache_node on public.preview_cache (node_id);

alter table public.preview_cache enable row level security;
create policy "preview_cache_all_members" on public.preview_cache
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- ai_prompt_templates: named, variable-driven prompts. scope = private (mine) |
-- workspace (shared with the team) | community (curated/public). `variables` is
-- the list of contact-variable keys the body references; run_count bumps on use.
-- ---------------------------------------------------------------------------
create table public.ai_prompt_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  scope text not null default 'private',
  body text not null,
  variables jsonb not null default '[]'::jsonb,
  run_count integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_ai_prompt_templates_workspace on public.ai_prompt_templates (workspace_id);
create index idx_ai_prompt_templates_scope on public.ai_prompt_templates (workspace_id, scope);

create trigger ai_prompt_templates_set_updated_at
  before update on public.ai_prompt_templates
  for each row execute function public.set_updated_at();

alter table public.ai_prompt_templates enable row level security;
-- Members see their workspace's templates AND community templates from anywhere.
create policy "ai_prompt_templates_read" on public.ai_prompt_templates
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or scope = 'community');
create policy "ai_prompt_templates_write" on public.ai_prompt_templates
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
