// Kawaii HQ: Birthday & Anniversary API. ONE serverless function (Vercel Hobby allows 12 per project),
// routed by ?route=
//   POST ?route=login               -> sign in (Finance-style env accounts)
//   GET  ?route=me                  -> current session
//   *    ?route=employees           -> employee records
//   *    ?route=onboarding          -> onboarding and upcoming celebrations
//   POST ?route=slack               -> Slack Events and interactivity (signed raw body)
//   GET  ?route=cron&job=milestones -> daily shoutouts (Vercel Cron, Bearer CRON_SECRET)
//   GET  ?route=cron&job=digest     -> daily digest (Vercel Cron, Bearer CRON_SECRET)
import { login } from './birthday/_lib/login.js'
import { currentSession, describeMe } from './birthday/_lib/auth.js'
import { methodNotAllowed, fail, clean } from './birthday/_lib/env.js'
import { readRawBody } from './birthday/_lib/slack.js'
import employeesHandler from './birthday/_lib/handlers/employees.js'
import onboardingHandler from './birthday/_lib/handlers/onboarding.js'
import slackHandler from './birthday/_lib/handlers/slack-events.js'
import milestonesHandler from './birthday/_lib/handlers/milestones.js'
import digestHandler from './birthday/_lib/handlers/digest.js'

// Bodyless parsing so Slack's signature check sees the exact raw bytes. JSON is parsed below.
export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  const route = clean(req.query?.route)
  try {
    if (route === 'slack') return slackHandler(req, res)
    if (route === 'cron') {
      const job = clean(req.query?.job)
      if (job === 'milestones') return milestonesHandler(req, res)
      if (job === 'digest') return digestHandler(req, res)
      return res.status(404).json({ error: 'Unknown job.' })
    }

    if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
      const raw = await readRawBody(req)
      try { req.body = raw ? JSON.parse(raw) : {} } catch { return res.status(400).json({ error: 'Request body must be JSON.' }) }
    }

    if (route === 'login') {
      if (req.method !== 'POST') return methodNotAllowed(res)
      return res.status(200).json({ success: true, ...login(req.body || {}) })
    }
    if (route === 'me') {
      if (req.method !== 'GET') return methodNotAllowed(res)
      const session = currentSession(req)
      if (!session) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
      return res.status(200).json({ me: describeMe(session) })
    }
    if (route === 'employees') return employeesHandler(req, res)
    if (route === 'onboarding') return onboardingHandler(req, res)
    return res.status(404).json({ error: 'Unknown route.' })
  } catch (error) {
    return fail(res, error, 'Birthday API error')
  }
}
