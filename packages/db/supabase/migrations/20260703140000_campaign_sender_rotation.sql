-- Multi-account sender rotation (agency parity — HeyReach/Aimfox).
--
-- A campaign can now be assigned a POOL of LinkedIn senders and rotate sends
-- across them. Each lead is stuck to ONE sender for its whole sequence (you can't
-- send a connection request from account A then a message from account B to the
-- same person — that breaks the relationship), assigned at enrollment by
-- least-loaded/round-robin across the pool's healthy accounts. Each account keeps
-- its own dedicated proxy + its own per-account rate governor, so 3 senders x 25
-- connection requests = 75 daily touches with ban risk isolated per account.
--
-- campaigns.account_id stays as the PRIMARY/default sender (backward compatible:
-- existing single-account campaigns keep working with an empty pool → the engine
-- falls back to [account_id]).

-- 1) Campaign → sender pool (many-to-many). CASCADE both ways: deleting a campaign
--    or an account cleanly drops the membership. workspace_id carried for RLS +
--    scoped queries (defense-in-depth, matches the rest of the schema).
create table if not exists public.campaign_accounts (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id  uuid not null references public.campaigns (id) on delete cascade,
  account_id   uuid not null references public.sending_accounts (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (campaign_id, account_id)
);

create index if not exists idx_campaign_accounts_campaign on public.campaign_accounts (campaign_id);
create index if not exists idx_campaign_accounts_account on public.campaign_accounts (account_id);
create index if not exists idx_campaign_accounts_workspace on public.campaign_accounts (workspace_id);

-- 2) The sticky sender assigned to a lead for a campaign. SET NULL on account
--    delete so removing a sender doesn't destroy lead state — the lead's next
--    dispatch falls back to the campaign default (or gets rerouted to a healthy
--    pool member by the reroute logic).
alter table public.lead_campaign_state
  add column if not exists account_id uuid
    references public.sending_accounts (id) on delete set null;

create index if not exists idx_lead_campaign_state_account on public.lead_campaign_state (account_id);

-- 3) RLS for campaign_accounts — members of the workspace can read/manage their
--    campaigns' sender pools (mirrors the campaigns table policies).
alter table public.campaign_accounts enable row level security;

drop policy if exists campaign_accounts_member_all on public.campaign_accounts;
create policy campaign_accounts_member_all on public.campaign_accounts
  for all
  using (
    exists (
      select 1 from public.memberships m
      where m.workspace_id = campaign_accounts.workspace_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.workspace_id = campaign_accounts.workspace_id
        and m.user_id = auth.uid()
    )
  );
