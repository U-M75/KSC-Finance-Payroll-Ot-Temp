import { clean, jsonError } from '../lib/finance/db.js'

const ACCOUNT_DEFINITIONS = [
  ['BLAKELI', 'Blakeli'],
  ['CARLA', 'Carla'],
  ['CHARLES', 'Charles'],
  ['CHRIS', 'Chris'],
  ['JUNAID', 'Junaid'],
  ['ROXY', 'Roxy'],
  ['SANDRA', 'Sandra'],
  ['PAYROLL', 'Payroll'],
  ['HUMAN_RESOURCES', 'Human Resources'],
]

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const username = clean(req.body?.username || req.body?.name).toLowerCase()
    const password = clean(req.body?.password || req.body?.pin)
    const selectedRole = clean(req.body?.role)
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' })

    const definition = ACCOUNT_DEFINITIONS.find(([prefix]) => clean(process.env[`${prefix}_USERNAME`]).toLowerCase() === username)
    if (!definition) return res.status(401).json({ error: 'Incorrect username or password.' })
    const [prefix, defaultName] = definition
    const displayName = clean(process.env[`${prefix}_NAME`]) || defaultName
    const expectedPassword = clean(process.env[`${prefix}_PASSWORD`])
    const role = clean(process.env[`${prefix}_ROLE`])
    if (!expectedPassword || !role) return res.status(500).json({ error: `${prefix}_PASSWORD and ${prefix}_ROLE are not configured in Vercel.` })
    if (password !== expectedPassword) return res.status(401).json({ error: 'Incorrect username or password.' })
    if (selectedRole && selectedRole !== role) return res.status(403).json({ error: 'The selected role does not match this account.' })

    return res.status(200).json({ success: true, user: { username, name: displayName, role, signedInAt: new Date().toISOString() } })
  } catch (error) {
    return jsonError(res, error)
  }
}
