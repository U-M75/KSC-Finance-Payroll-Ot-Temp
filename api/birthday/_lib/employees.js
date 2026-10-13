// Employee domain rules. Every write path (Slack form, admin UI, cron) goes
// through this file so the business rules live in one place:
//  - birthday/anniversary lock after the employee's first submission
//  - joining date changes from the employee need HR approval
//  - only status = 'active' employees receive forms or celebrations
import { db, must } from './supabase.js'
import { env, HttpError, clean } from './env.js'
import { getSlackUser, profileFor, sendDm, channelHasMember } from './slack.js'
import { ONBOARDING_COPY, EMPLOYEE_STATUSES, EMPLOYEE_TYPES, ANNOUNCEMENT_OPTIONS } from './onboarding-config.js'
import { onboardingInvite, joiningDateApprovalRequest } from './slack-blocks.js'
import { can } from './permissions.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const SELF_EDITABLE = ['full_name', 'email', 'employee_type', 'favorite_slime', 'favorite_color', 'favorite_snack', 'celebration_notes', 'announcement_preference']
const STAFF_EDITABLE = [...SELF_EDITABLE, 'slack_username', 'birthday', 'anniversary']

export function validDate(value) {
  if (!value) return null
  if (!DATE_RE.test(value)) throw new HttpError(400, `Date "${value}" must be in YYYY-MM-DD format.`)
  const [y, m, d] = value.split('-').map(Number)
  const check = new Date(Date.UTC(y, m - 1, d))
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) throw new HttpError(400, `"${value}" is not a real date.`)
  return value
}

export async function getEmployee(id) {
  const row = must(await db().from('ksc_employees').select('*').eq('id', id).maybeSingle(), 'Could not load employee')
  if (!row) throw new HttpError(404, 'Employee not found.')
  return row
}

export async function audit(actor, action, entityId, details = {}) {
  try {
    await db().from('ksc_hub_audit_log').insert({
      actor_email: actor || 'system',
      action,
      entity: 'ksc_employees',
      entity_id: entityId,
      details,
    })
  } catch (error) {
    console.error('Audit log write failed', error)
  }
}

// Returns the existing employee for a Slack user, or creates one from Slack profile data.
export async function findOrCreateBySlackUser(slackUserId) {
  const existing = must(
    await db().from('ksc_employees').select('*').eq('slack_user_id', slackUserId).maybeSingle(),
    'Could not look up employee',
  )
  if (existing) return existing

  const user = await getSlackUser(slackUserId)
  if (user.is_bot) throw new HttpError(400, 'Bots cannot be onboarded.')
  const row = must(
    await db()
      .from('ksc_employees')
      .insert({ slack_user_id: slackUserId, ...profileFor(user), status: 'active' })
      .select('*')
      .single(),
    'Could not create employee',
  )
  await audit('system', 'employee.created_from_slack', row.id, { slack_user_id: slackUserId })
  return row
}

// Sends the onboarding DM. `requireChatRoom` enforces the rule that the form is
// only sent to members of #ksc-chat-room.
export async function dispatchOnboardingForm(employee, { source, actor = 'system', requireChatRoom = true }) {
  if (employee.status !== 'active') {
    return { sent: false, reason: `${employee.full_name} is ${employee.status}, so the form was not sent.` }
  }
  const chatRoom = env('SLACK_CHANNEL_KSC_CHAT_ROOM')
  if (requireChatRoom) {
    if (!chatRoom) throw new HttpError(500, 'Missing environment variables: SLACK_CHANNEL_KSC_CHAT_ROOM')
    const isMember = await channelHasMember(chatRoom, employee.slack_user_id)
    if (!isMember) {
      return { sent: false, reason: `${employee.full_name} is not in #ksc-chat-room, so the form was not sent.` }
    }
  }
  const dm = await sendDm(employee.slack_user_id, ONBOARDING_COPY.dmFallbackText, onboardingInvite(employee))
  must(
    await db().from('ksc_onboarding_dispatches').insert({
      employee_id: employee.id,
      source,
      actor_email: actor,
      slack_channel_id: dm.channel,
      slack_message_ts: dm.ts,
    }),
    'Could not log onboarding dispatch',
  )
  return { sent: true }
}

// Applies a submitted Slack form. Returns { employee, joiningDateChange, ignoredLocked }.
export async function applyOnboardingSubmission(employee, values) {
  if (employee.status !== 'active') throw new HttpError(409, 'Your onboarding record is closed. Please contact HR.')

  const patch = {}
  for (const key of SELF_EDITABLE) {
    if (values[key] === undefined) continue
    patch[key] = clean(values[key]) || null
  }
  if (patch.employee_type && !EMPLOYEE_TYPES.includes(patch.employee_type)) throw new HttpError(400, 'Choose a valid employee type.')
  if (patch.announcement_preference && !ANNOUNCEMENT_OPTIONS.some((o) => o.value === patch.announcement_preference)) {
    throw new HttpError(400, 'Choose a valid celebration preference.')
  }
  if (!patch.announcement_preference) patch.announcement_preference = employee.announcement_preference || 'public'

  const ignoredLocked = []
  for (const field of ['birthday', 'anniversary']) {
    if (values[field] === undefined || values[field] === null) continue
    const value = validDate(values[field])
    if (employee[`${field}_locked`]) {
      if (value !== employee[field]) ignoredLocked.push(field)
      continue
    }
    patch[field] = value
    patch[`${field}_locked`] = true // one-time submission
  }

  let joiningDateChange = null
  if (values.joining_date) {
    const submitted = validDate(values.joining_date)
    if (submitted !== employee.joining_date) {
      // HR-owned field: never overwrite the live value from the employee form.
      patch.joining_date_pending_approval = true
      patch.suggested_joining_date = submitted
      joiningDateChange = submitted
    }
  }

  patch.form_submitted = true
  patch.form_submitted_at = new Date().toISOString()

  const updated = must(
    await db().from('ksc_employees').update(patch).eq('id', employee.id).select('*').single(),
    'Could not save onboarding form',
  )
  await audit(updated.email || employee.slack_user_id, 'employee.form_submitted', employee.id, {
    fields: Object.keys(patch),
    joining_date_requested: joiningDateChange,
    ignored_locked: ignoredLocked,
  })
  return { employee: updated, joiningDateChange, ignoredLocked }
}

// Tells the HR approver about a pending joining date change.
export async function notifyJoiningDateApprover(employee) {
  const approver = env('SLACK_HR_APPROVER_USER_ID')
  if (!approver) {
    console.warn('SLACK_HR_APPROVER_USER_ID is not set, joining date approval DM skipped.')
    return { sent: false }
  }
  await sendDm(approver, `Joining date change requested for ${employee.full_name}`, joiningDateApprovalRequest(employee, employee.full_name))
  return { sent: true }
}

// Approve or reject a pending joining date change. Used by the Slack buttons and the admin UI.
export async function decideJoiningDate(employeeId, decision, actor) {
  const employee = await getEmployee(employeeId)
  if (!employee.joining_date_pending_approval) throw new HttpError(409, 'There is no pending joining date change.')
  const patch =
    decision === 'approve'
      ? { joining_date: employee.suggested_joining_date, joining_date_pending_approval: false, suggested_joining_date: null }
      : { joining_date_pending_approval: false, suggested_joining_date: null }
  const updated = must(await db().from('ksc_employees').update(patch).eq('id', employeeId).select('*').single(), 'Could not update joining date')
  await audit(actor, `joining_date.${decision}d`, employeeId, { previous: employee.joining_date, suggested: employee.suggested_joining_date })
  return updated
}

// Admin/HR edit. Validates scope and per-field permissions.
export async function updateEmployeeAsStaff(staff, employeeId, body) {
  const existing = await getEmployee(employeeId)
  if (staff.role === 'disney_lead' && existing.employee_type !== 'Disney') {
    throw new HttpError(403, 'Disney Lead can only manage Disney employees.')
  }

  const patch = {}
  for (const key of STAFF_EDITABLE) {
    if (!(key in body)) continue
    patch[key] = clean(body[key]) || null
  }
  if (patch.birthday !== undefined) patch.birthday = validDate(patch.birthday)
  if (patch.anniversary !== undefined) patch.anniversary = validDate(patch.anniversary)
  if (patch.employee_type && !EMPLOYEE_TYPES.includes(patch.employee_type)) throw new HttpError(400, 'Choose a valid employee type.')
  if (staff.role === 'disney_lead' && patch.employee_type && patch.employee_type !== 'Disney') {
    throw new HttpError(403, 'Disney Lead cannot move employees out of Disney.')
  }

  if ('joining_date' in body) {
    if (!can(staff.role, 'joining_date:set')) throw new HttpError(403, 'Only HR can set the joining date.')
    patch.joining_date = validDate(body.joining_date)
    patch.joining_date_pending_approval = false
    patch.suggested_joining_date = null
  }

  for (const field of ['birthday_locked', 'anniversary_locked']) {
    if (!(field in body)) continue
    if (!can(staff.role, 'employees:unlock')) throw new HttpError(403, 'Only HR can unlock birthday or anniversary fields.')
    patch[field] = Boolean(body[field])
  }

  if ('status' in body) {
    if (!can(staff.role, 'employees:disable')) throw new HttpError(403, 'You cannot change employee status.')
    if (!EMPLOYEE_STATUSES.includes(body.status)) throw new HttpError(400, 'Invalid status.')
    if (body.status !== existing.status) {
      patch.status = body.status
      patch.status_changed_at = new Date().toISOString()
      patch.offboarded_at = body.status === 'active' ? null : patch.status_changed_at
    }
  }

  if (!Object.keys(patch).length) return existing
  const updated = must(await db().from('ksc_employees').update(patch).eq('id', employeeId).select('*').single(), 'Could not update employee')
  await audit(staff.email, 'employee.updated', employeeId, { fields: Object.keys(patch) })
  return updated
}

// Claims a celebration so a cron retry never sends the same message twice.
// Returns false if it was already sent.
export async function claimCelebration(employeeId, kind, occurrenceDate, destination) {
  const { error } = await db()
    .from('ksc_celebration_log')
    .insert({ employee_id: employeeId, kind, occurrence_date: occurrenceDate, destination })
  if (error && error.code === '23505') return false
  if (error) throw new Error(`Could not claim celebration: ${error.message}`)
  return true
}

export async function releaseCelebrationClaim(employeeId, kind, occurrenceDate, destination) {
  await db()
    .from('ksc_celebration_log')
    .delete()
    .match({ employee_id: employeeId, kind, occurrence_date: occurrenceDate, destination })
}

// Eligible employees only (status = 'active'), via the ksc_eligible_employees view.
export async function loadEligibleEmployees({ withDates = false } = {}) {
  let query = db().from('ksc_eligible_employees').select('*')
  if (withDates) query = query.or('birthday.not.is.null,anniversary.not.is.null')
  return must(await query, 'Could not load employees')
}
