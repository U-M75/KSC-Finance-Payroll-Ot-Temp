import { clean, jsonError } from './_lib/db.js'

// Kawaii HQ: Birthday & Anniversary sign-in.
// Uses the SAME username/password env accounts as Finance (Admin, HR, Payroll), plus IT_*.
// Finance Supervisors do not get Birthday access.
const ACCOUNTS = [
  ['BLAKELI', 'Blakeli'],
  ['CARLA', 'Carla'],
  ['CHARLES', 'Charles'],
  ['CHRIS', 'Chris'],
  ['JUNAID', 'Junaid'],
  ['ROXY', 'Roxy'],
  ['SANDRA', 'Sandra'],
  ['PAYROLL', 'Payroll'],
  ['HUMAN_RESOURCES', 'Human Resources'],
  ['IT', 'IT'],
]

// Maps the finance role (or IT_ROLE) to a Birthday role. Anything else is refused.
const BIRTHDAY_ROLE = { Admin: 'Admin', HR: 'HR', Payroll: 'Payroll', IT: 'IT' }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const username = clean(req.body?.username).toLowerCase()
    const password = clean(req.body?.password)
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' })

    const match = ACCOUNTS.find(([prefix]) => clean(process.env[`${prefix}_USERNAME`]).toLowerCase() === username)
    if (!match) return res.status(401).json({ error: 'Incorrect username or password.' })
    const [prefix, defaultName] = match
    const expectedPassword = clean(process.env[`${prefix}_PASSWORD`])
    const financeRole = clean(process.env[`${prefix}_ROLE`])
    if (!expectedPassword || !financeRole) return res.status(500).json({ error: `${prefix}_PASSWORD and ${prefix}_ROLE are not configured in Vercel.` })
    if (password !== expectedPassword) return res.status(401).json({ error: 'Incorrect username or password.' })

    const role = BIRTHDAY_ROLE[financeRole]
    if (!role) return res.status(403).json({ error: 'This account does not have access to Birthday & Anniversary.' })
    const name = clean(process.env[`${prefix}_NAME`]) || defaultName
    return res.status(200).json({ success: true, user: { username, name, role, signedInAt: new Date().toISOString() } })
  } catch (error) {
    return jsonError(res, error)
  }
}
