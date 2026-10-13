import { admin, clean, jsonError } from '../lib/finance/db.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const supabase = admin()
    let query = supabase.from('finance_audit_logs').select('*').order('created_at', { ascending: false }).limit(500)
    if (clean(req.query?.time_entry_id)) query = query.eq('time_entry_id', clean(req.query.time_entry_id))
    const { data, error } = await query
    if (error) throw error
    return res.status(200).json({ logs: data || [] })
  } catch (error) {
    return jsonError(res, error)
  }
}
