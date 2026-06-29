-- ---------------------------------------------------------------------------
-- Phase 9.8 — prompt caching visibility. The conversation-brain draft call sends a
-- static prefix (system prompt + campaign objective) that repeats verbatim across a
-- conversation's turns; providers (e.g. Gemini implicit caching) bill that prefix at
-- a cheaper cached-input rate on repeat. We surface the saving in metering:
--   - llm_usage.cached_tokens     — cached prompt tokens for THAT call
--   - budget_ledger.cached_tokens_used — cached tokens rolled up per campaign/day
-- usd_used already reflects the discount (cached tokens priced at the cached rate).
-- ---------------------------------------------------------------------------

alter table public.llm_usage
  add column if not exists cached_tokens integer not null default 0;

alter table public.budget_ledger
  add column if not exists cached_tokens_used integer not null default 0;
