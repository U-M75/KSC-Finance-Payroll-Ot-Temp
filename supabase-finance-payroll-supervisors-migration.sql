-- Run this once if the Finance database was created before the dedicated Supervisors directory was added.
create table if not exists public.finance_supervisors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  department_id uuid references public.finance_departments(id) on delete set null,
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_at timestamptz not null default now()
);

insert into public.finance_supervisors(name, status)
select distinct supervisor_name, 'Active'
from public.finance_temp_workers
where supervisor_name is not null and trim(supervisor_name) <> ''
on conflict (name) do nothing;

insert into public.finance_supervisors(name, status)
select distinct supervisor_name, 'Active'
from public.finance_employees
where supervisor_name is not null and trim(supervisor_name) <> ''
on conflict (name) do nothing;
