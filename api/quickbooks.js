import { admin, actor, audit, canManage, clean, jsonError } from '../lib/finance/db.js'

export default async function handler(req, res) {
  try {
    const supabase = admin()
    if (req.method === 'GET') {
      return res.status(200).json({
        enabled: String(process.env.QUICKBOOKS_ENABLED || 'false').toLowerCase() === 'true',
        connected: false,
        message: 'QuickBooks integration layer is ready; live credentials are not configured.',
      })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = req.body || {}
    const currentActor = actor(body)
    if (!canManage(currentActor.role)) return res.status(403).json({ error: 'Only Admin or Payroll can prepare a QuickBooks export.' })
    if (!body.id) return res.status(400).json({ error: 'Submission id is required.' })
    const { data: current, error: currentError } = await supabase.from('finance_time_entries').select('*').eq('id', body.id).single()
    if (currentError) throw currentError
    if (!['Approved', 'Processed', 'Exported to QuickBooks'].includes(current.status)) return res.status(400).json({ error: 'Only approved or processed records can be prepared for QuickBooks.' })
    if (String(process.env.QUICKBOOKS_ENABLED || 'false').toLowerCase() !== 'true') {
      const { data, error } = await supabase.from('finance_time_entries').update({ quickbooks_status: 'Ready for Export', updated_at: new Date().toISOString() }).eq('id', body.id).select().single()
      if (error) throw error
      await audit(supabase, { timeEntryId: body.id, ...currentActor, action: 'QuickBooks export prepared', oldValue: { quickbooks_status: current.quickbooks_status }, newValue: { quickbooks_status: 'Ready for Export' }, comment: 'Live QuickBooks credentials are not configured; no export was sent.' })
      return res.status(200).json({ success: true, exported: false, placeholder: true, entry: data, message: 'Marked Ready for Export only. No QuickBooks export was sent.' })
    }
    return res.status(501).json({ error: 'Live QuickBooks adapter is not configured yet. Record was not marked as exported.' })
  } catch (error) {
    return jsonError(res, error)
  }
}
