-- Run this once if the Finance schema was already run before period_type was added.
-- Temp timecards use Monday-Friday. Employee OT uses Tuesday-Monday.

alter table public.finance_pay_periods
  add column if not exists period_type text not null default 'Temp Timecard';

alter table public.finance_pay_periods
  drop constraint if exists finance_pay_periods_period_type_check;

alter table public.finance_pay_periods
  add constraint finance_pay_periods_period_type_check
  check (period_type in ('Temp Timecard','Employee OT'));

create unique index if not exists finance_pay_periods_type_dates_unique_idx
  on public.finance_pay_periods(period_type, start_date, end_date);

-- Existing sample/current periods are treated as Temp Timecard periods.
update public.finance_pay_periods
set period_type = 'Temp Timecard'
where period_type is null or period_type = '';
