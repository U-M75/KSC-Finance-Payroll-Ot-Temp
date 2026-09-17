import { admin, clean, isAdmin, jsonError } from './_lib/db.js'

const PERIOD_TYPES = ['Temp Timecard', 'Employee OT']

function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) }
function iso(date) { return date.toISOString().slice(0, 10) }
function addDays(date, days) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next }
function firstMonday(year) {
  const janOne = new Date(Date.UTC(year, 0, 1))
  const daysUntilMonday = (8 - janOne.getUTCDay()) % 7
  return addDays(janOne, daysUntilMonday)
}
function weeklyPeriods(year) {
  const monday = firstMonday(year)
  const periods = []
  for (let index = 0; index < 52; index += 1) {
    const tempStart = addDays(monday, index * 7)
    const tempEnd = addDays(tempStart, 4)
    const otStart = addDays(tempStart, 1)
    const otEnd = addDays(otStart, 6)
    periods.push({ period_type: 'Temp Timecard', start_date: iso(tempStart), end_date: iso(tempEnd), status: 'Open', notes: `Generated weekly Mon–Fri period for ${year}.` })
    periods.push({ period_type: 'Employee OT', start_date: iso(otStart), end_date: iso(otEnd), status: 'Open', notes: `Generated weekly Tue–Mon period for ${year}.` })
  }
  return periods
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
      if (body.generate_year) {
        const year = Number(body.generate_year)
        if (!Number.isInteger(year) || year < 2020 || year > 2100) return res.status(400).json({ error: 'Enter a valid year between 2020 and 2100.' })
        const rows = weeklyPeriods(year)
        const { data, error } = await supabase.from('finance_pay_periods').upsert(rows, { onConflict: 'period_type,start_date,end_date', ignoreDuplicates: true }).select()
        if (error) throw error
        return res.status(201).json({ success: true, generated: rows.length, created: data?.length || 0, skipped: rows.length - (data?.length || 0), periods: data || [] })
      }
      if (!PERIOD_TYPES.includes(body.period_type || 'Temp Timecard')) return res.status(400).json({ error: 'Select Temp Timecard or Employee OT period type.' })
      if (!validDate(body.start_date) || !validDate(body.end_date)) return res.status(400).json({ error: 'Valid start and end dates are required.' })
      if (body.end_date < body.start_date) return res.status(400).json({ error: 'End date cannot be before start date.' })
      const { data, error } = await supabase.from('finance_pay_periods').insert({
        period_type: body.period_type || 'Temp Timecard',
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
      for (const key of ['period_type', 'start_date', 'end_date', 'status', 'submission_deadline', 'payroll_processing_date', 'notes']) if (body[key] !== undefined) updates[key] = body[key]
      if (updates.period_type && !PERIOD_TYPES.includes(updates.period_type)) return res.status(400).json({ error: 'Invalid period type.' })
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
