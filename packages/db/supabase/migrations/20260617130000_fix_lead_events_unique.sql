-- Replace the partial unique index on lead_events with a plain one so ON CONFLICT
-- (workspace_id, provider_event_id) can infer it (a partial index needs its
-- predicate in the conflict target). NULLs stay distinct, so locally-generated
-- events are unaffected. Idempotent.

drop index if exists public.uq_lead_events_provider_event;
create unique index if not exists uq_lead_events_provider_event
  on public.lead_events (workspace_id, provider_event_id);
