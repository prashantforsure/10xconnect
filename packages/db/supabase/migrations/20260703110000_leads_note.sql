-- Per-lead free-text note (CRM parity with Aimfox/HeyReach). Surfaced + edited in
-- the Contacts detail drawer; workspace-scoped like the rest of the lead row.
alter table public.leads add column if not exists note text;
