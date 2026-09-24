# KSC Finance & Payroll / OT / Temp Agency Management App

A production-oriented internal workflow for employee OT submissions, temporary-worker timecards, supervisor approval, payroll processing, PDF timecards, Slack notifications and future QuickBooks export.

## Branding

The app follows the current Kawaii Slime Company storefront:

- Local Quicksand font for the app body
- Local Nunito font for buttons/actions
- Brown `#8A5D3B`
- Pink `#FFA8BD`
- Pink soft `#FFE6F0`
- Blue `#7CD5F3` / `#C7EAF8`
- KSC logo in `public/ksc-logo.png`

## Local setup

```bash
npm install
npm run dev
```

## Environment variables

Set these in Vercel. Never paste secrets into chat or commit them.

```text
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
BLAKELI_USERNAME=
BLAKELI_PASSWORD=
BLAKELI_ROLE=Admin
CARLA_USERNAME=
CARLA_PASSWORD=
CARLA_ROLE=Supervisor
CHARLES_USERNAME=
CHARLES_PASSWORD=
CHARLES_ROLE=Supervisor
CHRIS_USERNAME=
CHRIS_PASSWORD=
CHRIS_ROLE=Supervisor
JUNAID_USERNAME=
JUNAID_PASSWORD=
JUNAID_ROLE=Admin
ROXY_USERNAME=
ROXY_PASSWORD=
ROXY_ROLE=Admin
SANDRA_USERNAME=
SANDRA_PASSWORD=
SANDRA_ROLE=Supervisor
PAYROLL_USERNAME=payroll
PAYROLL_PASSWORD=
PAYROLL_ROLE=Payroll
HUMAN_RESOURCES_USERNAME=human_resources
HUMAN_RESOURCES_PASSWORD=
HUMAN_RESOURCES_ROLE=HR
APP_BASE_URL=https://your-finance-app.vercel.app

SLACK_BOT_TOKEN=
SLACK_FINANCE_PAYROLL_CHANNEL_ID=

CRON_SECRET=
QUICKBOOKS_ENABLED=false
```

The app uses separate username/password accounts. The selected role must match the account role. There are 9 accounts: 3 Admins, 4 Supervisors, 1 HR account and 1 Payroll account. There are no Employee accounts. This is role-level access; move to individual accounts/SSO before exposing the app outside the company.

## Supabase setup

1. Create a separate Supabase project for Finance/Payroll.
2. Run `supabase-finance-payroll-schema.sql` in the SQL editor. This production schema starts empty.
3. Optional: run `supabase-finance-payroll-seed.sql` only in a demo/staging project to create the six sample workers/timecards.
4. The SQL creates the directory tables, pay periods, time entries, approvals, audit logs, notifications and private document bucket.
5. If demo data was already inserted and the client needs a blank handoff, run `supabase-finance-payroll-clean-all-data.sql` once. It deletes rows and stored documents but keeps the schema.

## Slack setup

The app posts to `finance-payroll-ot-temp` through `SLACK_FINANCE_PAYROLL_CHANNEL_ID`.

Required bot scopes:

- `chat:write`
- `users:read` so the app can convert `Tommi` and `HR - Sarah` into real Slack mentions

The app uses Slack only for new submission/status notifications and daily reminders. Historical Slack importing is not included in this version.

## Daily reminder scheduler

The reminder endpoint is:

```text
https://your-finance-app.vercel.app/api/scheduler-reminders?secret=YOUR_CRON_SECRET
```

Use an external scheduler during testing, then configure business days and reminder time. The endpoint sends the daily reminder and flags pending items older than 24 hours.

## Workflow

- Employee or supervisor creates an OT submission.
- Authorized user creates a Temp Timecard with agency, worker and hours.
- Blank OT/DT values are stored as `0`.
- A total is calculated without changing the submitted values.
- Submit moves the record to `Pending Approval`.
- Supervisor can approve, reject or request correction.
- Existing submission and status Slack notifications remain active.
- Approval also sends a separate Slack notification mentioning Tommi and HR - Sarah when their Slack profiles are found; plain-name fallbacks are used if `users:read` is not available.
- Approval notifications are protected against duplicate sends for the same approval.
- Payroll can process approved records and export CSV.
- Temp timecards use a Monday–Friday weekly pay period.
- Employee OT uses a Tuesday–Monday weekly pay period.
- Admin/Payroll can generate all 52 weekly periods for a selected year; submission forms show a matching dropdown.
- The timecard PDF can be generated from the record detail page.
- Slack messages currently use a `:pinkline:` branded separator and a View Submission link; interactive Slack approvals can be connected later.
- QuickBooks is modular and safely remains `Ready for Export` until a live adapter is configured; the app never fakes a successful export.
- Audit entries are created for submissions, edits, approvals, corrections and QuickBooks preparation.

## Deployment

1. Extract the ZIP so project files are directly at the repository root.
2. Upload the extracted files to a GitHub repository.
3. Import the repository into Vercel.
4. Add the environment variables above.
5. Deploy and test login, pay-period creation, a timecard, approval, PDF and CSV export.
6. Configure the Slack channel notification variables and reminder scheduler only after the app URL is live. Interactive Slack approval buttons are intentionally postponed.
