// Signed links for the onboarding web form. The Slack DM button opens /onboard?t=<token>.
// The token is an HMAC of the employee id with HQ_SESSION_SECRET, and it expires after LINK_DAYS.
import crypto from 'node:crypto'
import { env, HttpError } from './env.js'

const LINK_DAYS = 7
const PURPOSE = 'onboard'

function secret() {
  const value = env('HQ_SESSION_SECRET')
  if (!value) throw new HttpError(500, 'HQ_SESSION_SECRET is not configured in Vercel.')
  return value
}

function sign(body) {
  return crypto.createHmac('sha256', secret()).update(`${PURPOSE}.${body}`).digest('base64url')
}

export function signOnboardToken(employeeId, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ k: PURPOSE, eid: employeeId, exp: now + LINK_DAYS * 86400000 })).toString('base64url')
  return `${body}.${sign(body)}`
}

// Returns the employee id if the token is genuine and not expired. Otherwise throws.
export function verifyOnboardToken(token) {
  const [body, sig] = String(token || '').split('.')
  if (!body || !sig) throw new HttpError(401, 'This form link is not valid. Please ask HR for a new link.')
  const a = Buffer.from(sig)
  const b = Buffer.from(sign(body))
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, 'This form link is not valid. Please ask HR for a new link.')
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  if (payload.k !== PURPOSE || !payload.eid) throw new HttpError(401, 'This form link is not valid. Please ask HR for a new link.')
  if (!payload.exp || payload.exp < Date.now()) {
    throw new HttpError(401, 'This form link has expired. Please ask HR for a new link.')
  }
  return payload.eid
}

// Full link for the DM button. APP_BASE_URL is optional; Vercel's production domain is used otherwise.
export function onboardLinkUrl(employeeId) {
  const host = env('VERCEL_PROJECT_PRODUCTION_URL')
  const base = env('APP_BASE_URL') || (host ? `https://${host}` : '')
  if (!base) throw new HttpError(500, 'Set APP_BASE_URL in Vercel (the site address, for example https://your-site.vercel.app).')
  return `${base.replace(/\/$/, '')}/onboard?t=${signOnboardToken(employeeId)}`
}
