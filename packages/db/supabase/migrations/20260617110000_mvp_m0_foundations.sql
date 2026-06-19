-- MVP M0 — foundations for the orchestration brain, sequence engine, inbox, and AI.
-- Additive tables. All workspace-scoped with the standard "members full access"
-- RLS (service role bypasses; defense-in-depth). Follows the import_jobs pattern.

-- ---------------------------------------------------------------------------
-- lead_events — idempotent log of inbound transport events (replies, accepts,
-- opens, status changes). provider_event_id is the webhook dedup key (CLAUDE.md
-- §2 "idempotent webhook processing"). Powers: condition nodes (invite_accepted,
-- message_opened, message_replied), reply auto-stop, and analytics.
-- ---------------------------------------------------------------------------
create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  account_id uuid references public.sending_accounts (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete set null,
  -- reply | invite_accepted | message_opened | account_status_changed | email_opened | ...
  type text not null,
  -- provider event id (webhook dedup). null for locally-generated events.
  provider_event_id text,
  channel public.channel_type not null default 'linkedin',
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_lead_events_workspace_id on public.lead_events (workspace_id);
create index idx_lead_events_lead_id on public.lead_events (lead_id);
create index idx_lead_events_campaign_id on public.lead_events (campaign_id);
create index idx_lead_events_type on public.lead_events (type);
-- Idempotency: one row per (workspace, provider_event_id). A plain (non-partial)
-- unique index so ON CONFLICT can infer it; Postgres treats NULLs as distinct,
-- so locally-generated events (null provider_event_id) are never deduped.
create unique index uq_lead_events_provider_event
  on public.lead_events (workspace_id, provider_event_id);

-- ---------------------------------------------------------------------------
-- saved_responses — reusable inbox reply snippets (CLAUDE.md §8).
-- ---------------------------------------------------------------------------
create table public.saved_responses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null,
  body text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_saved_responses_workspace_id on public.saved_responses (workspace_id);
create trigger set_updated_at before update on public.saved_responses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- ai_prompts — personalization prompt library / brand-voice templates (CLAUDE.md §8).
-- ---------------------------------------------------------------------------
create table public.ai_prompts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  template text not null,
  is_default boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_ai_prompts_workspace_id on public.ai_prompts (workspace_id);
create trigger set_updated_at before update on public.ai_prompts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- do_not_contact — suppression / opt-out list (CLAUDE.md §11 compliance).
-- Honored at enrollment so suppressed people are never contacted.
-- ---------------------------------------------------------------------------
create table public.do_not_contact (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  linkedin_url text,
  email text,
  reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_do_not_contact_workspace_id on public.do_not_contact (workspace_id);
create unique index uq_do_not_contact_email
  on public.do_not_contact (workspace_id, lower(email)) where email is not null;
create unique index uq_do_not_contact_linkedin
  on public.do_not_contact (workspace_id, linkedin_url) where linkedin_url is not null;

-- ---------------------------------------------------------------------------
-- notifications — in-app alerts (restriction/auto-pause, deliverability) so the
-- restriction domain event surfaces to the user (CLAUDE.md §2/§6).
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  account_id uuid references public.sending_accounts (id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_notifications_workspace_id on public.notifications (workspace_id);
create index idx_notifications_read on public.notifications (workspace_id, read);

-- ---------------------------------------------------------------------------
-- RLS: workspace members have full access (service role bypasses).
-- ---------------------------------------------------------------------------
alter table public.lead_events     enable row level security;
alter table public.saved_responses enable row level security;
alter table public.ai_prompts      enable row level security;
alter table public.do_not_contact  enable row level security;
alter table public.notifications   enable row level security;

create policy "lead_events_all_members" on public.lead_events
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "saved_responses_all_members" on public.saved_responses
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "ai_prompts_all_members" on public.ai_prompts
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "do_not_contact_all_members" on public.do_not_contact
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "notifications_all_members" on public.notifications
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
