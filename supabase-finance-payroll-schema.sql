-- Kawaii Slime Company Finance / Payroll / OT / Temp Agency app
-- Run this in a dedicated Supabase project. The Vercel API uses the service key.

create extension if not exists pgcrypto;

create table if not exists public.finance_submission_counters (
  id boolean primary key default true,
  current_value bigint not null default 0,
  constraint finance_submission_counters_singleton check (id)
);
insert into public.finance_submission_counters (id, current_value)
values (true, 0)
on conflict (id) do nothing;

create or replace function public.next_finance_submission_number()
returns text
language plpgsql
security definer
as $$
declare next_value bigint;
begin
  update public.finance_submission_counters
  set current_value = current_value + 1
  where id = true
  returning current_value into next_value;
  return 'TC-' || to_char(current_date, 'YYYY') || '-' || lpad(next_value::text, 6, '0');
end;
$$;

create table if not exists public.finance_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text,
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_at timestamptz not null default now()
);

create table if not exists public.finance_temp_agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_name text,
  contact_email text,
  contact_phone text,
  reference_id text,
  status text not null default 'Active' check (status in ('Active','Inactive')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  department_id uuid references public.finance_departments(id) on delete set null,
  supervisor_name text,
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_at timestamptz not null default now()
);

create table if not exists public.finance_supervisors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  department_id uuid references public.finance_departments(id) on delete set null,
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_at timestamptz not null default now()
);

create table if not exists public.finance_temp_workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  agency_id uuid references public.finance_temp_agencies(id) on delete set null,
  worker_id text,
  department_id uuid references public.finance_departments(id) on delete set null,
  supervisor_name text,
  status text not null default 'Active' check (status in ('Active','Inactive')),
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_pay_periods (
  id uuid primary key default gen_random_uuid(),
  period_type text not null default 'Temp Timecard' check (period_type in ('Temp Timecard','Employee OT')),
  start_date date not null,
  end_date date not null,
  status text not null default 'Open' check (status in ('Open','Submission Deadline Approaching','Closed','Processing','Processed')),
  submission_deadline timestamptz,
  payroll_processing_date date,
  notes text,
  created_at timestamptz not null default now(),
  constraint finance_pay_period_dates_valid check (end_date >= start_date)
);

create table if not exists public.finance_time_entries (
  id uuid primary key default gen_random_uuid(),
  submission_number text not null unique,
  entry_type text not null check (entry_type in ('Employee OT','Temp Timecard')),
  pay_period_id uuid not null references public.finance_pay_periods(id) on delete restrict,
  employee_id uuid references public.finance_employees(id) on delete set null,
  temp_worker_id uuid references public.finance_temp_workers(id) on delete set null,
  temp_agency_id uuid references public.finance_temp_agencies(id) on delete set null,
  department_id uuid references public.finance_departments(id) on delete restrict,
  employee_name_snapshot text,
  temp_worker_name_snapshot text,
  temp_agency_name_snapshot text,
  department_name_snapshot text,
  supervisor_name text not null,
  work_date date,
  assignment_location text,
  job_role text,
  worker_id_snapshot text,
  agency_worker_id text,
  submitted_by_name text not null,
  submitted_by_role text,
  submitted_on_behalf_of text,
  representing_name text,
  representation_reason text,
  regular_hours numeric(8,2) not null default 0 check (regular_hours >= 0),
  overtime_hours numeric(8,2) not null default 0 check (overtime_hours >= 0),
  double_time_hours numeric(8,2) not null default 0 check (double_time_hours >= 0),
  reason_for_ot text,
  notes text,
  status text not null default 'Draft' check (status in ('Draft','Submitted','Pending Approval','Approved','Rejected','Needs Correction','Processed','Exported to QuickBooks')),
  rejection_comment text,
  approved_by_name text,
  approved_at timestamptz,
  approval_slack_sent_at timestamptz,
  approval_slack_message_id text,
  processed_at timestamptz,
  quickbooks_id text,
  quickbooks_status text not null default 'Not Exported' check (quickbooks_status in ('Not Exported','Ready for Export','Exporting','Exported','Export Failed')),
  quickbooks_export_date timestamptz,
  quickbooks_exported_by text,
  quickbooks_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_time_entry_subject_valid check (
    (entry_type = 'Employee OT' and employee_name_snapshot is not null)
    or (entry_type = 'Temp Timecard' and temp_worker_name_snapshot is not null and temp_agency_name_snapshot is not null)
  )
);

create table if not exists public.finance_approvals (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.finance_time_entries(id) on delete cascade,
  level integer not null default 1,
  approver_name text not null,
  status text not null check (status in ('Pending','Approved','Rejected','Needs Correction')),
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_audit_logs (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid references public.finance_time_entries(id) on delete set null,
  user_name text not null,
  user_role text,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_documents (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references public.finance_time_entries(id) on delete cascade,
  document_type text not null default 'Timecard PDF',
  file_url text,
  file_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_notifications (
  id uuid primary key default gen_random_uuid(),
  user_name text,
  notification_type text not null,
  message text not null,
  time_entry_id uuid references public.finance_time_entries(id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_pay_periods_type_dates_unique_idx
  on public.finance_pay_periods(period_type, start_date, end_date);

create index if not exists finance_time_entries_status_idx on public.finance_time_entries(status);
create index if not exists finance_time_entries_period_idx on public.finance_time_entries(pay_period_id);
create index if not exists finance_time_entries_department_idx on public.finance_time_entries(department_id);
create index if not exists finance_time_entries_created_idx on public.finance_time_entries(created_at desc);
create index if not exists finance_audit_logs_entry_idx on public.finance_audit_logs(time_entry_id, created_at desc);
create index if not exists finance_notifications_user_idx on public.finance_notifications(user_name, read, created_at desc);

-- Storage for generated PDFs/evidence if the app later persists documents.
insert into storage.buckets (id, name, public)
values ('finance-payroll-documents', 'finance-payroll-documents', false)
on conflict (id) do nothing;

-- Production schema intentionally starts with empty directories and no demo records.
-- Optional demonstration data is in supabase-finance-payroll-seed.sql and should not be run for a fresh client handoff.
