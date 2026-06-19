-- One LinkedIn sending account per workspace (a workspace = one "SaaS account").
--
-- Security/safety decision (CLAUDE.md §2/§6): each workspace connects exactly one
-- LinkedIn account, connected only via the browser extension. This is the
-- defense-in-depth net behind the API guard — reconnecting refreshes the single
-- existing row in place rather than inserting a second one.
--
-- Partial unique index: at most one row per workspace WHERE type = 'linkedin'.
-- Mailboxes (type = 'mailbox', Phase 11) are unaffected. A 'disconnected' row
-- still holds the slot — the API reconnect flow updates it in place.
--
-- NOTE: if a workspace already has >1 linkedin row (early dev data), this index
-- creation will fail; dedupe to a single row first.
create unique index if not exists uq_sending_accounts_one_linkedin_per_workspace
  on public.sending_accounts (workspace_id)
  where type = 'linkedin';
