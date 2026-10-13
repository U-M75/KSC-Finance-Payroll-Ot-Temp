-- KAWAII HQ: Birthday & Anniversary module schema.
-- Run ONCE in the NEW Supabase project's SQL Editor (not the Finance project).
-- Staff sign-in is handled by Vercel env accounts, so no staff/role tables are needed here.

do $$ begin
  create type public.ksc_employee_type as enum ('Disney', 'Jellyland', 'Kawaii Slime In-house', 'None of these');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ksc_announcement_preference as enum ('public', 'private_dm');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ksc_employee_status as enum ('active', 'offboarded', 'disabled', 'revoked');
exception when duplicate_object then null; end $$;

-- Employees (mirrors the Zapier "Employee Birthday Details" table)
create table if not exists public.ksc_employees (
  id uuid primary key default gen_random_uuid(),
  slack_user_id text not null unique,
  slack_username text,
  full_name text not null,
  email text,
  employee_type public.ksc_employee_type,
  joining_date date,
  joining_date_pending_approval boolean not null default false,
  suggested_joining_date date,
  birthday date,
  birthday_locked boolean not null default false,
  anniversary date,
  anniversary_locked boolean not null default false,
  favorite_slime text,
  favorite_color text,
  favorite_snack text,
  celebration_notes text,
  announcement_preference public.ksc_announcement_preference not null default 'public',
  form_submitted boolean not null default false,
  form_submitted_at timestamptz,
  status public.ksc_employee_status not null default 'active',
  status_changed_at timestamptz,
  offboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ksc_employees_pending_needs_suggestion
    check (joining_date_pending_approval = false or suggested_joining_date is not null)
);

create index if not exists ksc_employees_status_idx on public.ksc_employees (status);
create index if not exists ksc_employees_birthday_idx on public.ksc_employees (birthday) where birthday is not null;
create index if not exists ksc_employees_anniversary_idx on public.ksc_employees (anniversary) where anniversary is not null;

-- Only ACTIVE employees take part in forms, reminders and celebrations.
create or replace view public.ksc_eligible_employees
with (security_invoker = true) as
  select * from public.ksc_employees where status = 'active';

-- Shoutout log: one post per employee, per occurrence, per destination (prevents duplicates).
create table if not exists public.ksc_celebration_log (
  id bigserial primary key,
  employee_id uuid not null references public.ksc_employees(id) on delete cascade,
  kind text not null check (kind in ('birthday', 'anniversary')),
  occurrence_date date not null,
  destination text not null check (destination in ('chat_room', 'dm')),
  sent_at timestamptz not null default now(),
  unique (employee_id, kind, occurrence_date, destination)
);

-- Onboarding DM log
create table if not exists public.ksc_onboarding_dispatches (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.ksc_employees(id) on delete cascade,
  source text not null,            -- slack_join | manual_add | manual_trigger | manual_retrigger
  actor_name text not null default 'system',
  slack_channel_id text,
  slack_message_ts text,
  created_at timestamptz not null default now()
);
create index if not exists ksc_onboarding_dispatches_employee_idx on public.ksc_onboarding_dispatches (employee_id, created_at desc);

-- Slack Events API retry protection
create table if not exists public.ksc_slack_event_log (
  event_id text primary key,
  received_at timestamptz not null default now()
);

-- Audit trail (who changed what, using the signed-in staff name and role)
create table if not exists public.ksc_hub_audit_log (
  id bigserial primary key,
  actor_name text not null,
  actor_role text,
  action text not null,
  entity text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ksc_hub_audit_log_entity_idx on public.ksc_hub_audit_log (entity, entity_id, created_at desc);

-- Triggers
create or replace function public.ksc_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists ksc_employees_touch on public.ksc_employees;
create trigger ksc_employees_touch before update on public.ksc_employees
  for each row execute function public.ksc_touch_updated_at();

create or replace function public.ksc_employee_status_guard()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    if new.status = 'active' then
      new.offboarded_at := null;
    else
      new.offboarded_at := coalesce(new.offboarded_at, now());
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ksc_employees_status_guard on public.ksc_employees;
create trigger ksc_employees_status_guard before update on public.ksc_employees
  for each row execute function public.ksc_employee_status_guard();

-- Security: RLS on everything, no policies. Only the server (service role key) can read or write.
alter table public.ksc_employees enable row level security;
alter table public.ksc_celebration_log enable row level security;
alter table public.ksc_onboarding_dispatches enable row level security;
alter table public.ksc_slack_event_log enable row level security;
alter table public.ksc_hub_audit_log enable row level security;
