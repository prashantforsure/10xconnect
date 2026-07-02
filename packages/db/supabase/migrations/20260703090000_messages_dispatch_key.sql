-- Dedup key for dispatcher-written outbound messages (§2 no-double-sends).
-- The provider send is already idempotent (actions.idempotency_key), but the
-- messages-row insert after a successful send was not: a retry after a
-- mid-crash (send ok, finalize failed) appended the same message to the
-- thread twice. Outbound dispatch inserts now carry the action's idempotency
-- key here and use ON CONFLICT DO NOTHING. Null for inbound/manual inserts.

alter table public.messages
  add column if not exists dispatch_key text;

-- Full (non-partial) unique index: NULLs are distinct in Postgres, so
-- inbound/manual rows (dispatch_key null) are unaffected, and ON CONFLICT
-- (dispatch_key) infers this index directly.
create unique index if not exists uq_messages_dispatch_key
  on public.messages (dispatch_key);
