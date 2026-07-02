-- Store the connected LinkedIn account's profile photo so the app can show a real
-- avatar (Settings → Accounts, account selector). Nullable + additive — existing
-- rows keep NULL and fall back to initials in the UI. Populated on connect from
-- the transport provider (mock supplies a deterministic placeholder for local dev).
alter table public.sending_accounts add column if not exists avatar_url text;
