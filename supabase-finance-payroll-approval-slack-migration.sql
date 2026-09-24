-- Run once for an existing Finance database.
alter table public.finance_time_entries
  add column if not exists approval_slack_sent_at timestamptz;
alter table public.finance_time_entries
  add column if not exists approval_slack_message_id text;
