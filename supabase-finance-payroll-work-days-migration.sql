-- Run once on an existing Finance/Payroll database.
-- Adds per-day hours so one timecard can list multiple work days (e.g. Mon 5h, Tue 8h).
-- Card-level regular/OT/DT totals are stored as the sum of the day rows.
-- Existing rows keep work_days = NULL and display their card-level hours as before.

alter table public.finance_time_entries
  add column if not exists work_days jsonb;
