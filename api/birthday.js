// Kawaii HQ: Birthday & Anniversary API. ONE serverless function (Vercel Hobby allows 12 per project),
// routed by ?route=
//   POST ?route=login               -> sign in (Finance-style env accounts)
//   GET  ?route=me                  -> current session
//   *    ?route=employees           -> employee records
//   *    ?route=onboarding          -> onboarding and upcoming celebrations
//   POST ?route=slack               -> Slack Events and interactivity (signed raw body)
//   GET  (no route)                 -> Vercel Cron: runs shoutouts then digest (Bearer CRON_SECRET)
import { login } from '../lib/birthday/login.js'
import { currentSession, describeMe } from '../lib/birthday/auth.js'
import { methodNotAllowed, fail, clean } from '../lib/birthday/env.js'
import { readRawBody } from '../lib/birthday/slack.js'
import employeesHandler from '../lib/birthday/handlers/employees.js'
import onboardHandler from '../lib/birthday/handlers/onboard.js'
import onboardingHandler from '../lib/birthday/handlers/onboarding.js'
import slackHandler from '../lib/birthday/handlers/slack-events.js'
import milestonesHandler from '../lib/birthday/handlers/milestones.js'
import digestHandler from '../lib/birthday/handlers/digest.js'
import { runMonthlySummary, runMonthlyReminder } from '../lib/birthday/monthly.js'
import { bearerToken, env } from '../lib/birthday/env.js'

// Monthly jobs must not stop the daily jobs if one of them fails.
async function safeJob(job) {
  try { return await job() } catch (error) { console.error('Monthly job failed', error); return { error: error.message } }
}

// Bodyless parsing so Slack's signature check sees the exact raw bytes. JSON is parsed below.
export const config = { api: { bodyParser: false } }

// Runs one cron handler against a fake response so both jobs can run from one endpoint.
function runCronJob(jobHandler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this },
      json(body) { resolve({ status: this.statusCode, body }); return this },
      setHeader() {},
      end() { resolve({ status: this.statusCode, body: null }) },
    }
    Promise.resolve(jobHandler(req, res)).catch((error) => resolve({ status: 500, body: { error: error.message } }))
  })
}

export default async function handler(req, res) {
  const route = clean(req.query?.route)
  try {
    if (route === 'slack') return slackHandler(req, res)
    if (!route) {
      // Cron entry point (no query string in vercel.json). Both jobs check CRON_SECRET themselves.
      if (req.method !== 'GET') return methodNotAllowed(res)
      if (!env('CRON_SECRET') || bearerToken(req) !== env('CRON_SECRET')) {
        return res.status(401).json({ error: 'Unauthorized' })
      }
      const first = await runCronJob(milestonesHandler, req)
      const second = await runCronJob(digestHandler, req)
      // Monthly jobs only act on the 1st of the month (checked inside each job).
      const summary = await safeJob(() => runMonthlySummary())
      const reminder = await safeJob(() => runMonthlyReminder())
      return res.status(first.status === 401 || second.status === 401 ? 401 : 200).json({
        milestones: first.body,
        digest: second.body,
        monthly_summary: summary,
        monthly_reminder: reminder,
      })
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
    if (route === 'onboard') return onboardHandler(req, res)
    if (route === 'employees') return employeesHandler(req, res)
    if (route === 'onboarding') return onboardingHandler(req, res)
    return res.status(404).json({ error: 'Unknown route.' })
  } catch (error) {
    return fail(res, error, 'Birthday API error')
  }
}
