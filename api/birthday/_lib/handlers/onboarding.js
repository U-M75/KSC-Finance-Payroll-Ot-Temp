// Onboarding module actions for HR and Super Admins.
// GET  ?action=slack_search&q=...   Search Slack users by name, username or email
// GET  ?action=upcoming             Celebrations in the next N days (role-scoped)
// POST { action: 'add', slack_user_id, employee_type?, joining_date? }
// POST { action: 'trigger', id }    Send the onboarding DM now
// POST { action: 'retrigger', id, confirm: true }  Reset submission and resend
import { db, must } from '../supabase.js'
import { requireStaff } from '../auth.js'
import { clean, timezone, HttpError, methodNotAllowed, fail } from '../env.js'
import { isInRoleScope, projectForRole, can } from '../permissions.js'
import { workspaceUsers, profileFor } from '../slack.js'
import { todayIn, upcomingCelebrations } from '../celebrations.js'
import {
  audit,
  dispatchOnboardingForm,
  findOrCreateBySlackUser,
  getEmployee,
  loadEligibleEmployees,
  validDate,
} from '../employees.js'
import { EMPLOYEE_TYPES } from '../onboarding-config.js'

function searchable(user) {
  return [user.name, user.real_name, user.profile?.display_name, user.profile?.real_name, user.profile?.email]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

async function slackSearch(q) {
  const needle = clean(q).toLowerCase().replace(/^@/, '')
  if (needle.length < 2) return []
  const users = await workspaceUsers()
  return users
    .filter((user) => searchable(user).includes(needle))
    .slice(0, 15)
    .map((user) => ({
      slack_user_id: user.id,
      ...profileFor(user),
      avatar: user.profile?.image_48 || null,
    }))
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const action = clean(req.query?.action)

      if (action === 'slack_search') {
        await requireStaff(req, 'onboarding:trigger')
        return res.status(200).json({ results: await slackSearch(req.query?.q) })
      }

      if (action === 'upcoming') {
        const { staff } = await requireStaff(req, 'employees:read_prefs')
        const days = Math.min(Number(req.query?.days) || 7, 31)
        const today = todayIn(timezone())
        const employees = (await loadEligibleEmployees({ withDates: true })).filter((row) => isInRoleScope(staff.role, row))
        const items = upcomingCelebrations(employees, today, days).map((item) => ({
          employee_id: item.employee.id,
          kind: item.kind,
          occurrence_date: item.occurrenceDate,
          days_away: item.daysAway,
          years: item.years,
          ...projectForRole(staff.role, item.employee),
        }))
        return res.status(200).json({ today, days, items })
      }

      throw new HttpError(400, 'Unknown action.')
    }

    if (req.method !== 'POST') return methodNotAllowed(res)

    const { email, staff } = await requireStaff(req, 'onboarding:trigger')
    const body = req.body || {}
    const action = clean(body.action)

    if (action === 'add') {
      const slackUserId = clean(body.slack_user_id)
      if (!slackUserId) throw new HttpError(400, 'Pick a Slack user first.')
      const employee = await findOrCreateBySlackUser(slackUserId)

      const patch = {}
      if (body.employee_type) {
        if (!EMPLOYEE_TYPES.includes(body.employee_type)) throw new HttpError(400, 'Choose a valid employee type.')
        patch.employee_type = body.employee_type
      }
      if (body.joining_date) {
        if (!can(staff.role, 'joining_date:set')) throw new HttpError(403, 'Only HR can set the joining date.')
        patch.joining_date = validDate(body.joining_date)
      }
      let record = employee
      if (Object.keys(patch).length) {
        record = must(await db().from('ksc_employees').update(patch).eq('id', employee.id).select('*').single(), 'Could not save employee')
        await audit(email, 'employee.added_manually', employee.id, { fields: Object.keys(patch) })
      }
      const dispatch = await dispatchOnboardingForm(record, { source: 'manual_add', actor: email })
      return res.status(201).json({ success: true, employee: projectForRole(staff.role, record), dispatch })
    }

    if (action === 'trigger' || action === 'retrigger') {
      const id = clean(body.id)
      if (!id) throw new HttpError(400, 'Employee id is required.')
      if (action === 'retrigger' && body.confirm !== true) {
        throw new HttpError(400, 'Re-sending the form needs confirmation.')
      }
      let employee = await getEmployee(id)
      if (!isInRoleScope(staff.role, employee)) throw new HttpError(403, 'You can only manage Disney employees.')

      if (action === 'retrigger') {
        employee = must(
          await db().from('ksc_employees').update({ form_submitted: false, form_submitted_at: null }).eq('id', id).select('*').single(),
          'Could not reset form',
        )
        await audit(email, 'onboarding.retriggered', id)
      }
      const dispatch = await dispatchOnboardingForm(employee, { source: action === 'retrigger' ? 'manual_retrigger' : 'manual_trigger', actor: email })
      return res.status(200).json({ success: true, dispatch })
    }

    throw new HttpError(400, 'Unknown action.')
  } catch (error) {
    return fail(res, error, 'Onboarding API error')
  }
}
