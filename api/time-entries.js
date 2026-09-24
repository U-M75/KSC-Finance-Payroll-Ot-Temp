import { admin, actor, audit, canManage, clean, isAdmin, jsonError, notify, numberHours } from './_lib/db.js'
import { sendApprovedTimeEntryNotification, sendNewEntryNotification, sendStatusNotification } from './_lib/slack.js'

const ENTRY_STATUSES = ['Draft', 'Submitted', 'Pending Approval', 'Approved', 'Rejected', 'Needs Correction', 'Processed', 'Exported to QuickBooks']
const OPEN_STATUSES = ['Submitted', 'Pending Approval', 'Needs Correction']

function periodLabel(period) {
  if (!period?.start_date || !period?.end_date) return '—'
  const schedule = period.period_type === 'Employee OT' ? 'Tue–Mon OT' : 'Mon–Fri Temp'
  return `${period.start_date} → ${period.end_date} · ${schedule}`
}

function decorate(row) {
  return {
    ...row,
    period_label: periodLabel(row.finance_pay_periods),
    department_label: row.department_name_snapshot || row.finance_departments?.name || '—',
    agency_label: row.temp_agency_name_snapshot || row.finance_temp_agencies?.name || '—',
    subject_name: row.entry_type === 'Temp Timecard' ? row.temp_worker_name_snapshot : row.employee_name_snapshot,
    total_hours: Number(row.regular_hours || 0) + Number(row.overtime_hours || 0) + Number(row.double_time_hours || 0),
  }
}

async function lookupNames(supabase, body) {
  const result = { departmentName: body.department_name_snapshot || null, agencyName: body.temp_agency_name_snapshot || null, workerName: body.temp_worker_name_snapshot || null, employeeName: body.employee_name_snapshot || null, workerId: body.worker_id_snapshot || null, workerSupervisor: null, employeeSupervisor: null }
  if (body.department_id) {
    const { data, error } = await supabase.from('finance_departments').select('name').eq('id', body.department_id).maybeSingle()
    if (error) throw error
    result.departmentName = data?.name || result.departmentName
  }
  if (body.temp_agency_id) {
    const { data, error } = await supabase.from('finance_temp_agencies').select('name').eq('id', body.temp_agency_id).maybeSingle()
    if (error) throw error
    result.agencyName = data?.name || result.agencyName
  }
  if (body.temp_worker_id) {
    const { data, error } = await supabase.from('finance_temp_workers').select('name,worker_id,agency_id,department_id,supervisor_name').eq('id', body.temp_worker_id).maybeSingle()
    if (error) throw error
    if (data) {
      result.workerName = data.name
      result.workerId = result.workerId || data.worker_id
      result.workerSupervisor = data.supervisor_name || null
      if (!body.temp_agency_id && data.agency_id) {
        const agency = await supabase.from('finance_temp_agencies').select('name').eq('id', data.agency_id).maybeSingle()
        if (agency.error) throw agency.error
        result.agencyName = result.agencyName || agency.data?.name
      }
    }
  }
  if (body.employee_id) {
    const { data, error } = await supabase.from('finance_employees').select('name,supervisor_name').eq('id', body.employee_id).maybeSingle()
    if (error) throw error
    result.employeeName = data?.name || result.employeeName
    result.employeeSupervisor = data?.supervisor_name || null
  }
  return result
}

function entryQuery(supabase) {
  return supabase.from('finance_time_entries').select('*, finance_pay_periods(period_type,start_date,end_date,status), finance_departments(name,code)').order('created_at', { ascending: false }).limit(2000)
}

async function sendApprovalSlackOnce(supabase, entry, approverName) {
  const claim = await supabase.from('finance_time_entries')
    .update({ approval_slack_sent_at: new Date().toISOString() })
    .eq('id', entry.id)
    .is('approval_slack_sent_at', null)
    .select('id')
    .maybeSingle()
  if (claim.error) throw claim.error
  if (!claim.data) return { sent: false, duplicate: true }
  try {
    const result = await sendApprovedTimeEntryNotification(entry, approverName)
    if (!result.sent) {
      await supabase.from('finance_time_entries').update({ approval_slack_sent_at: null }).eq('id', entry.id)
    } else {
      await supabase.from('finance_time_entries').update({ approval_slack_message_id: result.ts || null }).eq('id', entry.id)
    }
    return result
  } catch (error) {
    await supabase.from('finance_time_entries').update({ approval_slack_sent_at: null }).eq('id', entry.id)
    throw error
  }
}

export default async function handler(req, res) {
  try {
    const supabase = admin()

    if (req.method === 'GET') {
      const singleId = clean(req.query?.id)
      if (singleId) {
        const { data, error } = await supabase.from('finance_time_entries').select('*, finance_pay_periods(period_type,start_date,end_date,status), finance_departments(name,code)').eq('id', singleId).single()
        if (error) throw error
        return res.status(200).json({ entry: decorate(data) })
      }
      let query = entryQuery(supabase)
      const q = clean(req.query?.q)
      const status = clean(req.query?.status)
      const type = clean(req.query?.entry_type)
      const payPeriod = clean(req.query?.pay_period_id)
      const department = clean(req.query?.department_id)
      if (status) query = query.eq('status', status)
      if (type) query = query.eq('entry_type', type)
      if (payPeriod) query = query.eq('pay_period_id', payPeriod)
      if (department) query = query.eq('department_id', department)
      if (q) query = query.or(`submission_number.ilike.%${q}%,employee_name_snapshot.ilike.%${q}%,temp_worker_name_snapshot.ilike.%${q}%,temp_agency_name_snapshot.ilike.%${q}%,department_name_snapshot.ilike.%${q}%,supervisor_name.ilike.%${q}%`)
      const { data, error } = await query
      if (error) throw error
      let rows = (data || []).map(decorate)
      const role = clean(req.query?.user_role)
      const userName = clean(req.query?.user_name)
      if (role === 'Supervisor') rows = rows.filter(row => row.supervisor_name === userName || row.submitted_by_name === userName)
      if (role === 'Employee') rows = rows.filter(row => row.submitted_by_name === userName || row.employee_name_snapshot === userName)
      return res.status(200).json({ entries: rows })
    }

    const body = req.body || {}
    const currentActor = actor(body)

    if (req.method === 'POST') {
      const entryType = clean(body.entry_type)
      if (!['Employee OT', 'Temp Timecard'].includes(entryType)) return res.status(400).json({ error: 'Select a valid submission type.' })
      if (!body.pay_period_id || !body.department_id || !clean(body.supervisor_name)) return res.status(400).json({ error: 'Pay period, department and supervisor are required.' })
      const hours = {
        regular_hours: numberHours(body.regular_hours),
        overtime_hours: numberHours(body.overtime_hours),
        double_time_hours: numberHours(body.double_time_hours),
      }
      if (hours.regular_hours + hours.overtime_hours + hours.double_time_hours === 0 && body.confirm_zero_hours !== true) return res.status(400).json({ error: 'All hours are 0. Confirm the zero-hour submission before saving.' })
      const names = await lookupNames(supabase, body)
      if (entryType === 'Temp Timecard' && (!names.workerName || !names.agencyName)) return res.status(400).json({ error: 'Temp agency and temp worker are required.' })
      if (entryType === 'Employee OT' && !names.employeeName) return res.status(400).json({ error: 'Employee name is required.' })
      if (currentActor.role === 'Supervisor') {
        if (clean(body.supervisor_name) !== currentActor.name) return res.status(403).json({ error: 'Supervisors can only submit requests under their own name.' })
        const assignedSupervisor = entryType === 'Temp Timecard' ? names.workerSupervisor : names.employeeSupervisor
        if (assignedSupervisor && assignedSupervisor !== currentActor.name) return res.status(403).json({ error: 'This worker is assigned to a different supervisor.' })
      }

      const { data: period, error: periodError } = await supabase.from('finance_pay_periods').select('*').eq('id', body.pay_period_id).single()
      if (periodError) throw periodError
      if (['Closed', 'Processed'].includes(period.status) && !isAdmin(currentActor.role)) return res.status(400).json({ error: 'This pay period is closed.' })
      if (body.work_date && (body.work_date < period.start_date || body.work_date > period.end_date)) return res.status(400).json({ error: 'Work date must be within the selected pay period.' })

      const { data: existing, error: duplicateError } = await supabase.from('finance_time_entries').select('id,submission_number,status').eq('pay_period_id', body.pay_period_id).eq('entry_type', entryType).eq(entryType === 'Temp Timecard' ? 'temp_worker_id' : 'employee_id', entryType === 'Temp Timecard' ? (body.temp_worker_id || '00000000-0000-0000-0000-000000000000') : (body.employee_id || '00000000-0000-0000-0000-000000000000')).eq('work_date', body.work_date || period.start_date).in('status', OPEN_STATUSES)
      if (duplicateError) throw duplicateError
      if ((existing || []).length) return res.status(409).json({ error: `A similar open submission already exists: ${existing[0].submission_number}.` })

      const { data: number, error: numberError } = await supabase.rpc('next_finance_submission_number')
      if (numberError) throw numberError
      const status = body.save_as_draft ? 'Draft' : 'Pending Approval'
      const payload = {
        submission_number: number,
        entry_type: entryType,
        pay_period_id: body.pay_period_id,
        employee_id: body.employee_id || null,
        temp_worker_id: body.temp_worker_id || null,
        temp_agency_id: body.temp_agency_id || null,
        department_id: body.department_id,
        employee_name_snapshot: names.employeeName,
        temp_worker_name_snapshot: names.workerName,
        temp_agency_name_snapshot: names.agencyName,
        department_name_snapshot: names.departmentName,
        supervisor_name: clean(body.supervisor_name),
        work_date: body.work_date || period.start_date,
        assignment_location: body.assignment_location || null,
        job_role: body.job_role || null,
        worker_id_snapshot: names.workerId || null,
        agency_worker_id: body.agency_worker_id || null,
        submitted_by_name: currentActor.name,
        submitted_by_role: currentActor.role,
        submitted_on_behalf_of: body.submitted_on_behalf_of || 'Myself',
        representing_name: body.representing_name || null,
        representation_reason: body.representation_reason || null,
        ...hours,
        reason_for_ot: body.reason_for_ot || null,
        notes: body.notes || null,
        status,
      }
      const { data: saved, error: insertError } = await supabase.from('finance_time_entries').insert(payload).select('*, finance_pay_periods(period_type,start_date,end_date,status), finance_departments(name,code)').single()
      if (insertError) throw insertError
      const entry = decorate(saved)
      await audit(supabase, { timeEntryId: saved.id, ...currentActor, action: status === 'Draft' ? 'Record created as draft' : 'Record submitted', newValue: saved, comment: body.representation_reason || null })
      if (status !== 'Draft') {
        await supabase.from('finance_approvals').insert({ time_entry_id: saved.id, level: 1, approver_name: saved.supervisor_name, status: 'Pending' })
        await notify(supabase, { userName: saved.supervisor_name, type: 'Approval required', message: `${saved.submission_number} is waiting for your approval.`, timeEntryId: saved.id })
        try { await sendNewEntryNotification(entry) } catch (slackError) { console.error('Finance Slack submission notification failed:', slackError) }
      }
      return res.status(201).json({ success: true, entry })
    }

    if (req.method === 'PATCH') {
      if (!body.id) return res.status(400).json({ error: 'Submission id is required.' })
      const { data: old, error: oldError } = await supabase.from('finance_time_entries').select('*, finance_pay_periods(period_type,start_date,end_date,status), finance_departments(name,code)').eq('id', body.id).single()
      if (oldError) throw oldError
      const oldEntry = decorate(old)
      const requestedStatus = clean(body.status)
      const update = {}
      for (const key of ['notes', 'reason_for_ot', 'assignment_location', 'job_role', 'work_date', 'regular_hours', 'overtime_hours', 'double_time_hours', 'submitted_on_behalf_of', 'representing_name', 'representation_reason']) if (body[key] !== undefined) update[key] = body[key]
      if (body.regular_hours !== undefined) update.regular_hours = numberHours(body.regular_hours)
      if (body.overtime_hours !== undefined) update.overtime_hours = numberHours(body.overtime_hours)
      if (body.double_time_hours !== undefined) update.double_time_hours = numberHours(body.double_time_hours)
      if (update.work_date && (update.work_date < old.finance_pay_periods.start_date || update.work_date > old.finance_pay_periods.end_date)) return res.status(400).json({ error: 'Work date must be within the selected pay period.' })
      if (requestedStatus && !ENTRY_STATUSES.includes(requestedStatus)) return res.status(400).json({ error: 'Invalid status.' })

      if (requestedStatus && requestedStatus !== old.status) {
        if (requestedStatus === 'Rejected' && !clean(body.comment)) return res.status(400).json({ error: 'A rejection reason is required.' })
        if (requestedStatus === 'Approved' && !['Supervisor', 'Payroll', 'Admin'].includes(currentActor.role)) return res.status(403).json({ error: 'Only the supervisor or Payroll can approve.' })
        if (requestedStatus === 'Approved' && currentActor.role === 'Supervisor' && old.supervisor_name !== currentActor.name) return res.status(403).json({ error: 'Supervisors can only approve their own workers.' })
        if (requestedStatus === 'Processed' && !canManage(currentActor.role)) return res.status(403).json({ error: 'Only Admin or Payroll can process a submission.' })
        if (requestedStatus === 'Exported to QuickBooks' && !canManage(currentActor.role)) return res.status(403).json({ error: 'Only Admin or Payroll can mark QuickBooks exports.' })
        if (['Rejected', 'Needs Correction'].includes(requestedStatus) && !['Supervisor', 'Payroll', 'Admin'].includes(currentActor.role)) return res.status(403).json({ error: 'Only an approver can return this submission.' })
        update.status = requestedStatus
        if (requestedStatus === 'Approved') { update.approved_by_name = currentActor.name; update.approved_at = new Date().toISOString() }
        if (requestedStatus === 'Processed') update.processed_at = new Date().toISOString()
        if (requestedStatus === 'Rejected' || requestedStatus === 'Needs Correction') {
          update.rejection_comment = clean(body.comment)
          update.approval_slack_sent_at = null
          update.approval_slack_message_id = null
        }
        if (requestedStatus === 'Submitted') update.status = 'Pending Approval'
      }
      if (!Object.keys(update).length) return res.status(400).json({ error: 'No changes provided.' })
      update.updated_at = new Date().toISOString()
      const { data: saved, error: updateError } = await supabase.from('finance_time_entries').update(update).eq('id', body.id).select('*, finance_pay_periods(period_type,start_date,end_date,status), finance_departments(name,code)').single()
      if (updateError) throw updateError
      const entry = decorate(saved)
      await audit(supabase, { timeEntryId: saved.id, ...currentActor, action: requestedStatus && requestedStatus !== old.status ? `Status changed to ${saved.status}` : 'Record edited', oldValue: oldEntry, newValue: entry, comment: body.comment || null })
      if (requestedStatus && requestedStatus !== old.status) {
        const approvalStatus = saved.status === 'Approved' ? 'Approved' : saved.status === 'Rejected' ? 'Rejected' : saved.status === 'Needs Correction' ? 'Needs Correction' : null
        if (approvalStatus) await supabase.from('finance_approvals').insert({ time_entry_id: saved.id, level: 1, approver_name: currentActor.name, status: approvalStatus, comment: body.comment || null })
        if (saved.status === 'Approved') {
          await notify(supabase, { userName: saved.submitted_by_name, type: 'Submission approved', message: `${saved.submission_number} was approved by ${currentActor.name}.`, timeEntryId: saved.id })
          try { await sendApprovalSlackOnce(supabase, entry, currentActor.name) } catch (slackError) { console.error('Finance approval Slack notification failed:', slackError) }
        }
        if (saved.status === 'Rejected') await notify(supabase, { userName: saved.submitted_by_name, type: 'Submission rejected', message: `${saved.submission_number} was rejected: ${body.comment}`, timeEntryId: saved.id })
        if (saved.status === 'Needs Correction') await notify(supabase, { userName: saved.submitted_by_name, type: 'Correction requested', message: `${saved.submission_number} needs correction: ${body.comment}`, timeEntryId: saved.id })
        if (saved.status !== 'Approved') {
          try { await sendStatusNotification(entry, saved.status, currentActor.name, body.comment || '') } catch (slackError) { console.error('Finance Slack status notification failed:', slackError) }
        }
      }
      return res.status(200).json({ success: true, entry })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    return jsonError(res, error)
  }
}
