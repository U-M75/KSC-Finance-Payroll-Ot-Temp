-- DESTRUCTIVE RESET: removes all Finance/Payroll records while keeping tables/schema.
-- Run this in Supabase SQL Editor only after confirming the project is the correct client database.

begin;

-- Child records first.
delete from public.finance_notifications;
delete from public.finance_audit_logs;
delete from public.finance_documents;
delete from public.finance_approvals;
delete from public.finance_time_entries;
delete from public.finance_temp_workers;
delete from public.finance_employees;
delete from public.finance_pay_periods;
delete from public.finance_temp_agencies;
delete from public.finance_departments;
delete from public.finance_settings;

-- Reset the submission number sequence so the next fresh record starts at TC-YYYY-000001.
update public.finance_submission_counters
set current_value = 0
where id = true;

-- Remove files from the private finance document bucket, if any exist.
delete from storage.objects
where bucket_id = 'finance-payroll-documents';

commit;

-- Verification counts: all should return 0.
select 'departments' as table_name, count(*) as rows from public.finance_departments
union all select 'agencies', count(*) from public.finance_temp_agencies
union all select 'employees', count(*) from public.finance_employees
union all select 'temp_workers', count(*) from public.finance_temp_workers
union all select 'pay_periods', count(*) from public.finance_pay_periods
union all select 'time_entries', count(*) from public.finance_time_entries
union all select 'approvals', count(*) from public.finance_approvals
union all select 'audit_logs', count(*) from public.finance_audit_logs
union all select 'notifications', count(*) from public.finance_notifications
union all select 'documents', count(*) from public.finance_documents;
