// Kawaii HQ Birthday & Anniversary sessions.
// Login checks the Finance-style env accounts (see ../login.js). On success the server signs a
// short-lived token with HQ_SESSION_SECRET. Every protected route verifies it here.
import crypto from 'node:crypto'
import { env, bearerToken, HttpError } from './env.js'
import { can, permissionsFor, ROLE_LABELS } from './permissions.js'

const TOKEN_HOURS = 12

function secret() {
  const value = env('HQ_SESSION_SECRET')
  if (!value) throw new HttpError(500, 'HQ_SESSION_SECRET is not configured in Vercel.')
  return value
}

export function signSession(user) {
  const payload = { ...user, exp: Date.now() + TOKEN_HOURS * 3600 * 1000 }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

function readSession(token) {
  const [body, sig] = String(token || '').split('.')
  if (!body || !sig) return null
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  if (!payload.exp || payload.exp < Date.now()) return null
  return payload
}

export async function requireStaff(req, permission) {
  const session = readSession(bearerToken(req))
  if (!session) throw new HttpError(401, 'Your session has expired. Please sign in again.')
  if (!ROLE_LABELS[session.role]) throw new HttpError(403, 'This account does not have access.')
  if (permission && !can(session.role, permission)) throw new HttpError(403, 'You do not have permission to do this.')
  return {
    email: session.username,
    staff: { email: session.username, full_name: session.name, role: session.role, slack_user_id: null },
  }
}

export function describeMe(session) {
  return {
    name: session.name,
    role: session.role,
    role_label: ROLE_LABELS[session.role] || session.role,
    permissions: permissionsFor(session.role),
  }
}

export function currentSession(req) {
  return readSession(bearerToken(req))
}
