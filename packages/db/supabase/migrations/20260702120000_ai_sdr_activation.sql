-- AI SDR activation (turn the conversation brain into a live, trustworthy feature).
--
-- 1) Reconcile the autonomy default. The API has defaulted new campaigns to
--    Balanced (auto_easy_escalate_hard) since dto.ts; the column default still
--    said approve_all, a silent mismatch. Align the DB default to Balanced so a
--    raw insert (scripts, backfills) matches product behavior. Auto-send stays
--    guarded: the grounding guard is absolute, hot/sensitive turns escalate
--    before any send, and the budget hard-stop still interlocks back to
--    approve_all. Existing rows are NOT rewritten (a column default only affects
--    future inserts) — campaigns keep whatever mode they were saved with.
alter table public.campaigns
  alter column autonomy set default '{"mode":"auto_easy_escalate_hard"}'::jsonb;

-- 2) Message authorship marker (trust/visibility). When the autonomy dial
--    auto-sends a reply WITHOUT a human in the loop, the outbound message is
--    stamped authored_by='ai' so the inbox can show a "sent by AI" chip and the
--    AI-SDR analytics can count autonomous replies. Human replies (manual, or a
--    human-approved draft) stay 'human'. Default 'human' keeps every existing
--    row + every non-AI insert correct.
alter table public.messages
  add column if not exists authored_by text not null default 'human';

-- 3) Workspace AI master switch. Lives in workspaces.settings (jsonb) — no new
--    column. A missing/true flag means the AI SDR is ON; setting it false gates
--    the conversation_turn enqueue in the engine (inbound.ts). Backfill nothing:
--    absence is treated as enabled by the reader.
