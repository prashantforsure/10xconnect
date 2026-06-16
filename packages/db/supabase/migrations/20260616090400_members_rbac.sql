-- Step 6 — Members & RBAC.
-- 1) workspace_invites: pending invites for emails without an account yet.
-- 2) is_workspace_admin / is_workspace_owner helpers (SECURITY DEFINER).
-- 3) Tighten memberships + workspaces write RLS to match the RBAC matrix
--    (defense-in-depth; the API enforces the full matrix server-side via a
--    service-role connection that bypasses RLS).
-- 4) handle_new_user resolves pending invites into memberships on signup.

-- ---------------------------------------------------------------------------
-- RBAC helper predicates (definer => bypass RLS on memberships, no recursion).
-- ---------------------------------------------------------------------------
create or replace function public.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = target_workspace_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = target_workspace_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
  );
$$;

grant execute on function public.is_workspace_admin(uuid) to anon, authenticated, service_role;
grant execute on function public.is_workspace_owner(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- workspace_invites
-- ---------------------------------------------------------------------------
create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role public.membership_role not null default 'member',
  invited_by uuid references public.profiles (id) on delete set null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_workspace_invites_workspace_id on public.workspace_invites (workspace_id);
create index idx_workspace_invites_email on public.workspace_invites (lower(email));
-- At most one pending invite per email per workspace.
create unique index uq_workspace_invites_pending
  on public.workspace_invites (workspace_id, lower(email))
  where status = 'pending';

grant all on public.workspace_invites to authenticated, service_role;
alter table public.workspace_invites enable row level security;

-- Members may read invites; only admins/owners may write (the API uses the
-- service role, so this RLS is purely defense-in-depth for direct client calls).
create policy "workspace_invites_select_members" on public.workspace_invites
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "workspace_invites_write_admin" on public.workspace_invites
  for all to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

create trigger set_updated_at before update on public.workspace_invites
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tighten memberships writes: admins/owners only (was: any member). Reads
-- unchanged (members can see the team). Workspace creation inserts the first
-- owner membership via the service role, so it is unaffected by this.
-- ---------------------------------------------------------------------------
drop policy if exists "memberships_insert" on public.memberships;
drop policy if exists "memberships_update_members" on public.memberships;
drop policy if exists "memberships_delete_members" on public.memberships;

create policy "memberships_insert_admin" on public.memberships
  for insert to authenticated with check (public.is_workspace_admin(workspace_id));
create policy "memberships_update_admin" on public.memberships
  for update to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));
create policy "memberships_delete_admin" on public.memberships
  for delete to authenticated using (public.is_workspace_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- Tighten workspaces writes: update = admin/owner, delete = owner only
-- (was: any member). Select + owner-insert unchanged.
-- ---------------------------------------------------------------------------
drop policy if exists "workspaces_update_members" on public.workspaces;
drop policy if exists "workspaces_delete_members" on public.workspaces;

create policy "workspaces_update_admin" on public.workspaces
  for update to authenticated
  using (public.is_workspace_admin(id))
  with check (public.is_workspace_admin(id));
create policy "workspaces_delete_owner" on public.workspaces
  for delete to authenticated using (public.is_workspace_owner(id));

-- ---------------------------------------------------------------------------
-- handle_new_user: mirror the auth user into profiles AND resolve any pending
-- invites for that email into memberships (the invite-accept-on-signup path).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, first_name, last_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name'),
    new.raw_user_meta_data ->> 'given_name',
    new.raw_user_meta_data ->> 'family_name'
  )
  on conflict (id) do nothing;

  if new.email is not null then
    insert into public.memberships (workspace_id, user_id, role)
    select wi.workspace_id, new.id, wi.role
    from public.workspace_invites wi
    where lower(wi.email) = lower(new.email)
      and wi.status = 'pending'
    on conflict (workspace_id, user_id) do nothing;

    update public.workspace_invites
    set status = 'accepted', updated_at = now()
    where lower(email) = lower(new.email)
      and status = 'pending';
  end if;

  return new;
end;
$$;
