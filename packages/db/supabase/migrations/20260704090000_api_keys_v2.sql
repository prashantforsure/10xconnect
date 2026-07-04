-- API keys v2 — the public-API foundation (integrations build).
--
-- Keys become first-class credentials: they get a display name, a permission
-- level ("all" | "read_only" — read_only keys are rejected on non-GET requests
-- by the ApiKeyAuthService), a display prefix (first characters of the plaintext,
-- e.g. "10xc_a1b2c3d" — the plaintext itself is never stored, only its sha256
-- hash), and a last-used timestamp for the settings UI.
--
-- prefix is NULLABLE on purpose: pre-existing rows only have the hash, so their
-- prefix is unrecoverable — the UI falls back to "10xc_…" for legacy keys.

alter table public.api_keys
  add column if not exists name text not null default 'Default',
  add column if not exists permission text not null default 'all',
  add column if not exists prefix text,
  add column if not exists last_used_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'api_keys_permission_check'
  ) then
    alter table public.api_keys
      add constraint api_keys_permission_check check (permission in ('all', 'read_only'));
  end if;
end $$;
