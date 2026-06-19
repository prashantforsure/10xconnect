-- Step 10 — Account connection: credentials flow.
-- 1) sending_accounts gains provider_account_id: the transport adapter's handle
--    for the connected account (Unipile account id, etc.). NOT a secret — it is an
--    opaque correlation id, mirrored into AccountRef.providerAccountId.
-- 2) sending_account_secrets: encrypted-at-rest credential / session material
--    (LinkedIn password, session token, own-proxy URL). Stored AES-256-GCM
--    ciphertext only — plaintext NEVER touches the DB.
--
-- Security (CLAUDE.md §11): the secrets table is server-only. RLS is enabled with
-- NO policies, so `authenticated` (the web client) is denied by default; only the
-- service_role (BYPASSRLS), used by apps/api + apps/worker, can read/write it. The
-- ciphertext never reaches the browser. The decryption key lives in env
-- (SECRETS_ENCRYPTION_KEY), server-side only.

-- ---------------------------------------------------------------------------
-- sending_accounts: provider handle (additive, nullable).
-- ---------------------------------------------------------------------------
alter table public.sending_accounts
  add column if not exists provider_account_id text;

-- ---------------------------------------------------------------------------
-- sending_account_secrets: encrypted credential / session material.
-- One row per account (account_id is PK + FK). workspace_id is duplicated for
-- scoping / defense-in-depth. ciphertext is the versioned AES-256-GCM payload.
-- ---------------------------------------------------------------------------
create table public.sending_account_secrets (
  account_id uuid primary key references public.sending_accounts (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_sending_account_secrets_workspace_id
  on public.sending_account_secrets (workspace_id);

create trigger set_updated_at before update on public.sending_account_secrets
  for each row execute function public.set_updated_at();

-- Enable RLS but define NO policies → deny-by-default for `authenticated`.
-- Only service_role (which bypasses RLS) may access the ciphertext.
alter table public.sending_account_secrets enable row level security;

-- Withhold table-level grants from `authenticated` too (defense-in-depth on top
-- of RLS). The blanket grant in the RLS migration ran before this table existed,
-- so nothing to revoke; we simply do NOT grant. service_role keeps full access
-- via its membership (and BYPASSRLS).
revoke all on public.sending_account_secrets from anon, authenticated;
grant all on public.sending_account_secrets to service_role;
