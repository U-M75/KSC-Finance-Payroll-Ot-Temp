import { clean } from './db.js'

function slackSafe(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function appUrl(entryId) {
  const base = clean(process.env.APP_BASE_URL).replace(/\/$/, '')
  return base ? `${base}/?view=entry&id=${encodeURIComponent(entryId)}` : ''
}

async function slackApi(method, body) {
  const token = clean(process.env.SLACK_BOT_TOKEN)
  if (!token) return { ok: false, skipped: true, error: 'SLACK_BOT_TOKEN is not configured.' }
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.ok) throw new Error(data.error || `Slack ${method} failed (${response.status})`)
  return data
}

export async function sendFinanceSlack({ text, blocks, channel }) {
  const target = clean(channel || process.env.SLACK_FINANCE_PAYROLL_CHANNEL_ID)
  if (!target) return { sent: false, skipped: true, reason: 'SLACK_FINANCE_PAYROLL_CHANNEL_ID is not configured.' }
  const result = await slackApi('chat.postMessage', { channel: target, text, blocks })
  return { sent: true, ts: result.ts, channel: target }
}

export async function sendNewEntryNotification(entry) {
  const subject = entry.entry_type === 'Temp Timecard' ? entry.temp_worker_name_snapshot : entry.employee_name_snapshot
  const url = appUrl(entry.id)
  const text = `New ${entry.entry_type} submitted: ${subject || 'Unknown worker'} (${entry.submission_number})`
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `New ${entry.entry_type} Submitted`, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${slackSafe(subject)}* is waiting for supervisor review.` } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*Pay Period*\n${slackSafe(entry.period_label || 'Not set')}` },
      { type: 'mrkdwn', text: `*Department*\n${slackSafe(entry.department_name_snapshot || 'Not set')}` },
      { type: 'mrkdwn', text: `*Supervisor*\n${slackSafe(entry.supervisor_name || 'Not set')}` },
      { type: 'mrkdwn', text: `*Hours*\nRegular ${entry.regular_hours} · OT ${entry.overtime_hours} · DT ${entry.double_time_hours}` },
    ] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Submission *${slackSafe(entry.submission_number)}* · Submitted by ${slackSafe(entry.submitted_by_name)}` }] },
    ...(url ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'View Submission', emoji: true }, url, action_id: 'finance_view_entry' }] }] : []),
  ]
  return sendFinanceSlack({ text, blocks })
}

export async function sendStatusNotification(entry, status, actorName, comment = '') {
  const subject = entry.entry_type === 'Temp Timecard' ? entry.temp_worker_name_snapshot : entry.employee_name_snapshot
  const url = appUrl(entry.id)
  const text = `${entry.submission_number} is now ${status}`
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `:large_pink_circle: *${slackSafe(entry.submission_number)}* — *${slackSafe(status)}*\n${slackSafe(subject)} · ${slackSafe(entry.department_name_snapshot || '')}` } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*Pay Period*\n${slackSafe(entry.period_label || 'Not set')}` },
      { type: 'mrkdwn', text: `*Hours*\n${entry.regular_hours} regular · ${entry.overtime_hours} OT · ${entry.double_time_hours} DT` },
      { type: 'mrkdwn', text: `*Updated By*\n${slackSafe(actorName)}` },
      { type: 'mrkdwn', text: `*Comment*\n${slackSafe(comment || '—')}` },
    ] },
    ...(url ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'View Submission', emoji: true }, url, action_id: 'finance_view_entry' }] }] : []),
  ]
  return sendFinanceSlack({ text, blocks })
}

export async function sendDailyReminder() {
  const url = clean(process.env.APP_BASE_URL).replace(/\/$/, '')
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'Daily OT & Temp Timecard Reminder', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: 'Please review and submit today\'s OT and temporary-worker timecard information before the end of the day.' } },
    ...(url ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open Timecard App', emoji: true }, url, action_id: 'finance_open_app' }] }] : []),
  ]
  return sendFinanceSlack({ text: 'Daily OT & Temp Timecard Reminder', blocks })
}

export { slackApi }
