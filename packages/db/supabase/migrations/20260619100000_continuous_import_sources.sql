-- Continuous / auto-refresh import (CLAUDE.md §8 lead sourcing). A "live import"
-- re-checks a LinkedIn source (post engagers, search, group, …) on a schedule and
-- auto-imports only NEW leads after the initial run (workspace dedupe makes each
-- re-run idempotent). One import_sources row = one recurring source; each tick
-- spawns a normal import_jobs run. Additive migration.

-- ---------------------------------------------------------------------------
-- import_sources (recurring source definitions)
-- ---------------------------------------------------------------------------
create table public.import_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- source: linkedin_search | sales_navigator | event | post | group | lead_finder
  source text not null,
  -- the recurring query (url, engagement, keywords, filters, limit, accountId, tags).
  params jsonb not null default '{}'::jsonb,
  -- where re-imported leads land + optional campaign enrollment.
  list_id uuid references public.contact_lists (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete set null,
  -- how often to re-check (minutes; the poller clamps to a sane minimum).
  interval_minutes integer not null default 60,
  -- active | paused (a paused source is skipped by the poller).
  status text not null default 'active',
  last_run_at timestamptz,
  next_run_at timestamptz not null default now(),
  -- the most recent import_jobs row this source spawned (for the UI).
  last_job_id uuid references public.import_jobs (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_import_sources_workspace_id on public.import_sources (workspace_id);
-- The poller scans for due, active sources — keep that lookup cheap.
create index idx_import_sources_due on public.import_sources (status, next_run_at);

create trigger set_updated_at before update on public.import_sources
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: workspace members have full access (defense-in-depth; service role bypasses)
-- ---------------------------------------------------------------------------
alter table public.import_sources enable row level security;

create policy "import_sources_all_members" on public.import_sources
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
