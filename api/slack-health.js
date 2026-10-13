import { clean } from '../lib/finance/db.js'

// Diagnostic endpoint: open /api/slack-health in the browser to see why image
// uploads may fail (token, channel, files:write scope). Never returns secrets.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const token = clean(process.env.SLACK_BOT_TOKEN)
    const channel = clean(process.env.SLACK_FINANCE_PAYROLL_CHANNEL_ID)
    const result = {
      token_present: Boolean(token),
      channel_set: Boolean(channel),
      auth_ok: false,
      auth_error: null,
      files_scope_ok: false,
      files_probe_error: null,
      hint: '',
    }
    if (!token) {
      result.hint = 'Set SLACK_BOT_TOKEN in Vercel environment variables.'
      return res.status(200).json(result)
    }
    try {
      const auth = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      }).then(r => r.json())
      result.auth_ok = Boolean(auth.ok)
      result.auth_error = auth.error || null
    } catch (error) {
      result.auth_error = error.message
    }
    try {
      // Slack's upload methods only parse URL-encoded form bodies (not JSON).
      const probe = await fetch('https://slack.com/api/files.getUploadURLExternal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
        body: new URLSearchParams({ filename: 'health-check.txt', length: '11' }).toString(),
      }).then(r => r.json())
      result.files_scope_ok = Boolean(probe.ok)
      const messages = probe.response_metadata?.messages || []
      result.files_probe_error = probe.ok ? null : `${probe.error || 'unknown_error'}${messages.length ? ` — ${messages.join('; ')}` : ''}`
    } catch (error) {
      result.files_probe_error = error.message
    }
    if (!result.auth_ok) {
      result.hint = 'Bot token is invalid — copy the current Bot User OAuth Token from the Slack app into Vercel SLACK_BOT_TOKEN.'
    } else if (!result.files_scope_ok && String(result.files_probe_error).includes('missing_scope')) {
      result.hint = 'files:write scope is missing on the token — add files:write in Slack app OAuth & Permissions, REINSTALL the app to the workspace, then update SLACK_BOT_TOKEN in Vercel if a new token was issued.'
    } else if (!result.files_scope_ok) {
      result.hint = `Slack upload probe failed (${result.files_probe_error}). Send this JSON to support.`
    } else if (!result.channel_set) {
      result.hint = 'Set SLACK_FINANCE_PAYROLL_CHANNEL_ID in Vercel environment variables.'
    } else {
      result.hint = 'Slack looks good. Submit a timecard with an image — it should appear in the submission message thread.'
    }
    return res.status(200).json(result)
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
