-- Phase 2 — Knowledge base (pgvector RAG) + per-lead facts + AI draft suggestions
-- + campaign "brain" config. The conversation brain drafts grounded replies that
-- are human-approved (autonomy locked to approve_all this phase).

-- pgvector is pre-installed on Supabase; this is a no-op if already enabled.
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- knowledge_bases: a named collection of grounding chunks (per workspace).
-- A campaign references one via campaigns.knowledge_base_id.
-- ---------------------------------------------------------------------------
create table public.knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_knowledge_bases_workspace on public.knowledge_bases (workspace_id);

create trigger knowledge_bases_set_updated_at
  before update on public.knowledge_bases
  for each row execute function public.set_updated_at();

alter table public.knowledge_bases enable row level security;
create policy "knowledge_bases_all_members" on public.knowledge_bases
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- kb_chunks: embedded text chunks. embedding is vector(768) (Gemini
-- text-embedding-004 / the mock hashing embedder both emit 768 dims).
-- Retrieval is exact cosine KNN (`embedding <=> query`) — fine for the small
-- per-campaign KBs we expect; add an HNSW index if a KB ever gets large.
-- ---------------------------------------------------------------------------
create table public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  knowledge_base_id uuid not null references public.knowledge_bases (id) on delete cascade,
  body text not null,
  embedding vector(768),
  token_count integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_kb_chunks_workspace on public.kb_chunks (workspace_id);
create index idx_kb_chunks_base on public.kb_chunks (knowledge_base_id);

alter table public.kb_chunks enable row level security;
create policy "kb_chunks_all_members" on public.kb_chunks
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- facts: per-lead memory the brain extracts and reuses (top-k scoped to lead).
-- One row per (lead, topic) — re-learning a topic upserts.
-- ---------------------------------------------------------------------------
create table public.facts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  topic text not null default 'general',
  body text not null,
  embedding vector(768),
  source text,
  confidence numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_facts_lead_topic on public.facts (lead_id, topic);
create index idx_facts_workspace on public.facts (workspace_id);
create index idx_facts_lead on public.facts (lead_id);

create trigger facts_set_updated_at
  before update on public.facts
  for each row execute function public.set_updated_at();

alter table public.facts enable row level security;
create policy "facts_all_members" on public.facts
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- message_drafts: AI-suggested replies awaiting human approval (messages are
-- immutable, so drafts live here). status: pending|approved|discarded|escalated.
-- An "escalated" draft (out-of-knowledge) carries no body — never a fabricated
-- fact. reasoning holds {action,intent,sentiment,chunkIds,reason,...}.
-- ---------------------------------------------------------------------------
create table public.message_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete set null,
  status text not null default 'pending',
  body text,
  confidence numeric,
  reasoning jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_message_drafts_workspace on public.message_drafts (workspace_id);
create index idx_message_drafts_conversation on public.message_drafts (conversation_id);
-- At most one live (pending) draft per conversation.
create unique index uq_message_drafts_pending
  on public.message_drafts (conversation_id) where status = 'pending';

create trigger message_drafts_set_updated_at
  before update on public.message_drafts
  for each row execute function public.set_updated_at();

alter table public.message_drafts enable row level security;
create policy "message_drafts_all_members" on public.message_drafts
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- campaigns: the "brain" config. objective/guardrails/voice/autonomy are jsonb;
-- knowledge_base_id + voice_profile_id are FKs. autonomy defaults to approve_all
-- (every AI draft is human-approved until quality is proven — §3 of the plan).
-- ---------------------------------------------------------------------------
alter table public.campaigns
  add column if not exists objective jsonb,
  add column if not exists guardrails jsonb not null default '{}'::jsonb,
  add column if not exists voice jsonb not null default '{}'::jsonb,
  add column if not exists autonomy jsonb not null default '{"mode":"approve_all"}'::jsonb,
  add column if not exists knowledge_base_id uuid references public.knowledge_bases (id) on delete set null,
  add column if not exists voice_profile_id uuid references public.voice_profiles (id) on delete set null;
create index idx_campaigns_knowledge_base on public.campaigns (knowledge_base_id);
