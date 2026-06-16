-- 10xConnect core schema — Row Level Security.
-- Rule: a user may access a row only if they are a member of that row's
-- workspace (resolved via public.is_workspace_member). The Supabase service_role
-- has BYPASSRLS, so server/worker code using the service key is unrestricted.

-- Membership check used by every workspace-scoped RLS policy. Defined here
-- (after `memberships` exists). SECURITY DEFINER so it bypasses RLS on
-- `memberships`, preventing recursive RLS evaluation.
create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.workspace_id = target_workspace_id
      and m.user_id = auth.uid()
  );
$$;

grant execute on function public.is_workspace_member(uuid) to anon, authenticated, service_role;

-- Baseline grants (RLS still governs row visibility). service_role bypasses RLS.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;

-- Enable RLS on every table.
alter table public.profiles            enable row level security;
alter table public.workspaces          enable row level security;
alter table public.memberships         enable row level security;
alter table public.sending_accounts    enable row level security;
alter table public.contact_lists       enable row level security;
alter table public.leads               enable row level security;
alter table public.list_leads          enable row level security;
alter table public.campaigns           enable row level security;
alter table public.sequence_nodes      enable row level security;
alter table public.lead_campaign_state enable row level security;
alter table public.conversations       enable row level security;
alter table public.messages            enable row level security;
alter table public.actions             enable row level security;
alter table public.voice_profiles      enable row level security;
alter table public.api_keys            enable row level security;
alter table public.webhooks            enable row level security;
alter table public.subscriptions       enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: a user manages only their own profile row.
-- ---------------------------------------------------------------------------
create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- workspaces: members can read/update/delete; creator inserts as owner.
-- ---------------------------------------------------------------------------
create policy "workspaces_select_members" on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));
create policy "workspaces_insert_owner" on public.workspaces
  for insert to authenticated with check (owner_id = auth.uid());
create policy "workspaces_update_members" on public.workspaces
  for update to authenticated using (public.is_workspace_member(id))
  with check (public.is_workspace_member(id));
create policy "workspaces_delete_members" on public.workspaces
  for delete to authenticated using (public.is_workspace_member(id));

-- ---------------------------------------------------------------------------
-- memberships: members read; a user may insert their own bootstrap membership;
-- members manage memberships. (Granular RBAC arrives in Step 6.)
-- ---------------------------------------------------------------------------
create policy "memberships_select_members" on public.memberships
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "memberships_insert" on public.memberships
  for insert to authenticated
  with check (user_id = auth.uid() or public.is_workspace_member(workspace_id));
create policy "memberships_update_members" on public.memberships
  for update to authenticated using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
create policy "memberships_delete_members" on public.memberships
  for delete to authenticated using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- voice_profiles: user-scoped.
-- ---------------------------------------------------------------------------
create policy "voice_profiles_all_own" on public.voice_profiles
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Workspace-scoped tables: full access for workspace members.
-- ---------------------------------------------------------------------------
create policy "sending_accounts_all_members" on public.sending_accounts
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "contact_lists_all_members" on public.contact_lists
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "leads_all_members" on public.leads
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "list_leads_all_members" on public.list_leads
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "campaigns_all_members" on public.campaigns
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "sequence_nodes_all_members" on public.sequence_nodes
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "lead_campaign_state_all_members" on public.lead_campaign_state
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "conversations_all_members" on public.conversations
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "messages_all_members" on public.messages
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "actions_all_members" on public.actions
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "api_keys_all_members" on public.api_keys
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "webhooks_all_members" on public.webhooks
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "subscriptions_all_members" on public.subscriptions
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
