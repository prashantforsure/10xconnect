-- Pending hosted-auth (provider-hosted connect) requests. When a user starts the
-- Hosted Auth flow we mint a one-time `token`, store it here, and pass it to the
-- provider as `name`; on completion the provider calls our webhook with that
-- token so we can match the connected account back to the workspace.
--
-- Server-only: like sending_account_secrets, RLS is enabled with NO policies and
-- all grants revoked from anon/authenticated → only the service role (the API's
-- Kysely connection) can read/write. The browser never touches this table.
create table if not exists public.account_link_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- One-time correlation token echoed back by the provider's callback.
  token text not null unique,
  type text not null,                              -- 'create' | 'reconnect'
  reconnect_provider_account_id text,              -- set when type = 'reconnect'
  country text not null,                           -- region for the bundled proxy
  status text not null default 'pending',          -- 'pending' | 'completed' | 'expired'
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_account_link_requests_workspace_id
  on public.account_link_requests (workspace_id);

alter table public.account_link_requests enable row level security;
revoke all on public.account_link_requests from anon, authenticated;

create trigger set_updated_at before update on public.account_link_requests
  for each row execute function public.set_updated_at();
