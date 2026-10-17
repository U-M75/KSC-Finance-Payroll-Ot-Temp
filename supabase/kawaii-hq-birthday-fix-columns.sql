-- Kawaii HQ: column fixes for the Birthday & Anniversary code.
-- Run ONCE in the Kawaii HQ Supabase project -> SQL Editor. Safe to run more than once.
-- The code writes actor_email, but the first schema created actor_name instead.

alter table public.ksc_onboarding_dispatches add column if not exists actor_email text;

alter table public.ksc_hub_audit_log add column if not exists actor_email text;
alter table public.ksc_hub_audit_log alter column actor_name drop not null;
alter table public.ksc_hub_audit_log alter column actor_name set default 'system';
