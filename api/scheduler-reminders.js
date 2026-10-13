import { admin, clean, jsonError } from '../lib/finance/db.js'
import { sendDailyReminder, sendFinanceSlack } from '../lib/finance/slack.js'

function authorized(req) {
  const secret = clean(process.env.CRON_SECRET)
  if (!secret) return true
  return String(req.headers.authorization || '') === `Bearer ${secret}` || clean(req.query?.secret) === secret
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized scheduler request.' })
  try {
    const supabase = admin()
    const { data: pending, error } = await supabase.from('finance_time_entries').select('id,submission_number,status,supervisor_name,submitted_by_name,created_at').in('status', ['Pending Approval','Needs Correction']).order('created_at')
    if (error) throw error
    const reminder = await sendDailyReminder()
    const overdue = (pending || []).filter(row => Date.now() - new Date(row.created_at).getTime() > 24 * 60 * 60 * 1000)
    if (overdue.length) {
      await sendFinanceSlack({
        text: `${overdue.length} timecard(s) have been waiting for action for more than 24 hours.`,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `:warning: *${overdue.length} timecard(s) need attention*\nThese submissions have been waiting for approval or correction for more than 24 hours.` } }],
      })
    }
    return res.status(200).json({ success: true, reminderSent: reminder.sent === true, pending: pending?.length || 0, overdue: overdue.length })
  } catch (error) {
    return jsonError(res, error)
  }
}
