-- 10xConnect core schema — enums + helper functions.
-- Conventions: uuid PKs (gen_random_uuid), created_at/updated_at timestamptz.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.membership_role as enum ('owner', 'admin', 'member');

create type public.sending_account_type as enum ('linkedin', 'mailbox');
create type public.connection_method as enum ('extension', 'credentials');
create type public.proxy_type as enum ('bundled', 'own');
create type public.sending_account_status as enum (
  'active', 'warming', 'paused', 'restricted', 'disconnected'
);

create type public.enrich_status as enum ('pending', 'enriching', 'enriched', 'failed');

create type public.campaign_status as enum (
  'draft', 'pending', 'running', 'stopped', 'completed'
);

create type public.sequence_node_kind as enum ('action', 'condition');

create type public.conversation_pipeline_stage as enum (
  'new', 'in_conversation', 'qualified', 'booked', 'lost'
);

-- Shared LinkedIn/email channel (CLAUDE.md scope: LinkedIn + email only).
create type public.channel_type as enum ('linkedin', 'email');
create type public.message_direction as enum ('inbound', 'outbound');

create type public.billing_cycle as enum ('monthly', 'annual');
create type public.subscription_status as enum (
  'not_activated', 'trial', 'active', 'canceled'
);

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Maintains updated_at on row updates.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- NOTE: public.is_workspace_member is defined in the RLS migration, after the
-- `memberships` table exists (Postgres validates SQL function bodies at creation).

-- Mirror new auth.users into public.profiles (profiles = mirror of auth.users).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
