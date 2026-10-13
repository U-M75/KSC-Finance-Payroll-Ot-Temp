// Single Slack entry point: Events API + Interactivity (buttons and modals).
// Set this URL in the existing KSC Slack app:
//   Event Subscriptions Request URL  -> https://YOUR-DOMAIN/api/slack-events
//   Interactivity Request URL        -> https://YOUR-DOMAIN/api/slack-events
import { methodNotAllowed, fail } from '../env.js'
import { readRawBody, verifySlackRequest } from '../slack.js'
import { db } from '../supabase.js'
import { handleMemberJoined, handleOpenForm, handleFormSubmission, handleJoiningDateAction } from '../slack-flows.js'

// Slack signs the raw body, so Vercel must not parse it first.
export const config = { api: { bodyParser: false } }

const ACK = { ok: true }

async function alreadyProcessed(eventId) {
  if (!eventId) return false
  const { error } = await db().from('ksc_slack_event_log').insert({ event_id: eventId })
  if (error && error.code === '23505') return true
  if (error) throw new Error(`Could not record Slack event: ${error.message}`)
  return false
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res)
  try {
    const raw = await readRawBody(req)
    if (!verifySlackRequest(raw, req.headers)) return res.status(401).json({ error: 'Invalid Slack signature.' })

    const contentType = String(req.headers['content-type'] || '')
    const payload = contentType.includes('application/x-www-form-urlencoded')
      ? JSON.parse(new URLSearchParams(raw).get('payload') || '{}')
      : JSON.parse(raw || '{}')

    if (payload.type === 'url_verification') return res.status(200).json({ challenge: payload.challenge })

    if (payload.type === 'event_callback') {
      if (await alreadyProcessed(payload.event_id)) return res.status(200).json(ACK)
      const event = payload.event || {}
      if (event.type === 'member_joined_channel') await handleMemberJoined(event)
      return res.status(200).json(ACK)
    }

    if (payload.type === 'block_actions') {
      const action = payload.actions?.[0] || {}
      if (action.action_id === 'open_onboarding_form') await handleOpenForm(payload, action)
      if (action.action_id === 'approve_joining_date' || action.action_id === 'reject_joining_date') {
        await handleJoiningDateAction(payload, action)
      }
      return res.status(200).end()
    }

    if (payload.type === 'view_submission' && payload.view?.callback_id === 'onboarding_form') {
      const body = await handleFormSubmission(payload)
      return res.status(200).json(body)
    }

    return res.status(200).json(ACK)
  } catch (error) {
    if (error?.name === 'HttpError' && error.status < 500) {
      // Surface validation-style errors in the modal rather than a 500.
      console.warn('Slack request rejected:', error.message)
      return res.status(error.status).json({ error: error.message })
    }
    return fail(res, error, 'Slack events error')
  }
}

