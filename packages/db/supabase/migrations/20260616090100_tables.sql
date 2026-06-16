-- 10xConnect core schema — tables, indexes, updated_at triggers.
-- Every workspace-scoped table carries workspace_id (denormalized on child/join
-- tables for uniform, fast RLS + the required workspace_id indexes).

-- ---------------------------------------------------------------------------
-- profiles (mirror of auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  -- settings: { inbox_type: 'all'|'campaign'|null, auto_withdraw_days: int }
  settings jsonb not null default '{"inbox_type": null, "auto_withdraw_days": 14}'::jsonb,
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_workspaces_owner_id on public.workspaces (owner_id);

-- ---------------------------------------------------------------------------
-- memberships
-- ---------------------------------------------------------------------------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.membership_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index idx_memberships_workspace_id on public.memberships (workspace_id);
create index idx_memberships_user_id on public.memberships (user_id);

-- ---------------------------------------------------------------------------
-- sending_accounts (LinkedIn accounts / mailboxes)
-- ---------------------------------------------------------------------------
create table public.sending_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  type public.sending_account_type not null,
  connection_method public.connection_method,
  name text,
  proxy_type public.proxy_type,
  proxy_region text,
  location text,
  country text,
  status public.sending_account_status not null default 'warming',
  health_score integer not null default 100,
  warmup_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_sending_accounts_workspace_id on public.sending_accounts (workspace_id);

-- ---------------------------------------------------------------------------
-- contact_lists
-- ---------------------------------------------------------------------------
create table public.contact_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_contact_lists_workspace_id on public.contact_lists (workspace_id);

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  linkedin_url text,
  email text,
  enrichment jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  custom_columns jsonb not null default '{}'::jsonb,
  dedupe_key text,
  enrich_status public.enrich_status not null default 'pending',
  connection_degree smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_leads_workspace_id on public.leads (workspace_id);
-- Workspace dedupe: no duplicate dedupe_key within a workspace (nulls allowed).
create unique index uq_leads_workspace_dedupe
  on public.leads (workspace_id, dedupe_key)
  where dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- list_leads (join: contact_lists <-> leads)
-- ---------------------------------------------------------------------------
create table public.list_leads (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  list_id uuid not null references public.contact_lists (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id, lead_id)
);
create index idx_list_leads_workspace_id on public.list_leads (workspace_id);
create index idx_list_leads_lead_id on public.list_leads (lead_id);

-- ---------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  status public.campaign_status not null default 'draft',
  account_id uuid references public.sending_accounts (id) on delete set null,
  schedule jsonb not null default '{}'::jsonb,
  caps jsonb not null default '{}'::jsonb,
  -- settings: { skip_already_contacted: bool, exclude_conn_req_from_reply_rate: bool }
  settings jsonb not null default '{}'::jsonb,
  share_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_campaigns_workspace_id on public.campaigns (workspace_id);
create index idx_campaigns_account_id on public.campaigns (account_id);

-- ---------------------------------------------------------------------------
-- sequence_nodes (campaign graph)
-- ---------------------------------------------------------------------------
create table public.sequence_nodes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  kind public.sequence_node_kind not null,
  type text not null,
  config jsonb not null default '{}'::jsonb,
  next_node_id uuid references public.sequence_nodes (id) on delete set null,
  true_node_id uuid references public.sequence_nodes (id) on delete set null,
  false_node_id uuid references public.sequence_nodes (id) on delete set null,
  delay_days integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_sequence_nodes_workspace_id on public.sequence_nodes (workspace_id);
create index idx_sequence_nodes_campaign_id on public.sequence_nodes (campaign_id);

-- ---------------------------------------------------------------------------
-- lead_campaign_state (per-lead position in a campaign)
-- ---------------------------------------------------------------------------
create table public.lead_campaign_state (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  current_node_id uuid references public.sequence_nodes (id) on delete set null,
  status text not null default 'active',
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, lead_id)
);
create index idx_lead_campaign_state_workspace_id on public.lead_campaign_state (workspace_id);
create index idx_lead_campaign_state_campaign_lead
  on public.lead_campaign_state (campaign_id, lead_id);
create index idx_lead_campaign_state_lead_id on public.lead_campaign_state (lead_id);

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id uuid references public.sending_accounts (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  channel public.channel_type not null,
  pipeline_stage public.conversation_pipeline_stage not null default 'new',
  snooze_until timestamptz,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_conversations_workspace_id on public.conversations (workspace_id);
create index idx_conversations_lead_id on public.conversations (lead_id);
create index idx_conversations_account_id on public.conversations (account_id);

-- ---------------------------------------------------------------------------
-- messages (immutable; created_at only)
-- ---------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direction public.message_direction not null,
  channel public.channel_type not null,
  body text,
  voice_ref text,
  created_at timestamptz not null default now()
);
create index idx_messages_workspace_id on public.messages (workspace_id);
create index idx_messages_conversation_id on public.messages (conversation_id);

-- ---------------------------------------------------------------------------
-- actions (audit + analytics + dedupe). idempotency_key UNIQUE = no double-sends.
-- ---------------------------------------------------------------------------
create table public.actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id uuid references public.sending_accounts (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  type text not null,
  idempotency_key text not null unique,
  scheduled_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now()
);
create index idx_actions_workspace_id on public.actions (workspace_id);
create index idx_actions_account_id on public.actions (account_id);
create index idx_actions_lead_id on public.actions (lead_id);

-- ---------------------------------------------------------------------------
-- voice_profiles (user-scoped per CLAUDE.md §10)
-- ---------------------------------------------------------------------------
create table public.voice_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  model_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_voice_profiles_user_id on public.voice_profiles (user_id);

-- ---------------------------------------------------------------------------
-- api_keys
-- ---------------------------------------------------------------------------
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_api_keys_workspace_id on public.api_keys (workspace_id);

-- ---------------------------------------------------------------------------
-- webhooks (outbound)
-- ---------------------------------------------------------------------------
create table public.webhooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  url text not null,
  events text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_webhooks_workspace_id on public.webhooks (workspace_id);

-- ---------------------------------------------------------------------------
-- subscriptions (one per workspace; covers billing slots — CLAUDE.md §10)
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces (id) on delete cascade,
  plan text,
  slot_count integer not null default 0,
  billing_cycle public.billing_cycle,
  status public.subscription_status not null default 'not_activated',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_subscriptions_workspace_id on public.subscriptions (workspace_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (all tables that have updated_at)
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.sending_accounts
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.contact_lists
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.leads
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.sequence_nodes
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.lead_campaign_state
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.voice_profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.api_keys
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.webhooks
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();
