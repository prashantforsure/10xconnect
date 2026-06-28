-- Phase 3 — Limits + Budget Governor. Cap conversation VOLUME (anti-spam) and
-- LLM SPEND (cost) before any autonomy is granted. Two new ledgers + per-campaign
-- AI limit/budget config. The pre-gate (skip trash with ZERO model calls), spam
-- caps (max AI turns, cooldown, one-out-per-in, loop detection) and the budget
-- hard-stop are enforced in the engine; these tables are the durable state.

-- ---------------------------------------------------------------------------
-- budget_ledger: per-campaign, per-UTC-day LLM spend rollup — the budget
-- governor reads/enforces against this. Soft alert at alert_at_pct, HARD-STOP at
-- the cap (drops the campaign's AI to approve_all). PK is (campaign_id, window).
-- (`window` is a reserved word — always quoted.)
-- ---------------------------------------------------------------------------
create table public.budget_ledger (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  "window" date not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  tokens_used integer not null default 0,
  usd_used numeric not null default 0,
  soft_alerted boolean not null default false,  -- alert_at_pct alert emitted once
  hard_stopped boolean not null default false,  -- cap hit → AI dropped to approve_all
  updated_at timestamptz not null default now(),
  primary key (campaign_id, "window")
);
create index idx_budget_ledger_workspace on public.budget_ledger (workspace_id);

create trigger budget_ledger_set_updated_at
  before update on public.budget_ledger
  for each row execute function public.set_updated_at();

alter table public.budget_ledger enable row level security;
create policy "budget_ledger_all_members" on public.budget_ledger
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- llm_usage: append-only per-call usage log. Gives cost-per-CONVERSATION (and a
-- model-routing audit) — the metering wrapper writes one row per LLM call and
-- also upserts the budget_ledger rollup above. `kind` is the routing tier
-- (classify is free/deterministic; 'draft' is the expensive reasoning call).
-- ---------------------------------------------------------------------------
create table public.llm_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  kind text not null default 'draft',
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  usd numeric not null default 0,
  created_at timestamptz not null default now()
);
create index idx_llm_usage_workspace on public.llm_usage (workspace_id);
create index idx_llm_usage_conversation on public.llm_usage (conversation_id);
create index idx_llm_usage_campaign on public.llm_usage (campaign_id);

alter table public.llm_usage enable row level security;
create policy "llm_usage_all_members" on public.llm_usage
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- campaigns: AI conversation limits + budget config (jsonb, parallel to the
-- Phase 2 brain columns).
--   limits = { max_ai_turns, cooldown_minutes, ... }
--   budget = { daily_usd_cap, alert_at_pct }
-- ---------------------------------------------------------------------------
alter table public.campaigns
  add column if not exists limits jsonb not null default '{}'::jsonb,
  add column if not exists budget jsonb not null default '{}'::jsonb;
