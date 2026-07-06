-- Auto-create a personal workspace for every new user on signup.
--
-- Previously handle_new_user only mirrored the auth user into profiles and
-- resolved pending team invites, so an organic signup landed with ZERO
-- workspaces and the app degraded to a bare "Select a workspace." screen.
--
-- 1) Extend handle_new_user so every new user also gets a personal workspace
--    they own (named "{First name}'s Workspace", fallback "My First Workspace").
-- 2) One-time backfill: give the same personal workspace to existing users who
--    currently have no membership (the dev's own account, prior test signups).
--
-- Mirrors the WorkspacesService.create invariant (workspace + owner membership
-- created together) and DEFAULT_SETTINGS
-- ({inbox_type:'not_configured', auto_withdraw_days:14}, branding {}).

-- ---------------------------------------------------------------------------
-- handle_new_user: profiles mirror + invite resolution (UNCHANGED) + personal
-- workspace (NEW, block 3). SECURITY DEFINER => bypasses RLS. The trigger
-- on_auth_user_created binds by name, so create-or-replace keeps it wired.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text;
  v_ws_name text;
begin
  -- (1) mirror auth user -> profiles
  insert into public.profiles (id, email, name, first_name, last_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name'),
    new.raw_user_meta_data ->> 'given_name',
    new.raw_user_meta_data ->> 'family_name'
  )
  on conflict (id) do nothing;

  -- (2) resolve pending invites -> memberships (invite-accept-on-signup)
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

  -- (3) NEW: every new user gets a personal workspace they own. Runs for all
  --     users (including invited ones) and outside the email guard so email-less
  --     users still get a workspace.
  v_first := nullif(coalesce(
    new.raw_user_meta_data ->> 'given_name',
    split_part(coalesce(new.raw_user_meta_data ->> 'name',
                        new.raw_user_meta_data ->> 'full_name', ''), ' ', 1)
  ), '');
  v_ws_name := case when v_first is not null
                    then v_first || '''s Workspace'
                    else 'My First Workspace' end;

  with new_ws as (
    insert into public.workspaces (name, owner_id, settings, branding)
    values (
      v_ws_name,
      new.id,
      '{"inbox_type": "not_configured", "auto_withdraw_days": 14}'::jsonb,
      '{}'::jsonb
    )
    returning id
  )
  insert into public.memberships (workspace_id, user_id, role)
  select id, new.id, 'owner' from new_ws;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: repair existing users who currently have no membership. Scope is
-- deliberately narrow (no membership at all) so established members are never
-- given a spurious extra workspace. Correlate each new workspace to its owner
-- via RETURNING (name is not unique; owner_id is the link).
-- ---------------------------------------------------------------------------
with new_ws as (
  insert into public.workspaces (name, owner_id, settings, branding)
  select
    case
      when coalesce(nullif(p.first_name, ''),
                    nullif(split_part(coalesce(p.name, ''), ' ', 1), '')) is not null
      then coalesce(nullif(p.first_name, ''),
                    nullif(split_part(coalesce(p.name, ''), ' ', 1), '')) || '''s Workspace'
      else 'My First Workspace'
    end,
    u.id,
    '{"inbox_type": "not_configured", "auto_withdraw_days": 14}'::jsonb,
    '{}'::jsonb
  from auth.users u
  left join public.profiles p on p.id = u.id
  where not exists (select 1 from public.memberships m where m.user_id = u.id)
  returning id, owner_id
)
insert into public.memberships (workspace_id, user_id, role)
select id, owner_id, 'owner' from new_ws
on conflict (workspace_id, user_id) do nothing;
