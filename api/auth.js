import { clean, jsonError } from './_lib/db.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const body = req.body || {}
    const expectedPin = clean(process.env.FINANCE_APP_PIN || process.env.CLAIMS_APP_PIN)
    const pin = clean(body.pin)
    if (!expectedPin) return res.status(500).json({ error: 'FINANCE_APP_PIN is not configured.' })
    if (!pin || pin !== expectedPin) return res.status(401).json({ error: 'Incorrect PIN.' })
    const name = clean(body.name)
    const role = clean(body.role || 'Employee')
    const roles = ['Admin', 'Supervisor', 'Payroll', 'Employee']
    if (!name) return res.status(400).json({ error: 'Name is required.' })
    if (!roles.includes(role)) return res.status(400).json({ error: 'Invalid role.' })
    return res.status(200).json({ success: true, user: { name, role, signedInAt: new Date().toISOString() } })
  } catch (error) {
    return jsonError(res, error)
  }
}
