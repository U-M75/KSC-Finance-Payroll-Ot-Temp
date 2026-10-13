import { admin, actor, audit, canManage, clean, jsonError, numberHours } from '../lib/finance/db.js'

function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) }
function asNumber(value) { return numberHours(value === '' || value === null || value === undefined ? 0 : value) }
function normalizeType(record) {
  const value = String(record.entry_type || record.type || record.submission_type || '').toLowerCase()
  return value.includes('ot') && !value.includes('temp') ? 'Employee OT' : 'Temp Timecard'
}
function normalizeStatus(value) {
  const valueText = clean(value)
  if (['Draft','Submitted','Pending Approval','Approved','Rejected','Needs Correction','Processed','Exported to QuickBooks'].includes(valueText)) return valueText
  return 'Processed'
}
function first(record, keys, fallback = '') {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null && String(record[key]).trim() !== '') return record[key]
  return fallback
}

async function findOrCreateDepartment(supabase, name) {
  const departmentName = clean(name) || 'Unassigned'
  let result = await supabase.from('finance_departments').select('*').eq('name', departmentName).maybeSingle()
  if (result.error) throw result.error
  if (result.data) return result.data
  result = await supabase.from('finance_departments').insert({ name: departmentName, status: 'Active' }).select().single()
  if (result.error) throw result.error
  return result.data
}

async function findOrCreateAgency(supabase, name) {
  const agencyName = clean(name) || 'Historical / Unknown Agency'
  let result = await supabase.from('finance_temp_agencies').select('*').eq('name', agencyName).maybeSingle()
  if (result.error) throw result.error
  if (result.data) return result.data
  result = await supabase.from('finance_temp_agencies').insert({ name: agencyName, status: 'Active', notes: 'Created during historical Slack import.' }).select().single()
  if (result.error) throw result.error
  return result.data
}

async function findOrCreateWorker(supabase, record, agency, department) {
  const name = clean(first(record, ['temp_worker_name','worker_name','worker_or_employee','worker','temp_worker','name'])) || 'Historical / Unknown Worker'
  let query = supabase.from('finance_temp_workers').select('*').eq('name', name)
  if (record.worker_id || record.worker_id_snapshot) query = query.eq('worker_id', first(record, ['worker_id','worker_id_snapshot']))
  const result = await query.limit(1).maybeSingle()
  if (result.error) throw result.error
  if (result.data) return result.data
  const inserted = await supabase.from('finance_temp_workers').insert({
    name,
    agency_id: agency.id,
    worker_id: first(record, ['worker_id','worker_id_snapshot','agency_worker_id'], null),
    department_id: department.id,
    supervisor_name: first(record, ['supervisor','supervisor_name'], 'Unassigned'),
    status: 'Active',
    notes: 'Created during historical Slack import.',
  }).select().single()
  if (inserted.error) throw inserted.error
  return inserted.data
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const supabase = admin()
    const body = req.body || {}
    const currentActor = actor(body)
    if (!canManage(currentActor.role)) return res.status(403).json({ error: 'Only Admin or Payroll can import historical timecards.' })
    const records = Array.isArray(body.records) ? body.records.slice(0, 1000) : []
    if (!records.length) return res.status(400).json({ error: 'No import records were provided.' })

    let imported = 0
    let skipped = 0
    const errors = []
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index] || {}
      try {
        const entryType = normalizeType(record)
        const start = clean(first(record, ['pay_period_start','period_start','start_date']))
        const end = clean(first(record, ['pay_period_end','period_end','end_date']))
        if (!validDate(start) || !validDate(end) || end < start) throw new Error('Valid pay-period start/end dates are required.')
        const periodType = entryType === 'Employee OT' ? 'Employee OT' : 'Temp Timecard'
        let periodResult = await supabase.from('finance_pay_periods').select('*').eq('period_type', periodType).eq('start_date', start).eq('end_date', end).maybeSingle()
        if (periodResult.error) throw periodResult.error
        let period = periodResult.data
        if (!period) {
          periodResult = await supabase.from('finance_pay_periods').insert({ period_type: periodType, start_date: start, end_date: end, status: 'Processed', notes: 'Created during historical Slack import.' }).select().single()
          if (periodResult.error) throw periodResult.error
          period = periodResult.data
        }
        const department = await findOrCreateDepartment(supabase, first(record, ['department','department_name']))
        let worker = null
        let agency = null
        let employee = null
        if (entryType === 'Temp Timecard') {
          agency = await findOrCreateAgency(supabase, first(record, ['agency','temp_agency','temp_agency_name']))
          worker = await findOrCreateWorker(supabase, record, agency, department)
        } else {
          const employeeName = clean(first(record, ['employee_name','employee','worker_or_employee','worker_name','name'])) || 'Historical / Unknown Employee'
          let employeeResult = await supabase.from('finance_employees').select('*').eq('name', employeeName).limit(1).maybeSingle()
          if (employeeResult.error) throw employeeResult.error
          if (!employeeResult.data) employeeResult = await supabase.from('finance_employees').insert({ name: employeeName, department_id: department.id, supervisor_name: first(record, ['supervisor','supervisor_name'], 'Unassigned'), status: 'Active' }).select().single()
          if (employeeResult.error) throw employeeResult.error
          employee = employeeResult.data
        }

        const sourceNumber = clean(first(record, ['submission_number','submission_id','claim_number']))
        if (sourceNumber) {
          const existing = await supabase.from('finance_time_entries').select('id').eq('submission_number', sourceNumber).maybeSingle()
          if (existing.error) throw existing.error
          if (existing.data) { skipped += 1; continue }
        }
        const numberResult = sourceNumber ? { data: sourceNumber } : await supabase.rpc('next_finance_submission_number')
        if (numberResult.error) throw numberResult.error
        const approvedBy = clean(first(record, ['approved_by','approved_by_name'])) || null
        const approvedAt = first(record, ['approved_at','approval_date'], null) || null
        const status = normalizeStatus(first(record, ['status','approval_status'], 'Processed'))
        const workDate = clean(first(record, ['work_date','date'], start)) || start
        const payload = {
          submission_number: numberResult.data,
          entry_type: entryType,
          pay_period_id: period.id,
          employee_id: employee?.id || null,
          temp_worker_id: worker?.id || null,
          temp_agency_id: agency?.id || null,
          department_id: department.id,
          employee_name_snapshot: employee?.name || (entryType === 'Employee OT' ? first(record, ['employee_name','employee','worker_or_employee','worker_name','name']) : null),
          temp_worker_name_snapshot: worker?.name || (entryType === 'Temp Timecard' ? first(record, ['temp_worker_name','worker_name','worker_or_employee','worker','temp_worker','name']) : null),
          temp_agency_name_snapshot: agency?.name || (entryType === 'Temp Timecard' ? first(record, ['agency','temp_agency','temp_agency_name']) : null),
          department_name_snapshot: department.name,
          supervisor_name: first(record, ['supervisor','supervisor_name'], 'Unassigned'),
          work_date: validDate(workDate) ? workDate : start,
          assignment_location: first(record, ['assignment_location','location'], null),
          job_role: first(record, ['job_role','role'], null),
          worker_id_snapshot: worker?.worker_id || first(record, ['worker_id','worker_id_snapshot'], null),
          agency_worker_id: first(record, ['agency_worker_id'], null),
          submitted_by_name: first(record, ['submitted_by','submitted_by_name','requester'], 'Historical Slack Import'),
          submitted_by_role: 'Historical Import',
          submitted_on_behalf_of: first(record, ['submitted_on_behalf_of'], 'Myself'),
          representing_name: first(record, ['representing_name'], null),
          representation_reason: first(record, ['representation_reason'], null),
          regular_hours: asNumber(first(record, ['regular_hours','regular','total_regular_hours'], 0)),
          overtime_hours: asNumber(first(record, ['overtime_hours','ot_hours','ot'], 0)),
          double_time_hours: asNumber(first(record, ['double_time_hours','dt_hours','dt'], 0)),
          reason_for_ot: first(record, ['reason_for_ot','ot_reason'], null),
          notes: first(record, ['notes','note'], null),
          status,
          approved_by_name: approvedBy,
          approved_at: approvedAt,
          rejection_comment: first(record, ['rejection_comment','approval_comment'], null),
        }
        const saved = await supabase.from('finance_time_entries').insert(payload).select().single()
        if (saved.error) throw saved.error
        const fileUrl = first(record, ['pdf_url','file_url','document_url'], null)
        const fileName = first(record, ['pdf_file_name','file_name'], null)
        if (fileUrl || fileName) await supabase.from('finance_documents').insert({ time_entry_id: saved.data.id, document_type: 'Historical Slack PDF', file_url: fileUrl, file_name: fileName || `${saved.data.submission_number}.pdf` })
        if (approvedBy || ['Approved', 'Processed', 'Exported to QuickBooks'].includes(status)) await supabase.from('finance_approvals').insert({ time_entry_id: saved.data.id, level: 1, approver_name: approvedBy || 'Historical Slack Approval', status: 'Approved', comment: first(record, ['approval_comment','comment'], 'Imported approval record.') })
        await audit(supabase, { timeEntryId: saved.data.id, ...currentActor, action: 'Historical Slack record imported', newValue: { submission_number: saved.data.submission_number, source: sourceNumber || 'Generated' }, comment: 'Imported from legacy Slack workflow.' })
        imported += 1
      } catch (error) {
        errors.push({ row: index + 2, message: error.message })
      }
    }
    return res.status(200).json({ success: true, imported, skipped, errors })
  } catch (error) {
    return jsonError(res, error)
  }
}
