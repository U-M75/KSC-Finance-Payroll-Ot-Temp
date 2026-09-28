-- Run once on an existing Finance/Payroll database.
-- Adds an optional work end date so one timecard can cover multiple days (e.g. Sep 28 → Sep 30).
-- Existing rows keep work_end_date = NULL and continue to display as a single work date.

alter table public.finance_time_entries
  add column if not exists work_end_date date;
