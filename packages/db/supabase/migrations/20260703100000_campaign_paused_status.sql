-- Pause/resume campaigns (distinct from stop). Stop is terminal (skips all
-- pending actions); pause freezes in place and resume re-schedules each lead
-- from where it stopped. Needs a new campaign_status value.
--
-- ADD VALUE IF NOT EXISTS is idempotent and safe to run alone (it only appends
-- to the enum; the value isn't used in this same migration).

alter type public.campaign_status add value if not exists 'paused';
