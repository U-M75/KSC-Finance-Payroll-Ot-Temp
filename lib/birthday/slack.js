// Slack Web API helpers. Uses the existing KSC bot token from the environment.
// Nothing here creates a new Slack app or auth flow.
import crypto from 'node:crypto'
import { env, HttpError, requireEnv } from './env.js'

export async function slack(method, body = {}) {
  requireEnv('SLACK_BOT_TOKEN')
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('SLACK_BOT_TOKEN')}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({ ok: false, error: 'invalid_json' }))
  if (!data.ok) {
    const error = new Error(`Slack ${method} failed: ${data.error}`)
    error.slackError = data.error
    throw error
  }
  return data
}

// ---- Request verification -------------------------------------------------

export async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

// Slack v0 signature: HMAC-SHA256 of "v0:{timestamp}:{raw body}".
export function verifySlackRequest(rawBody, headers, now = Date.now()) {
  const secret = env('SLACK_SIGNING_SECRET')
  if (!secret) return false
  const timestamp = String(headers['x-slack-request-timestamp'] || '')
  const signature = String(headers['x-slack-signature'] || '')
  if (!timestamp || !signature) return false
  if (Math.abs(now / 1000 - Number(timestamp)) > 60 * 5) return false
  const expected = 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ---- Users ----------------------------------------------------------------

// Some Slack methods do not read a JSON body. They answer invalid_arguments or user_not_found even
// though the values are correct. These helpers send the same parameters another way.
async function slackRequest(method, url, init) {
  requireEnv('SLACK_BOT_TOKEN')
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${env('SLACK_BOT_TOKEN')}`, ...(init.headers || {}) },
  })
  const data = await response.json().catch(() => ({ ok: false, error: 'invalid_json' }))
  if (!data.ok) {
    const error = new Error(`Slack ${method} failed: ${data.error}`)
    error.slackError = data.error
    throw error
  }
  return data
}

// GET with query string (read methods such as conversations.members and users.info).
export function slackGet(method, params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  }
  return slackRequest(method, `https://slack.com/api/${method}?${query.toString()}`, { method: 'GET' })
}

// POST with form-encoded body (methods such as conversations.open).
export function slackForm(method, params = {}) {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') body.set(key, String(value))
  }
  return slackRequest(method, `https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

export async function getSlackUser(userId) {
  const { user } = await slackGet('users.info', { user: userId })
  return user
}


export function profileFor(user) {
  return {
    slack_username: user.profile?.display_name || user.name || null,
    full_name: user.profile?.real_name || user.real_name || user.name || 'Unknown',
    email: user.profile?.email ? String(user.profile.email).toLowerCase() : null,
  }
}

let usersCache = { at: 0, users: [] }

// Workspace user list, cached for 5 minutes, used by the admin Slack search.
export async function workspaceUsers() {
  if (Date.now() - usersCache.at < 5 * 60 * 1000 && usersCache.users.length) return usersCache.users
  const users = []
  let cursor = ''
  do {
    const page = await slack('users.list', { limit: 200, cursor: cursor || undefined })
    for (const user of page.members || []) {
      if (user.deleted || user.is_bot || user.id === 'USLACKBOT') continue
      users.push(user)
    }
    cursor = page.response_metadata?.next_cursor || ''
  } while (cursor)
  usersCache = { at: Date.now(), users }
  return users
}

// ---- Channels and messages -----------------------------------------------

export async function channelHasMember(channel, userId) {
  let cursor = ''
  do {
    const page = await slackGet('conversations.members', { channel, limit: 1000, cursor })
    if ((page.members || []).includes(userId)) return true
    cursor = page.response_metadata?.next_cursor || ''
  } while (cursor)
  return false
}

function botIdentity() {
  // Needs the chat:write.customize scope. Without it Slack ignores these fields and uses the app name.
  const username = env('SLACK_BOT_DISPLAY_NAME')
  return username ? { username } : {}
}

export async function sendDm(userId, text, blocks) {
  const { channel } = await slackForm('conversations.open', { users: userId })
  const message = await slack('chat.postMessage', { channel: channel.id, text, blocks, unfurl_links: false, ...botIdentity() })
  return { channel: message.channel, ts: message.ts }
}

export async function postToChannel(channel, text, blocks) {
  const message = await slack('chat.postMessage', { channel, text, blocks, unfurl_links: false, ...botIdentity() })
  return { channel: message.channel, ts: message.ts }
}

export async function openModal(triggerId, view) {
  return slack('views.open', { trigger_id: triggerId, view })
}

export async function respondToAction(responseUrl, body) {
  if (!responseUrl) return
  await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function assertSlackRequest(condition, message = 'Bad Slack request') {
  if (!condition) throw new HttpError(400, message)
}
