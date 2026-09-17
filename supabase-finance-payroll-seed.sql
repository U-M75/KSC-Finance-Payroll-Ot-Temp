-- Optional demo timecards for the September 7–11, 2026 sample period.
-- Run this only in a demo/staging Supabase project or after reviewing the records.

insert into public.finance_time_entries (
  submission_number, entry_type, pay_period_id, temp_worker_id, temp_agency_id, department_id,
  temp_worker_name_snapshot, temp_agency_name_snapshot, department_name_snapshot, supervisor_name,
  work_date, worker_id_snapshot, submitted_by_name, submitted_by_role,
  submitted_on_behalf_of, regular_hours, overtime_hours, double_time_hours, notes, status,
  approved_by_name, approved_at, rejection_comment
)
select
  v.submission_number, 'Temp Timecard', p.id, w.id, a.id, d.id,
  w.name, a.name, d.name, w.supervisor_name,
  p.start_date, w.worker_id, 'Finance Demo', 'Payroll',
  'Myself', v.regular_hours, v.ot_hours, v.dt_hours, v.notes, v.status,
  case when v.status = 'Approved' then 'Sandra Pena' else null end,
  case when v.status = 'Approved' then '2026-09-11 17:30:00+00' else null end,
  case when v.status = 'Needs Correction' then 'Please confirm the final shift total before resubmitting.' else null end
from (values
  ('TC-2026-000001','Shelly Snyder',16::numeric,0::numeric,0::numeric,'Pending Approval','', 'Submitting on behalf of Sandra'),
  ('TC-2026-000002','Matt Christy',32::numeric,0::numeric,0::numeric,'Pending Approval','', ''),
  ('TC-2026-000003','Tara Flores',29.25::numeric,0::numeric,0::numeric,'Pending Approval','', ''),
  ('TC-2026-000004','Lamar Gayle',8::numeric,0::numeric,0::numeric,'Approved','', ''),
  ('TC-2026-000005','Teizjharay Toalepai',24::numeric,0::numeric,0::numeric,'Pending Approval','', ''),
  ('TC-2026-000006','Noe Keliikoa',24::numeric,0::numeric,0::numeric,'Needs Correction','', 'Review before payroll processing')
) as v(submission_number, worker_name, regular_hours, ot_hours, dt_hours, status, notes_unused, notes)
join public.finance_pay_periods p on p.start_date = '2026-09-07' and p.end_date = '2026-09-11'
join public.finance_temp_workers w on w.name = v.worker_name
join public.finance_temp_agencies a on a.id = w.agency_id
join public.finance_departments d on d.id = w.department_id
where not exists (select 1 from public.finance_time_entries e where e.submission_number = v.submission_number);

insert into public.finance_approvals (time_entry_id, level, approver_name, status, comment)
select e.id, 1, e.supervisor_name,
  case when e.status = 'Approved' then 'Approved' when e.status = 'Needs Correction' then 'Needs Correction' else 'Pending' end,
  e.rejection_comment
from public.finance_time_entries e
where e.submission_number like 'TC-2026-00000%'
  and not exists (select 1 from public.finance_approvals a where a.time_entry_id = e.id);

update public.finance_submission_counters set current_value = greatest(current_value, 6) where id = true;
