-- Integrations build, Phase B — the outbox + outbound webhook delivery.
--
-- integration_events is the OUTBOX: the engine (dispatch/inbound/brain) inserts
-- one row per domain event (reply, accepted_invite, status_change, hot_lead,
-- campaign_completed, message_sent) with a per-workspace dedupe key so retries
-- and replays never double-emit. Delivery is decoupled: an in-API poller fans
-- events out into webhook_deliveries (one row per event x target) and POSTs
-- with signed payloads + retry backoff. Engine stays HTTP-free.

-- 1) webhooks v2 columns: display name, per-webhook signing secret (whsec_...,
--    returned once on create like API keys; legacy rows stay null = unsigned),
--    optional custom auth header (value encrypted with SECRETS_ENCRYPTION_KEY),
--    status + failure counter (auto-disable after repeated failures).
alter table public.webhooks
  add column if not exists name text not null default 'Webhook',
  add column if not exists secret text,
  add column if not exists auth_header_name text,
  add column if not exists auth_header_value text,
  add column if not exists status text not null default 'active',
  add column if not exists consecutive_failures int not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'webhooks_status_check'
  ) then
    alter table public.webhooks
      add constraint webhooks_status_check check (status in ('active', 'disabled'));
  end if;
end $$;

-- 2) The outbox. dedupe_key is unique per workspace — emitIntegrationEvent
--    inserts ON CONFLICT DO NOTHING, so idempotent seams can re-run safely.
create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  type text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, dedupe_key)
);

create index if not exists idx_integration_events_unprocessed
  on public.integration_events (created_at)
  where processed_at is null;
create index if not exists idx_integration_events_workspace
  on public.integration_events (workspace_id, created_at);

-- 3) Delivery attempts: one row per event x target. target_kind branches the
--    deliverer (webhook POST vs Slack incoming-webhook); connection_id gets its
--    FK in the Phase C migration (integration_connections).
create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  event_id uuid not null references public.integration_events (id) on delete cascade,
  target_kind text not null default 'webhook',
  webhook_id uuid references public.webhooks (id) on delete cascade,
  connection_id uuid,
  event_type text not null,
  attempt int not null default 0,
  status text not null default 'pending',
  response_code int,
  error text,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'webhook_deliveries_status_check'
  ) then
    alter table public.webhook_deliveries
      add constraint webhook_deliveries_status_check
      check (status in ('pending', 'delivered', 'failed'));
  end if;
end $$;

-- Fan-out idempotency: at most one delivery per (event, webhook) / (event, connection).
create unique index if not exists uq_webhook_deliveries_event_webhook
  on public.webhook_deliveries (event_id, webhook_id)
  where webhook_id is not null;
create unique index if not exists uq_webhook_deliveries_event_connection
  on public.webhook_deliveries (event_id, connection_id)
  where connection_id is not null;

create index if not exists idx_webhook_deliveries_due
  on public.webhook_deliveries (next_attempt_at)
  where status = 'pending';
create index if not exists idx_webhook_deliveries_webhook
  on public.webhook_deliveries (webhook_id, created_at);
create index if not exists idx_webhook_deliveries_workspace
  on public.webhook_deliveries (workspace_id, created_at);

-- 4) RLS — members can READ (delivery log in settings); all writes come from
--    the service-role engine/API, which bypasses RLS.
alter table public.integration_events enable row level security;
alter table public.webhook_deliveries enable row level security;

drop policy if exists integration_events_member_select on public.integration_events;
create policy integration_events_member_select on public.integration_events
  for select
  using (
    exists (
      select 1 from public.memberships m
      where m.workspace_id = integration_events.workspace_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists webhook_deliveries_member_select on public.webhook_deliveries;
create policy webhook_deliveries_member_select on public.webhook_deliveries
  for select
  using (
    exists (
      select 1 from public.memberships m
      where m.workspace_id = webhook_deliveries.workspace_id
        and m.user_id = auth.uid()
    )
  );
