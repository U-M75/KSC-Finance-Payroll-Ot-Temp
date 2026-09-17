import { clean, jsonError } from './_lib/db.js'

const ROLE_ENV = {
  Admin: 'FINANCE_ADMIN_PASSWORD',
  Supervisor: 'FINANCE_SUPERVISOR_PASSWORD',
  Payroll: 'FINANCE_PAYROLL_PASSWORD',
  Employee: 'FINANCE_EMPLOYEE_PASSWORD',
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const body = req.body || {}
    const name = clean(body.name)
    const role = clean(body.role || 'Employee')
    const password = clean(body.password || body.pin)
    const roles = Object.keys(ROLE_ENV)
    if (!name) return res.status(400).json({ error: 'Name is required.' })
    if (!roles.includes(role)) return res.status(400).json({ error: 'Invalid role.' })
    const envName = ROLE_ENV[role]
    const expectedPassword = clean(process.env[envName])
    if (!expectedPassword) return res.status(500).json({ error: `${envName} is not configured in Vercel.` })
    if (!password || password !== expectedPassword) return res.status(401).json({ error: 'Incorrect password for the selected role.' })
    return res.status(200).json({ success: true, user: { name, role, signedInAt: new Date().toISOString() } })
  } catch (error) {
    return jsonError(res, error)
  }
}
