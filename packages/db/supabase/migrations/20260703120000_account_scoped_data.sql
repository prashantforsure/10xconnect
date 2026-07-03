-- Scope leads + conversations to the LinkedIn account that owns them, so the app
-- can show only the currently-connected profile's data and clean up a previous
-- profile's data when the account is switched/removed (HeyReach/Aimfox parity).

-- 1) Leads carry the sourcing account. ON DELETE CASCADE so removing an account
--    removes its leads (Aimfox: removing a LinkedIn account deletes its leads).
alter table public.leads
  add column if not exists account_id uuid references public.sending_accounts (id) on delete cascade;

create index if not exists idx_leads_account_id on public.leads (account_id);

-- Backfill: attribute existing leads to the workspace's LinkedIn account. Today a
-- workspace holds a single LinkedIn account, so the most-recent one is unambiguous.
update public.leads l
set account_id = sa.id
from (
  select distinct on (workspace_id) id, workspace_id
  from public.sending_accounts
  where type = 'linkedin'
  order by workspace_id, created_at desc
) sa
where sa.workspace_id = l.workspace_id
  and l.account_id is null;

-- 2) Conversations already carry account_id; make its FK CASCADE (was SET NULL) so
--    removing/switching an account clears its inbox (messages already cascade from
--    conversations). Drop the auto-named inline constraint and recreate it.
alter table public.conversations
  drop constraint if exists conversations_account_id_fkey;
alter table public.conversations
  add constraint conversations_account_id_fkey
  foreign key (account_id) references public.sending_accounts (id) on delete cascade;
