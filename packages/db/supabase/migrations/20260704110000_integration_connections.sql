-- Integrations build, Phase C — provider connections (Slack via incoming
-- webhook URL; the natural home for future providers). One connection per
-- provider per workspace. config carries the provider-specific settings; any
-- secret material inside it (the Slack webhook URL is a bearer credential) is
-- SecretCipher-encrypted by the API before insert.

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null,
  status text not null default 'active',
  config jsonb not null default '{}'::jsonb,
  events text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'integration_connections_status_check'
  ) then
    alter table public.integration_connections
      add constraint integration_connections_status_check
      check (status in ('active', 'disabled'));
  end if;
end $$;

create index if not exists idx_integration_connections_workspace
  on public.integration_connections (workspace_id);

-- Deliveries can now reference a connection (Slack fan-out).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'webhook_deliveries_connection_fk'
  ) then
    alter table public.webhook_deliveries
      add constraint webhook_deliveries_connection_fk
      foreign key (connection_id) references public.integration_connections (id)
      on delete cascade;
  end if;
end $$;

alter table public.integration_connections enable row level security;

drop policy if exists integration_connections_member_select on public.integration_connections;
create policy integration_connections_member_select on public.integration_connections
  for select
  using (
    exists (
      select 1 from public.memberships m
      where m.workspace_id = integration_connections.workspace_id
        and m.user_id = auth.uid()
    )
  );
