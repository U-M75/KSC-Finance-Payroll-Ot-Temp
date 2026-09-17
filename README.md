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
FINANCE_APP_PIN=
APP_BASE_URL=https://your-finance-app.vercel.app

SLACK_BOT_TOKEN=
SLACK_FINANCE_PAYROLL_CHANNEL_ID=

CRON_SECRET=
QUICKBOOKS_ENABLED=false
```

The selected first version uses a shared PIN plus role selection. This is intentionally simple for the internal prototype; move to individual accounts/SSO before exposing the app outside the company.

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
- `files:write` is not required for the first version because PDFs download from the app; add it later if PDF uploads to Slack are enabled.

Slack notifications currently include a safe View Submission link only. Slack approve/reject buttons and signing-secret verification are intentionally postponed until the Slack app is connected later.

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
- Payroll can process approved records and export CSV.
- Temp timecards use a Monday–Friday weekly pay period.
- Employee OT uses a Tuesday–Monday weekly pay period.
- Admin/Payroll can generate all 52 weekly periods for a selected year; submission forms show a matching dropdown.
- The timecard PDF can be generated from the record detail page.
- Slack messages currently use a `:pinkline:` branded separator and a View Submission link; interactive Slack approvals can be connected later.
- QuickBooks is modular and safely remains `Ready for Export` until a live adapter is configured; the app never fakes a successful export.
- Audit entries are created for submissions, edits, approvals, corrections and QuickBooks preparation.

## Migration-ready CSV

`finance-timecard-import-template.csv` shows the suggested historical Slack import shape. Historical records should be imported as immutable records with their original dates/approvals and any existing PDF linked later.

## Deployment

1. Extract the ZIP so project files are directly at the repository root.
2. Upload the extracted files to a GitHub repository.
3. Import the repository into Vercel.
4. Add the environment variables above.
5. Deploy and test login, pay-period creation, a timecard, approval, PDF and CSV export.
6. Configure the Slack interactivity URL and reminder scheduler only after the app URL is live.
