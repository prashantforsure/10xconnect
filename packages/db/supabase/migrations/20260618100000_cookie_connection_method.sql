-- Add the 'cookie' LinkedIn connection method (li_at session cookie). The cookie
-- is validated with the transport provider at connect time and the account status
-- is re-checked before persisting, so an expired/challenged session is rejected.
--
-- Additive + idempotent. PG 12+ permits ALTER TYPE ... ADD VALUE inside a tx as
-- long as the new value isn't USED in the same tx (the migrate runner wraps each
-- file in begin/commit; this file only adds the value).
alter type public.connection_method add value if not exists 'cookie';
