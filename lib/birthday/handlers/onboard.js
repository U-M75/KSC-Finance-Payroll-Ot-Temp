// Public onboarding form. Access is only through the signed link in the Slack DM (see onboard-link.js).
// GET  ?route=onboard&t=TOKEN  -> the employee's own form values
// POST ?route=onboard          -> body { t, full_name, email, employee_type, joining_date, birthday, anniversary, ... }
import { env, clean, HttpError, methodNotAllowed, fail } from '../env.js'
import { verifyOnboardToken } from '../onboard-link.js'
import { applyOnboardingSubmission, getEmployee, notifyJoiningDateApprover, validDate } from '../employees.js'
import { sendDm } from '../slack.js'
import { notifyHrOfSubmission } from '../monthly.js'
import { ONBOARDING_COPY, EMPLOYEE_TYPES, ANNOUNCEMENT_OPTIONS } from '../onboarding-config.js'

const VIEW_FIELDS = [
  'full_name', 'email', 'employee_type', 'joining_date', 'birthday', 'anniversary',
  'birthday_locked', 'anniversary_locked', 'favorite_slime', 'favorite_color', 'favorite_snack',
  'celebration_notes', 'announcement_preference', 'joining_date_pending_approval', 'form_submitted', 'status',
]
const INPUT_FIELDS = [
  'full_name', 'email', 'employee_type', 'joining_date', 'birthday', 'anniversary',
  'favorite_slime', 'favorite_color', 'favorite_snack', 'celebration_notes', 'announcement_preference',
]

function viewOf(employee) {
  const view = {}
  for (const key of VIEW_FIELDS) view[key] = employee[key] ?? null
  return view
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const employee = await getEmployee(verifyOnboardToken(req.query?.t))
      if (employee.status !== 'active') throw new HttpError(409, 'Your onboarding record is closed. Please contact HR.')
      return res.status(200).json({ employee: viewOf(employee) })
    }
    if (req.method !== 'POST') return methodNotAllowed(res)

    const body = req.body || {}
    const employee = await getEmployee(verifyOnboardToken(body.t))

    const values = {}
    for (const key of INPUT_FIELDS) {
      if (body[key] !== undefined) values[key] = typeof body[key] === 'string' ? body[key].trim() : body[key]
    }

    // Same required fields as the Slack form.
    if (!values.full_name) throw new HttpError(400, 'Please enter your full name.')
    if (!EMPLOYEE_TYPES.includes(values.employee_type)) throw new HttpError(400, 'Please choose an employee type.')
    if (!ANNOUNCEMENT_OPTIONS.some((o) => o.value === values.announcement_preference)) {
      throw new HttpError(400, 'Please choose how we should celebrate you.')
    }
    for (const field of ['joining_date', 'birthday', 'anniversary']) {
      if (values[field]) validDate(values[field])
    }

    const { employee: saved, joiningDateChange, ignoredLocked } = await applyOnboardingSubmission(employee, values)
    await notifyHrOfSubmission(saved).catch((error) => console.error('HR alert failed', error))
    if (joiningDateChange) {
      await notifyJoiningDateApprover(saved).catch((error) => console.error('Approver DM failed', error))
    }

    let note = ONBOARDING_COPY.submittedDm
    if (joiningDateChange) note += '\nYour joining date change has been sent to HR for approval.'
    if (ignoredLocked.length) note += '\nBirthday or anniversary was already submitted, so it was not changed. Contact HR for updates.'
    await sendDm(saved.slack_user_id, note).catch((error) => console.error('Confirmation DM failed', error))

    return res.status(200).json({
      success: true,
      message: 'Thank you! Your details are saved.',
      joiningDateChange: Boolean(joiningDateChange),
      ignoredLocked,
    })
  } catch (error) {
    return fail(res, error, 'Onboarding form error')
  }
}
