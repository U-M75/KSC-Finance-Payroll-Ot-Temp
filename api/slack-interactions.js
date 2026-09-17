import crypto from 'node:crypto'
import { admin, audit, clean, notify } from './_lib/db.js'
import { slackApi } from './_lib/slack.js'

function rawPayload(req) {
  if (typeof req.body === 'string') return req.body
  return JSON.stringify(req.body || {})
}

function verifySignature(req) {
  const signingSecret = clean(process.env.SLACK_SIGNING_SECRET)
  if (!signingSecret) return true
  const timestamp = String(req.headers['x-slack-request-timestamp'] || '')
  const signature = String(req.headers['x-slack-signature'] || '')
  if (!timestamp || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false
  const base = `v0:${timestamp}:${rawPayload(req)}`
  const expected = `v0=${crypto.createHmac('sha256', signingSecret).update(base).digest('hex')}`
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

async function updateStatus(supabase, id, status, actorName, comment) {
  const { data: old, error: oldError } = await supabase.from('finance_time_entries').select('*').eq('id', id).single()
  if (oldError) throw oldError
  if (status === 'Rejected' && !comment) throw new Error('A rejection comment is required.')
  const updates = { status, updated_at: new Date().toISOString() }
  if (status === 'Approved') { updates.approved_by_name = actorName; updates.approved_at = new Date().toISOString() }
  if (['Rejected', 'Needs Correction'].includes(status)) updates.rejection_comment = comment
  const { data: saved, error } = await supabase.from('finance_time_entries').update(updates).eq('id', id).select('*').single()
  if (error) throw error
  await audit(supabase, { timeEntryId: id, userName: actorName, userRole: 'Supervisor', action: `Status changed to ${status} from Slack`, oldValue: { status: old.status }, newValue: { status }, comment })
  if (status === 'Approved') await notify(supabase, { userName: old.submitted_by_name, type: 'Submission approved', message: `${old.submission_number} was approved by ${actorName}.`, timeEntryId: id })
  if (status === 'Rejected') await notify(supabase, { userName: old.submitted_by_name, type: 'Submission rejected', message: `${old.submission_number} was rejected: ${comment}`, timeEntryId: id })
  if (status === 'Needs Correction') await notify(supabase, { userName: old.submitted_by_name, type: 'Correction requested', message: `${old.submission_number} needs correction: ${comment}`, timeEntryId: id })
  return saved
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed')
  if (!verifySignature(req)) return res.status(401).send('Invalid Slack signature')
  try {
    const payload = typeof req.body === 'string' ? JSON.parse(new URLSearchParams(req.body).get('payload') || '{}') : (req.body?.payload ? JSON.parse(req.body.payload) : req.body || {})
    const supabase = admin()
    if (payload.type === 'block_actions') {
      const action = payload.actions?.[0]
      const actorName = payload.user?.real_name || payload.user?.name || 'Slack approver'
      if (!action) return res.status(200).send('OK')
      if (action.action_id === 'finance_approve') {
        await updateStatus(supabase, action.value, 'Approved', actorName, 'Approved from Slack.')
        return res.status(200).json({ response_action: 'replace', text: 'Approved successfully.' })
      }
      if (['finance_reject', 'finance_correction'].includes(action.action_id)) {
        const status = action.action_id === 'finance_reject' ? 'Rejected' : 'Needs Correction'
        await slackApi('views.open', {
          trigger_id: payload.trigger_id,
          view: {
            type: 'modal',
            callback_id: 'finance_review_modal',
            private_metadata: JSON.stringify({ id: action.value, status, actorName }),
            title: { type: 'plain_text', text: status === 'Rejected' ? 'Reject Timecard' : 'Request Correction' },
            submit: { type: 'plain_text', text: 'Submit' },
            close: { type: 'plain_text', text: 'Cancel' },
            blocks: [{ type: 'input', block_id: 'comment_block', element: { type: 'plain_text_input', action_id: 'comment', multiline: true }, label: { type: 'plain_text', text: status === 'Rejected' ? 'Reason for rejection' : 'Correction details' } }],
          },
        })
        return res.status(200).send('OK')
      }
      return res.status(200).send('OK')
    }
    if (payload.type === 'view_submission' && payload.view?.callback_id === 'finance_review_modal') {
      const meta = JSON.parse(payload.view.private_metadata || '{}')
      const comment = payload.view.state?.values?.comment_block?.comment?.value || ''
      await updateStatus(supabase, meta.id, meta.status, meta.actorName || payload.user?.name || 'Slack approver', comment)
      return res.status(200).json({ response_action: 'clear' })
    }
    return res.status(200).send('OK')
  } catch (error) {
    console.error('Slack interaction error:', error)
    return res.status(200).json({ response_action: 'errors', errors: { comment_block: error.message || 'Could not update timecard.' } })
  }
}
