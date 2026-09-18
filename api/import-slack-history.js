import { admin, actor, audit, canManage, clean, jsonError, numberHours } from './_lib/db.js'

const CHANNEL_ENV = 'SLACK_FINANCE_PAYROLL_CHANNEL_ID'

function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) }
function first(record, keys, fallback = '') { for (const key of keys) if (record[key] !== undefined && record[key] !== null && String(record[key]).trim() !== '') return record[key]; return fallback }
function number(value) { try { return numberHours(String(value ?? '').replace(/[^0-9.\-]/g, '') || 0) } catch { return 0 } }
function normalizeText(value) { return String(value || '').replace(/<mailto:([^>|]+)\|([^>]+)>/g, '$2').replace(/<([^>|]+)\|([^>]+)>/g, '$2').replace(/[*_`]/g, '').trim() }
function messageText(message) {
  const parts = [message.text]
  for (const block of message.blocks || []) {
    if (block.text?.text) parts.push(block.text.text)
    for (const field of block.fields || []) if (field.text) parts.push(field.text)
  }
  for (const attachment of message.attachments || []) {
    parts.push(attachment.pretext, attachment.title, attachment.text)
    for (const field of attachment.fields || []) parts.push(`${field.title}: ${field.value}`)
  }
  return parts.filter(Boolean).map(normalizeText).join('\n')
}
function linesFor(text) { return text.split(/\r?\n/).map(line => line.replace(/^\s*[•>\-]\s*/, '').trim()).filter(Boolean) }
function fieldValue(lines, labels) {
  const pattern = new RegExp(`^(?:${labels.join('|')})\\s*[:：]?\\s*(.*)$`, 'i')
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern)
    if (!match) continue
    if (match[1].trim()) return match[1].trim()
    return lines[index + 1] || ''
  }
  return ''
}
function parseDate(value) {
  const text = clean(value).replace(/[–—]/g, '-')
  let match = text.match(/(\d{4}-\d{1,2}-\d{1,2}).*?(\d{4}-\d{1,2}-\d{1,2})/)
  if (match) return [match[1].replace(/-(\d)$/, '-0$1'), match[2].replace(/-(\d)$/, '-0$1')]
  match = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4}).*?(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (!match) return []
  const year = value => String(value).length === 2 ? `20${value}` : value
  return [`${year(match[3])}-${String(match[1]).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`, `${year(match[6])}-${String(match[4]).padStart(2, '0')}-${String(match[5]).padStart(2, '0')}`]
}
function parseMessage(message) {
  const text = messageText(message)
  const lines = linesFor(text)
  const temp = /temp\s+agency|temp\s+worker|temp\s+timecard/i.test(text)
  const type = temp ? 'Temp Timecard' : 'Employee OT'
  const period = parseDate(fieldValue(lines, ['Pay Period', 'Period']))
  if (!period.length) return { match: false, reason: 'No pay period found.' }
  const worker = fieldValue(lines, ['Temp Worker', 'Temp Worker Name', 'Worker Name', 'Worker', 'Employee Name', 'Employee'])
  const agency = fieldValue(lines, ['Temp Agency', 'Agency'])
  const department = fieldValue(lines, ['Department'])
  const supervisor = fieldValue(lines, ['Supervisor'])
  const regular = fieldValue(lines, ['Total # Regular Hours', 'Regular Hours', 'Regular'])
  const ot = fieldValue(lines, ['Total # OT Hours', 'OT Hours', 'Overtime Hours', 'OT'])
  const dt = fieldValue(lines, ['Total # DT Hours', 'DT Hours', 'Double Time Hours', 'DT'])
  const approvedBy = fieldValue(lines, ['Approved By', 'Approved'])
  const submittedBy = fieldValue(lines, ['Submitted By', 'Submitted'])
  const notes = fieldValue(lines, ['Notes', 'Note'])
  if (!worker) return { match: false, reason: 'No worker or employee name found.' }
  if (type === 'Temp Timecard' && !agency) return { match: false, reason: 'No temp agency found.' }
  return {
    match: true,
    entry_type: type,
    pay_period_start: period[0],
    pay_period_end: period[1],
    worker_name: worker,
    employee_name: type === 'Employee OT' ? worker : '',
    agency,
    department,
    supervisor,
    regular_hours: number(regular),
    overtime_hours: number(ot),
    double_time_hours: number(dt),
    approved_by: approvedBy,
    submitted_by: submittedBy || 'Historical Slack Import',
    notes,
    slack_ts: message.ts,
    slack_channel: message.channel,
    slack_text: text,
    file_url: message.files?.[0]?.url_private || null,
    file_name: message.files?.[0]?.name || null,
  }
}
async function slackHistory(token, channel, maxPages = 20) {
  let cursor = ''
  const messages = []
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({ channel, limit: '200' })
    if (cursor) params.set('cursor', cursor)
    const response = await fetch(`https://slack.com/api/conversations.history?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.ok) throw new Error(data.error || 'Slack history request failed.')
    messages.push(...(data.messages || []))
    cursor = data.response_metadata?.next_cursor || ''
    if (!cursor) break
  }
  return messages
}
async function findOrCreateDepartment(supabase, name) {
  const departmentName = clean(name) || 'Historical / Unknown'
  let result = await supabase.from('finance_departments').select('*').eq('name', departmentName).maybeSingle()
  if (result.error) throw result.error
  if (result.data) return result.data
  result = await supabase.from('finance_departments').insert({ name: departmentName, status: 'Active' }).select().single()
  if (result.error) throw result.error
  return result.data
}
async function findOrCreateAgency(supabase, name) {
  const agencyName = clean(name) || 'Historical / Unknown'
  let result = await supabase.from('finance_temp_agencies').select('*').eq('name', agencyName).maybeSingle()
  if (result.error) throw result.error
  if (result.data) return result.data
  result = await supabase.from('finance_temp_agencies').insert({ name: agencyName, status: 'Active', notes: 'Created from Slack history import.' }).select().single()
  if (result.error) throw result.error
  return result.data
}
async function findOrCreateWorker(supabase, record, agency, department) {
  const name = clean(record.worker_name) || 'Historical / Unknown'
  let result = await supabase.from('finance_temp_workers').select('*').eq('name', name).limit(1).maybeSingle()
  if (result.error) throw result.error
  if (result.data) return result.data
  result = await supabase.from('finance_temp_workers').insert({ name, agency_id: agency.id, department_id: department.id, supervisor_name: record.supervisor || 'Unassigned', status: 'Active', notes: 'Created from Slack history import.' }).select().single()
  if (result.error) throw result.error
  return result.data
}
async function importRecord(supabase, record, actorInfo) {
  const periodType = record.entry_type === 'Employee OT' ? 'Employee OT' : 'Temp Timecard'
  let periodResult = await supabase.from('finance_pay_periods').select('*').eq('period_type', periodType).eq('start_date', record.pay_period_start).eq('end_date', record.pay_period_end).maybeSingle()
  if (periodResult.error) throw periodResult.error
  let period = periodResult.data
  if (!period) {
    periodResult = await supabase.from('finance_pay_periods').insert({ period_type: periodType, start_date: record.pay_period_start, end_date: record.pay_period_end, status: 'Processed', notes: 'Created from Slack history import.' }).select().single()
    if (periodResult.error) throw periodResult.error
    period = periodResult.data
  }
  const department = await findOrCreateDepartment(supabase, record.department)
  const agency = record.entry_type === 'Temp Timecard' ? await findOrCreateAgency(supabase, record.agency) : null
  const worker = record.entry_type === 'Temp Timecard' ? await findOrCreateWorker(supabase, record, agency, department) : null
  let employee = null
  if (record.entry_type === 'Employee OT') {
    let employeeResult = await supabase.from('finance_employees').select('*').eq('name', record.employee_name).limit(1).maybeSingle()
    if (employeeResult.error) throw employeeResult.error
    if (!employeeResult.data) employeeResult = await supabase.from('finance_employees').insert({ name: record.employee_name, department_id: department.id, supervisor_name: record.supervisor || 'Unassigned', status: 'Active' }).select().single()
    if (employeeResult.error) throw employeeResult.error
    employee = employeeResult.data
  }
  const submissionNumber = `SLACK-${String(record.slack_ts || Date.now()).replace(/[^0-9]/g, '')}`
  const duplicate = await supabase.from('finance_time_entries').select('id').eq('submission_number', submissionNumber).maybeSingle()
  if (duplicate.error) throw duplicate.error
  if (duplicate.data) return { skipped: true }
  const payload = {
    submission_number: submissionNumber,
    entry_type: record.entry_type,
    pay_period_id: period.id,
    employee_id: employee?.id || null,
    temp_worker_id: worker?.id || null,
    temp_agency_id: agency?.id || null,
    department_id: department.id,
    employee_name_snapshot: employee?.name || null,
    temp_worker_name_snapshot: worker?.name || null,
    temp_agency_name_snapshot: agency?.name || null,
    department_name_snapshot: department.name,
    supervisor_name: record.supervisor || 'Unassigned',
    work_date: record.pay_period_start,
    submitted_by_name: record.submitted_by || 'Historical Slack Import',
    submitted_by_role: 'Historical Import',
    regular_hours: record.regular_hours,
    overtime_hours: record.overtime_hours,
    double_time_hours: record.double_time_hours,
    notes: record.notes || null,
    status: 'Processed',
    approved_by_name: record.approved_by || null,
    approved_at: record.approved_by ? new Date(Number(record.slack_ts || Date.now()) * 1000).toISOString() : null,
  }
  const saved = await supabase.from('finance_time_entries').insert(payload).select().single()
  if (saved.error) throw saved.error
  if (record.file_url || record.file_name) await supabase.from('finance_documents').insert({ time_entry_id: saved.data.id, document_type: 'Historical Slack Attachment', file_url: record.file_url, file_name: record.file_name || `${submissionNumber}.pdf` })
  await supabase.from('finance_approvals').insert({ time_entry_id: saved.data.id, level: 1, approver_name: record.approved_by || 'Historical Slack Approval', status: 'Approved', comment: 'Imported from Slack history.' })
  await audit(supabase, { timeEntryId: saved.data.id, ...actorInfo, action: 'Slack history record imported', newValue: { submission_number: submissionNumber, slack_ts: record.slack_ts }, comment: 'Imported from the finance-payroll-ot-temp Slack channel.' })
  return { imported: true, submission_number: submissionNumber }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const supabase = admin()
    const body = req.body || {}
    const actorInfo = actor(body)
    if (!canManage(actorInfo.role)) return res.status(403).json({ error: 'Only Admin or Payroll can import Slack history.' })
    const token = clean(process.env.SLACK_BOT_TOKEN)
    const channel = clean(process.env.SLACK_FINANCE_PAYROLL_CHANNEL_ID)
    if (!token || !channel) return res.status(500).json({ error: `${CHANNEL_ENV} and SLACK_BOT_TOKEN must be configured first.` })
    const messages = await slackHistory(token, channel, Math.min(50, Math.max(1, Number(body.max_pages || 20))))
    let imported = 0; let skipped = 0; const errors = []; const matched = []
    for (const message of messages) {
      if (message.subtype && message.subtype !== 'bot_message' && message.subtype !== 'file_share') continue
      const parsed = parseMessage(message)
      if (!parsed.match) continue
      matched.push({ ts: message.ts, worker: parsed.worker_name, type: parsed.entry_type })
      try {
        const result = await importRecord(supabase, parsed, actorInfo)
        if (result.skipped) skipped += 1; else imported += 1
      } catch (error) {
        errors.push({ ts: message.ts, worker: parsed.worker_name, message: error.message })
      }
    }
    return res.status(200).json({ success: true, fetched: messages.length, matched: matched.length, imported, skipped, errors, matched_preview: matched.slice(0, 20) })
  } catch (error) {
    return jsonError(res, error)
  }
}
