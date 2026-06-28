-- Phase 1 — Reply bridge + relationship state + inbox cockpit.
-- Adds the relationship axis (relationship_state) — distinct from
-- lead_campaign_state, which is the lead's graph position — plus thread-level
-- labels/ownership on conversations (reply-required, important, assignment).

-- ---------------------------------------------------------------------------
-- relationship_state: where the relationship stands (one per lead/person).
-- The conversation brain (Phase 2-4) populates intent_score/summary/ai_turn_count/
-- do_not_reply; Phase 1 only writes `stage` on reply. NOT merged with
-- conversations.pipeline_stage (human pipeline) or lead_campaign_state.status
-- (acquisition) — three coexisting axes.
-- ---------------------------------------------------------------------------
create table public.relationship_state (
  lead_id uuid primary key references public.leads (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  -- invited|awaiting_reply|in_conversation|objection|qualifying|hot_lead|nurture|closed_won|closed_lost
  stage text not null default 'in_conversation',
  intent_score integer not null default 0,
  ai_turn_count integer not null default 0,
  last_ai_reply_at timestamptz,
  do_not_reply boolean not null default false,
  sentiment text,
  summary text,
  next_action text,
  next_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_relationship_state_workspace on public.relationship_state (workspace_id);

create trigger relationship_state_set_updated_at
  before update on public.relationship_state
  for each row execute function public.set_updated_at();

alter table public.relationship_state enable row level security;
create policy "relationship_state_all_members" on public.relationship_state
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- conversations: thread-level labels + ownership for the inbox cockpit.
-- needs_attention = "reply required" (auto-set on inbound reply, cleared when a
-- human reply dispatches); is_important = manual flag; assigned_to = "Mine".
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists needs_attention boolean not null default false,
  add column if not exists is_important boolean not null default false,
  add column if not exists assigned_to uuid references public.profiles (id) on delete set null;
create index idx_conversations_needs_attention
  on public.conversations (workspace_id) where needs_attention;
