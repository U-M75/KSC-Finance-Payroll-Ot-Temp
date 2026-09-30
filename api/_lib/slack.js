import { clean } from './db.js'

function slackSafe(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const PINK_LINE = ':pinkline::pinkline::pinkline::pinkline::pinkline::pinkline::pinkline::pinkline:'

function appUrl(entryId) {
  const base = clean(process.env.APP_BASE_URL).replace(/\/$/, '')
  return base ? `${base}/?view=entry&id=${encodeURIComponent(entryId)}` : ''
}

function nonzeroHours(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? number : 0
}

// Only include hour lines that actually have hours — no "0" / empty entries in Slack.
function hourDetailLines(entry) {
  const total = Number(entry.regular_hours || 0) + Number(entry.overtime_hours || 0) + Number(entry.double_time_hours || 0)
  const lines = []
  if (nonzeroHours(entry.regular_hours)) lines.push(`*Regular Hours:* ${entry.regular_hours}`)
  if (nonzeroHours(entry.overtime_hours)) lines.push(`*OT Hours:* ${entry.overtime_hours}`)
  if (nonzeroHours(entry.double_time_hours)) lines.push(`*DT Hours:* ${entry.double_time_hours}`)
  lines.push(`*Total Hours:* ${total}`)
  return lines
}

function hoursSummary(entry) {
  const parts = []
  if (nonzeroHours(entry.regular_hours)) parts.push(`${entry.regular_hours} regular`)
  if (nonzeroHours(entry.overtime_hours)) parts.push(`${entry.overtime_hours} OT`)
  if (nonzeroHours(entry.double_time_hours)) parts.push(`${entry.double_time_hours} DT`)
  return parts.join(' · ') || '0 hours'
}

function workDateLabel(entry) {
  if (!entry?.work_date) return 'Not set'
  if (entry.work_end_date && entry.work_end_date !== entry.work_date) return `${entry.work_date} → ${entry.work_end_date}`
  return entry.work_date
}

// Per-day breakdown for Slack: one bullet per work day; zero-hour lines omitted.
function workDayLines(entry) {
  const days = Array.isArray(entry?.work_days) ? entry.work_days : []
  const lines = []
  for (const day of days) {
    const parts = []
    if (nonzeroHours(day.regular_hours)) parts.push(`${day.regular_hours} regular`)
    if (nonzeroHours(day.overtime_hours)) parts.push(`${day.overtime_hours} OT`)
    if (nonzeroHours(day.double_time_hours)) parts.push(`${day.double_time_hours} DT`)
    if (parts.length) lines.push(`• \`${day.date}\` ${parts.join(' · ')}`)
  }
  return lines.length ? ['*Work Days:*', ...lines] : []
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

async function uploadSlackFile({ channel, threadTs, dataUrl, filename, comment }) {
  const token = clean(process.env.SLACK_BOT_TOKEN)
  if (!token) return { ok: false, skipped: true, error: 'SLACK_BOT_TOKEN is not configured.' }
  const match = /^data:(image\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''))
  if (!match) throw new Error('Attachment image is not a valid image data URL.')
  const form = new FormData()
  form.append('channels', channel)
  if (threadTs) form.append('thread_ts', threadTs)
  if (comment) form.append('initial_comment', comment)
  form.append('file', new Blob([Buffer.from(match[2], 'base64')], { type: match[1] }), filename)
  const response = await fetch('https://slack.com/api/files.uploadV2', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.ok) throw new Error(data.error || `Slack files.uploadV2 failed (${response.status})`)
  return data
}

// Posts the entry's optional attached image as a thread reply under the main message.
async function attachEntryImage(entry, slackResult) {
  if (!entry?.attachment_image || !slackResult?.sent || !slackResult.ts) return slackResult
  try {
    const mime = /^data:(image\/[a-z0-9+.-]+);base64,/i.exec(entry.attachment_image)?.[1] || 'image/jpeg'
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'jpg'
    await uploadSlackFile({
      channel: slackResult.channel,
      threadTs: slackResult.ts,
      dataUrl: entry.attachment_image,
      filename: `${entry.submission_number || 'attachment'}.${ext}`,
      comment: `Attachment image for ${entry.submission_number || 'this submission'}`,
    })
  } catch (error) {
    console.error('Slack image attachment upload failed:', error.message)
  }
  return slackResult
}

async function slackMention(searchNames, fallback) {
  try {
    let cursor = ''
    for (let page = 0; page < 10; page += 1) {
      const result = await slackApi('users.list', { limit: 200, ...(cursor ? { cursor } : {}) })
      const wanted = searchNames.map(value => value.toLowerCase())
      const match = (result.members || []).find(user => {
        if (user.deleted || user.is_bot) return false
        const names = [user.real_name, user.name, user.profile?.display_name].filter(Boolean).map(value => String(value).toLowerCase())
        return names.some(name => wanted.includes(name))
      })
      if (match?.id) return `<@${match.id}>`
      cursor = result.response_metadata?.next_cursor || ''
      if (!cursor) break
    }
  } catch (error) {
    console.error('Slack user mention lookup failed:', error.message)
  }
  return fallback
}

export async function sendApprovedTimeEntryNotification(entry, approvedBy) {
  const subject = entry.entry_type === 'Temp Timecard' ? entry.temp_worker_name_snapshot : entry.employee_name_snapshot
  const payrollMention = await slackMention(['tommi'], '@Tommi')
  const hrMention = await slackMention(['hr - sarah', 'sarah'], '@HR - Sarah')
  const url = appUrl(entry.id)
  const message = [
    PINK_LINE,
    '✅ *OT / TEMP TIMECARD APPROVED*',
    PINK_LINE,
    '',
    `*Worker / Employee:* ${slackSafe(subject || 'Unknown')}`,
    `*Supervisor:* ${slackSafe(entry.supervisor_name || 'Not assigned')}`,
    `*Pay Period:* ${slackSafe(entry.period_label || 'Not set')}`,
    `*Work Date:* ${slackSafe(workDateLabel(entry))}`,
    ...workDayLines(entry),
    ...hourDetailLines(entry),
    `*Approved By:* ${slackSafe(approvedBy || 'Supervisor')}`,
    '*Approval Status:* Approved',
    '',
    `${payrollMention} ${hrMention} — please review this approved request.`,
    url ? `:link: *<${url}|View Approved Request>*` : '',
    '',
    PINK_LINE,
  ].filter(Boolean).join('\n')
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: message } }]
  const result = await sendFinanceSlack({ text: message, blocks })
  await attachEntryImage(entry, result)
  return result
}

export async function sendNewEntryNotification(entry) {
  const subject = entry.entry_type === 'Temp Timecard' ? entry.temp_worker_name_snapshot : entry.employee_name_snapshot
  const url = appUrl(entry.id)
  const message = [
    PINK_LINE,
    `📝 *NEW ${entry.entry_type.toUpperCase()} SUBMITTED*`,
    PINK_LINE,
    '',
    `*Worker / Employee:* ${slackSafe(subject || 'Unknown')}`,
    `*Supervisor:* ${slackSafe(entry.supervisor_name || 'Not assigned')}`,
    `*Department:* ${slackSafe(entry.department_name_snapshot || 'Not set')}`,
    `*Pay Period:* ${slackSafe(entry.period_label || 'Not set')}`,
    `*Work Date:* ${slackSafe(workDateLabel(entry))}`,
    ...workDayLines(entry),
    ...hourDetailLines(entry),
    `*Submitted By:* ${slackSafe(entry.submitted_by_name || 'Not set')}`,
    '*Approval Status:* Pending Approval',
    '',
    '_This request is waiting for supervisor review._',
    url ? `:link: *<${url}|View Submission>*` : '',
    '',
    PINK_LINE,
  ].filter(Boolean).join('\n')
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: message } }]
  const result = await sendFinanceSlack({ text: message, blocks })
  await attachEntryImage(entry, result)
  return result
}
export async function sendStatusNotification(entry, status, actorName, comment = '') {
  const subject = entry.entry_type === 'Temp Timecard' ? entry.temp_worker_name_snapshot : entry.employee_name_snapshot
  const url = appUrl(entry.id)
  const text = `${PINK_LINE}\n*${slackSafe(entry.submission_number)}* — *${slackSafe(status)}*\n${slackSafe(subject)} · ${slackSafe(entry.department_name_snapshot || '')}\n${PINK_LINE}`
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text } }, { type: 'section', fields: [{ type: 'mrkdwn', text: `*Pay Period*\n${slackSafe(entry.period_label || 'Not set')}` }, { type: 'mrkdwn', text: `*Hours*\n${hoursSummary(entry)}` }, { type: 'mrkdwn', text: `*Updated By*\n${slackSafe(actorName)}` }, { type: 'mrkdwn', text: `*Comment*\n${slackSafe(comment || '—')}` }] }, ...(url ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'View Submission', emoji: true }, url, action_id: 'finance_view_entry' }] }] : [])]
  return sendFinanceSlack({ text, blocks })
}

export async function sendDailyReminder() {
  const url = clean(process.env.APP_BASE_URL).replace(/\/$/, '')
  const reminderText = [PINK_LINE, '*Daily Reminder: OT & Temp Sheet Submission*', PINK_LINE, '', 'Hey <!channel>!', '', 'Just a quick reminder to *update, complete, and submit* your OT and Temp forms for today.', '', 'Keeping these updated daily ensures smooth tracking and avoids any delays or confusion.', '', 'Please make sure everything is filled out and submitted before the end of the day.', '', 'Thanks for your cooperation!', '', PINK_LINE].join('\n')
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: reminderText } }, ...(url ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open Timecard App', emoji: true }, url, action_id: 'finance_open_app' }] }] : [])]
  return sendFinanceSlack({ text: reminderText, blocks })
}

export { slackApi }
