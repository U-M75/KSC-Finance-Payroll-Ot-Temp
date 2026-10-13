// Birthday & Anniversary sign-in. Same username/password env accounts as Finance,
// plus IT_* for the IT account. Finance Supervisors are refused.
import { clean, HttpError } from './env.js'
import { signSession } from './auth.js'

const ACCOUNTS = [
  ['BLAKELI', 'Blakeli'], ['CARLA', 'Carla'], ['CHARLES', 'Charles'], ['CHRIS', 'Chris'],
  ['JUNAID', 'Junaid'], ['ROXY', 'Roxy'], ['SANDRA', 'Sandra'],
  ['PAYROLL', 'Payroll'], ['HUMAN_RESOURCES', 'Human Resources'], ['IT', 'IT'],
]

// Finance role (or IT_ROLE) -> Birthday role
const BIRTHDAY_ROLE = { Admin: 'super_admin', IT: 'it_admin', HR: 'hr_admin', Payroll: 'payroll' }

export function login(body = {}) {
  const username = clean(body.username).toLowerCase()
  const password = clean(body.password)
  if (!username || !password) throw new HttpError(400, 'Username and password are required.')

  const match = ACCOUNTS.find(([prefix]) => clean(process.env[`${prefix}_USERNAME`]).toLowerCase() === username)
  if (!match) throw new HttpError(401, 'Incorrect username or password.')
  const [prefix, defaultName] = match
  const expected = clean(process.env[`${prefix}_PASSWORD`])
  const financeRole = clean(process.env[`${prefix}_ROLE`])
  if (!expected || !financeRole) throw new HttpError(500, `${prefix}_PASSWORD and ${prefix}_ROLE are not configured in Vercel.`)
  if (password !== expected) throw new HttpError(401, 'Incorrect username or password.')

  const role = BIRTHDAY_ROLE[financeRole]
  if (!role) throw new HttpError(403, 'This account does not have access to Birthday & Anniversary.')
  const name = clean(process.env[`${prefix}_NAME`]) || defaultName
  const user = { username, name, role }
  return { token: signSession(user), user: { name, role } }
}
