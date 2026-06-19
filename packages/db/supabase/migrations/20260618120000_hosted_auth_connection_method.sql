-- Add the 'hosted_auth' connection method (Unipile Hosted Auth — the user logs in
-- on the provider's hosted page; the provider holds the session). Additive +
-- idempotent. ALTER TYPE ... ADD VALUE must not be USED in the same tx it's added
-- (the migrate runner wraps each file in begin/commit), so this file only adds it.
alter type public.connection_method add value if not exists 'hosted_auth';
