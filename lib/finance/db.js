import { createClient } from '@supabase/supabase-js'

export function clean(value) { return String(value ?? '').trim() }

export function admin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.')
  return createClient(url, key, { auth: { persistSession: false } })
}

export function actor(body = {}) {
  return {
    name: clean(body.user_name || body.submitted_by_name || 'System'),
    role: clean(body.user_role || body.submitted_by_role || 'Employee') || 'Employee',
  }
}

export function numberHours(value) {
  if (value === '' || value === null || value === undefined) return 0
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error('Hours must be a valid non-negative number.')
  return Math.round(number * 100) / 100
}

export async function audit(supabase, { timeEntryId = null, userName, userRole, action, oldValue = null, newValue = null, comment = null }) {
  await supabase.from('finance_audit_logs').insert({
    time_entry_id: timeEntryId,
    user_name: userName || 'System',
    user_role: userRole || null,
    action,
    old_value: oldValue,
    new_value: newValue,
    comment: comment || null,
  })
}

export async function notify(supabase, { userName = null, type, message, timeEntryId = null }) {
  await supabase.from('finance_notifications').insert({
    user_name: userName || null,
    notification_type: type,
    message,
    time_entry_id: timeEntryId,
  })
}

export function canManage(role) { return ['Admin', 'Payroll'].includes(role) }
export function isAdmin(role) { return role === 'Admin' }
export function sameName(a, b) {
  const left = clean(a).toLowerCase()
  const right = clean(b).toLowerCase()
  if (!left || !right) return false
  if (left === right) return true
  // Allow a full name to match its shorter form at a word boundary: "Sandra" ≡ "Sandra Pena",
  // but "Chris" does NOT match "Christopher" (no word boundary).
  const [short, long] = left.length <= right.length ? [left, right] : [right, left]
  return long.startsWith(`${short} `)
}

export function jsonError(res, error, status = 500) {
  console.error('Finance API error:', error)
  return res.status(status).json({ error: error.message || 'Finance request failed.' })
}
