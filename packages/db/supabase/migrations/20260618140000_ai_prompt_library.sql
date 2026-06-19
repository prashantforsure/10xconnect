-- AI prompt library (CLAUDE.md §8 E2): per-workspace prompts gain a usage counter,
-- and a per-user favorites table powers the "Saved" tab (favorites can point at a
-- curated Community prompt — "community:<slug>" — or a workspace prompt —
-- "workspace:<uuid>" — via a string ref, so no FK to the code-defined community set).

alter table public.ai_prompts
  add column if not exists run_count integer not null default 0;

create table if not exists public.ai_prompt_favorites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  prompt_ref text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id, prompt_ref)
);
create index if not exists idx_ai_prompt_favorites_ws_user
  on public.ai_prompt_favorites (workspace_id, user_id);

alter table public.ai_prompt_favorites enable row level security;

-- Members of the workspace may manage their own favorite rows.
create policy "ai_prompt_favorites_all_members" on public.ai_prompt_favorites
  for all to authenticated
  using (public.is_workspace_member(workspace_id) and user_id = auth.uid())
  with check (public.is_workspace_member(workspace_id) and user_id = auth.uid());
