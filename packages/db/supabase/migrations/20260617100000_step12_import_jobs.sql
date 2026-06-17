-- Step 12 — import-job framework (CLAUDE.md §8 lead sourcing, §10 entities).
-- An import (CSV or any LeadSourceAdapter source) creates one import_jobs row that
-- tracks status + per-source counts (total/created/duplicate/failed). The same
-- table backs every source so no source is special-cased. Additive migration.

-- ---------------------------------------------------------------------------
-- enum: import job lifecycle
-- ---------------------------------------------------------------------------
create type public.import_status as enum ('pending', 'running', 'completed', 'failed');

-- ---------------------------------------------------------------------------
-- import_jobs
-- ---------------------------------------------------------------------------
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- source: csv | linkedin_search | sales_navigator | event | post | group | list | lead_finder
  source text not null,
  status public.import_status not null default 'pending',
  -- target list the imported leads land in (kept on delete: null = list removed).
  list_id uuid references public.contact_lists (id) on delete set null,
  -- optional: enroll imported leads into this campaign (CLAUDE.md §8).
  campaign_id uuid references public.campaigns (id) on delete set null,
  -- lightweight, display/audit descriptor of the request (url, keywords, filters,
  -- file name, row count). The heavy payload (CSV rows) is NOT stored here.
  params jsonb not null default '{}'::jsonb,
  total_count integer not null default 0,
  created_count integer not null default 0,
  duplicate_count integer not null default 0,
  failed_count integer not null default 0,
  error text,
  created_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_import_jobs_workspace_id on public.import_jobs (workspace_id);
create index idx_import_jobs_list_id on public.import_jobs (list_id);

create trigger set_updated_at before update on public.import_jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: workspace members have full access (defense-in-depth; service role bypasses)
-- ---------------------------------------------------------------------------
alter table public.import_jobs enable row level security;

create policy "import_jobs_all_members" on public.import_jobs
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
