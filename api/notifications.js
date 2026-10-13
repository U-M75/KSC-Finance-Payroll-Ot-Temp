import { admin, clean, jsonError } from './_lib/db.js'

export default async function handler(req, res) {
  try {
    const supabase = admin()
    const userName = clean(req.query?.user_name || req.body?.user_name)
    if (req.method === 'GET') {
      let query = supabase.from('finance_notifications').select('*').order('created_at', { ascending: false }).limit(100)
      if (userName) query = query.or(`user_name.ilike.${userName},user_name.is.null`)
      const { data, error } = await query
      if (error) throw error
      return res.status(200).json({ notifications: data || [] })
    }
    if (req.method === 'PATCH') {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : []
      if (!ids.length) return res.status(400).json({ error: 'Notification ids are required.' })
      const { error } = await supabase.from('finance_notifications').update({ read: true }).in('id', ids)
      if (error) throw error
      return res.status(200).json({ success: true })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    return jsonError(res, error)
  }
}
