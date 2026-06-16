-- Step 5 — Workspaces (CRUD + General settings).
-- 1) profiles gains first_name / last_name (the General settings page edits these;
--    `name` is kept as a combined display value, maintained by the app/trigger).
-- 2) workspaces.settings default aligned to the canonical shape used by the API:
--    inbox_type in ('not_configured','all_conversations','campaign_only').

-- ---------------------------------------------------------------------------
-- profiles: split name into first/last (additive, nullable).
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

-- Mirror new auth.users into public.profiles, now populating first/last from
-- OAuth metadata (Google sends given_name / family_name) and keeping `name`.
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
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- workspaces.settings: canonical default (inbox not yet configured, 14-day
-- auto-withdraw). Existing rows are untouched; the API always writes the full
-- shape on create.
-- ---------------------------------------------------------------------------
alter table public.workspaces
  alter column settings
  set default '{"inbox_type": "not_configured", "auto_withdraw_days": 14}'::jsonb;
