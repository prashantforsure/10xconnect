-- MVP M3 — make `actions` the durable dispatch queue for the orchestration brain.
-- Each pending step is one actions row: scheduled_at = when it may fire, status
-- = lifecycle, config = resolved payload snapshot, node_id/campaign_id = which
-- sequence step it belongs to. The worker polls due rows, the rate governor
-- counts executed rows per account/type/day, and idempotency_key prevents
-- double-sends (CLAUDE.md §2). Additive migration.

alter table public.actions
  add column if not exists campaign_id uuid references public.campaigns (id) on delete cascade,
  add column if not exists node_id uuid references public.sequence_nodes (id) on delete set null,
  -- pending → executing → success | failed | skipped
  add column if not exists status text not null default 'pending',
  add column if not exists attempts integer not null default 0,
  add column if not exists config jsonb not null default '{}'::jsonb;

-- Due-action polling (worker tick): pending rows whose time has come, oldest first.
create index if not exists idx_actions_due
  on public.actions (scheduled_at)
  where status = 'pending';

create index if not exists idx_actions_campaign_id on public.actions (campaign_id);

-- Rate-governor aggregation: count executed actions per account + type + day.
create index if not exists idx_actions_governor
  on public.actions (account_id, type, executed_at);
