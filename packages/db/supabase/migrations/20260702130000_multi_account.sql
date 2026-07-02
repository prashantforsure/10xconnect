-- Multiple LinkedIn accounts per workspace (agency model).
--
-- Until now a workspace held exactly ONE LinkedIn account, enforced by a partial
-- unique index + a reconnect-in-place guard. We lift that: a workspace can now
-- connect many LinkedIn accounts (each with its own dedicated proxy + its own
-- per-account rate governor, so ban risk stays isolated per account). Billing
-- gates the count via subscriptions.slot_count (enforced in the API, not the DB).

-- 1) Drop the single-account constraint. Reconnect now targets a specific row.
drop index if exists public.uq_sending_accounts_one_linkedin_per_workspace;

-- 2) Optional human label so users can name/disambiguate accounts in the list.
alter table public.sending_accounts
  add column if not exists label text;

-- 3) Hosted-auth reconnect must finalize a SPECIFIC account row (provider_account_id
--    alone is ambiguous once multiple accounts exist). Carry our row id on the
--    one-time link request so the callback updates the right account.
alter table public.account_link_requests
  add column if not exists reconnect_account_id uuid
    references public.sending_accounts (id) on delete set null;
