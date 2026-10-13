import { admin, clean, isAdmin, jsonError, audit } from './_lib/db.js'

const TABLES = {
  departments: 'finance_departments',
  agencies: 'finance_temp_agencies',
  workers: 'finance_temp_workers',
  employees: 'finance_employees',
  supervisors: 'finance_supervisors',
}

function tableFor(entity) {
  const table = TABLES[clean(entity)]
  if (!table) throw new Error('Unknown directory type.')
  return table
}

export default async function handler(req, res) {
  try {
    const supabase = admin()
    if (req.method === 'GET') {
      const [departments, agencies, workers, employees, supervisorRows] = await Promise.all([
        supabase.from('finance_departments').select('*').order('name'),
        supabase.from('finance_temp_agencies').select('*').order('name'),
        supabase.from('finance_temp_workers').select('*, finance_temp_agencies(name), finance_departments(name,code)').order('name'),
        supabase.from('finance_employees').select('*, finance_departments(name,code)').order('name'),
        supabase.from('finance_supervisors').select('*').order('name'),
      ])
      for (const result of [departments, agencies, workers, employees, supervisorRows]) if (result.error) throw result.error
      const supervisors = [...new Set([
        ...(supervisorRows.data || []).filter(row => row.status === 'Active').map(row => row.name),
        ...(workers.data || []).map(row => row.supervisor_name),
        ...(employees.data || []).map(row => row.supervisor_name),
      ].filter(Boolean))].sort()
      return res.status(200).json({ departments: departments.data || [], agencies: agencies.data || [], workers: workers.data || [], employees: employees.data || [], supervisors, supervisor_records: supervisorRows.data || [] })
    }

    const body = req.body || {}
    if (!isAdmin(clean(body.user_role))) return res.status(403).json({ error: 'Only Admin can manage directories.' })
    const table = tableFor(body.entity)
    if (req.method === 'POST') {
      const payload = { ...(body.record || {}) }
      delete payload.id
      const { data, error } = await supabase.from(table).insert(payload).select().single()
      if (error) throw error
      return res.status(201).json({ success: true, record: data })
    }
    if (req.method === 'PATCH') {
      if (!body.id) return res.status(400).json({ error: 'Record id is required.' })
      const payload = { ...(body.record || {}) }
      delete payload.id
      const { data, error } = await supabase.from(table).update(payload).eq('id', body.id).select().single()
      if (error) throw error
      return res.status(200).json({ success: true, record: data })
    }
    if (req.method === 'DELETE') {
      if (!body.id) return res.status(400).json({ error: 'Record id is required.' })
      const { data: existing, error: fetchError } = await supabase.from(table).select('id, name').eq('id', body.id).single()
      if (fetchError) return res.status(404).json({ error: 'Record not found.' })
      const { error } = await supabase.from(table).delete().eq('id', body.id)
      if (error) {
        if (error.code === '23503') return res.status(409).json({ error: `"${existing?.name || 'This record'}" is linked to existing time entries and cannot be deleted. Mark it as Inactive instead.` })
        throw error
      }
      await audit(supabase, { userName: clean(body.user_name), userRole: clean(body.user_role), action: `Deleted ${clean(body.entity)} directory record`, comment: existing?.name || null })
      return res.status(200).json({ success: true })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    return jsonError(res, error)
  }
}
