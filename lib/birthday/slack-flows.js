// Slack event, button and modal handlers for the onboarding module.
import { db, must } from './supabase.js'
import { env, HttpError } from './env.js'
import { can } from './permissions.js'
import { getSlackUser, openModal, respondToAction, sendDm } from './slack.js'
import {
  applyOnboardingSubmission,
  dispatchOnboardingForm,
  decideJoiningDate,
  findOrCreateBySlackUser,
  getEmployee,
  notifyJoiningDateApprover,
  audit,
  validDate,
} from './employees.js'
import { onboardingModal, parseModalValues } from './slack-blocks.js'
import { notifyHrOfSubmission } from './monthly.js'
import { ONBOARDING_COPY } from './onboarding-config.js'

// member_joined_channel for #ksc-chat-room -> send the onboarding DM.
export async function handleMemberJoined(event) {
  if (event.channel !== env('SLACK_CHANNEL_KSC_CHAT_ROOM')) return { skipped: 'other_channel' }
  const user = await getSlackUser(event.user)
  if (user.is_bot) return { skipped: 'bot' }
  const employee = await findOrCreateBySlackUser(event.user)
  // The event itself proves membership, so skip the extra members lookup.
  return dispatchOnboardingForm(employee, { source: 'slack_join', requireChatRoom: false })
}

// Employee clicked "Fill in my details" in the DM. Opens the modal with a fresh trigger_id.
export async function handleOpenForm(payload, action) {
  const employee = await findOrCreateBySlackUser(payload.user.id)
  if (employee.status !== 'active') {
    await respondToAction(payload.response_url, {
      replace_original: false,
      response_type: 'ephemeral',
      text: 'Your onboarding record is closed. Please contact HR.',
    })
    return
  }
  // Use the employee id from the record, not the button value, to avoid edits to someone else's record.
  await openModal(payload.trigger_id, onboardingModal(employee))
  return { employeeId: employee.id, action: action.action_id }
}

// Modal submitted. Returns the Slack response body (validation errors or clear).
export async function handleFormSubmission(payload) {
  const { employee_id: employeeId } = JSON.parse(payload.view.private_metadata || '{}')
  const values = parseModalValues(payload.view.state.values)

  const errors = {}
  if (!values.full_name) errors.full_name = 'Please enter your full name.'
  if (!values.employee_type) errors.employee_type = 'Please choose an employee type.'
  if (!values.announcement_preference) errors.announcement_preference = 'Please choose how we should celebrate you.'
  for (const field of ['joining_date', 'birthday', 'anniversary']) {
    if (values[field]) {
      try {
        validDate(values[field])
      } catch {
        errors[field] = 'Please pick a valid date.'
      }
    }
  }
  if (Object.keys(errors).length) return { response_action: 'errors', errors }

  const employee = await getEmployee(employeeId)
  if (employee.slack_user_id !== payload.user.id) throw new HttpError(403, 'This form belongs to another employee.')

  const { employee: saved, joiningDateChange, ignoredLocked } = await applyOnboardingSubmission(employee, values)
  await notifyHrOfSubmission(saved).catch((error) => console.error('HR alert failed', error))

  if (joiningDateChange) {
    await notifyJoiningDateApprover(saved).catch((error) => console.error('Approver DM failed', error))
  }

  let note = ONBOARDING_COPY.submittedDm
  if (joiningDateChange) note += '\nYour joining date change has been sent to HR for approval.'
  if (ignoredLocked.length) note += `\nBirthday or anniversary was already submitted, so it was not changed. Contact HR for updates.`
  await sendDm(payload.user.id, note).catch((error) => console.error('Confirmation DM failed', error))

  // Returning { response_action: 'clear' } closes the modal.
  return { response_action: 'clear' }
}

// HR approve / keep original buttons on the approval DM.
export async function handleJoiningDateAction(payload, action) {
  const clicker = payload.user.id
  const approverEnv = env('SLACK_HR_APPROVER_USER_ID')
  let allowed = Boolean(approverEnv && approverEnv === clicker)
  if (!allowed) {
    const staff = must(
      await db().from('ksc_hub_staff').select('role, active').eq('slack_user_id', clicker).maybeSingle(),
      'Could not verify approver',
    )
    allowed = Boolean(staff?.active && can(staff.role, 'joining_date:approve'))
  }
  if (!allowed) {
    await respondToAction(payload.response_url, { replace_original: false, response_type: 'ephemeral', text: 'Only HR can approve joining date changes.' })
    return
  }

  const decision = action.action_id === 'approve_joining_date' ? 'approve' : 'reject'
  let employee
  try {
    employee = await decideJoiningDate(action.value, decision, `slack:${clicker}`)
  } catch (error) {
    await respondToAction(payload.response_url, { replace_original: false, response_type: 'ephemeral', text: error.message })
    return
  }
  await respondToAction(payload.response_url, {
    replace_original: true,
    text: decision === 'approve' ? `✅ Joining date approved for ${employee.full_name}.` : `↩️ Kept the original joining date for ${employee.full_name}.`,
  })
  const employeeMessage = decision === 'approve' ? ONBOARDING_COPY.approvedDm : ONBOARDING_COPY.rejectedDm
  await sendDm(employee.slack_user_id, employeeMessage).catch((error) => console.error('Employee DM failed', error))
  await audit(`slack:${clicker}`, `joining_date.slack_${decision}`, employee.id)
}

