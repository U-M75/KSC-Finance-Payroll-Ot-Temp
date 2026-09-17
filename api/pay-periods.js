import { admin, clean, isAdmin, jsonError } from './_lib/db.js'

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

export default async function handler(req, res) {
  try {
    const supabase = admin()
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('finance_pay_periods').select('*').order('start_date', { ascending: false })
      if (error) throw error
      return res.status(200).json({ periods: data || [] })
    }
    const body = req.body || {}
    const role = clean(body.user_role)
    if (!isAdmin(role) && role !== 'Payroll') return res.status(403).json({ error: 'Only Admin or Payroll can manage pay periods.' })
    if (req.method === 'POST') {
      if (!validDate(body.start_date) || !validDate(body.end_date)) return res.status(400).json({ error: 'Valid start and end dates are required.' })
      if (body.end_date < body.start_date) return res.status(400).json({ error: 'End date cannot be before start date.' })
      const { data, error } = await supabase.from('finance_pay_periods').insert({
        start_date: body.start_date,
        end_date: body.end_date,
        status: body.status || 'Open',
        submission_deadline: body.submission_deadline || null,
        payroll_processing_date: body.payroll_processing_date || null,
        notes: body.notes || null,
      }).select().single()
      if (error) throw error
      return res.status(201).json({ success: true, period: data })
    }
    if (req.method === 'PATCH') {
      if (!body.id) return res.status(400).json({ error: 'Pay period id is required.' })
      const updates = {}
      for (const key of ['start_date', 'end_date', 'status', 'submission_deadline', 'payroll_processing_date', 'notes']) if (body[key] !== undefined) updates[key] = body[key]
      if (updates.start_date && updates.end_date && updates.end_date < updates.start_date) return res.status(400).json({ error: 'End date cannot be before start date.' })
      const { data: current, error: currentError } = await supabase.from('finance_pay_periods').select('*').eq('id', body.id).single()
      if (currentError) throw currentError
      const start = updates.start_date || current.start_date
      const end = updates.end_date || current.end_date
      if (end < start) return res.status(400).json({ error: 'End date cannot be before start date.' })
      const { data, error } = await supabase.from('finance_pay_periods').update(updates).eq('id', body.id).select().single()
      if (error) throw error
      return res.status(200).json({ success: true, period: data })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    return jsonError(res, error)
  }
}
