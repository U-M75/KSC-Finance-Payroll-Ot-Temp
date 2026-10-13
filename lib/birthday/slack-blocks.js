// Block Kit builders. Copy lives in onboarding-config.js.
import { ANNOUNCEMENT_OPTIONS, CELEBRATION_COPY, EMPLOYEE_TYPES, ONBOARDING_COPY } from './onboarding-config.js'
import { formatDayLabel } from './celebrations.js'

const section = (text) => ({ type: 'section', text: { type: 'mrkdwn', text } })
const context = (text) => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] })

export function onboardingInvite(employee) {
  return [
    section(ONBOARDING_COPY.dmIntro(employee.slack_user_id)),
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          style: 'primary',
          action_id: 'open_onboarding_form',
          value: employee.id,
          text: { type: 'plain_text', text: ONBOARDING_COPY.buttonLabel, emoji: true },
        },
      ],
    },
    context(ONBOARDING_COPY.dmClosing),
  ]
}

function formatStoredDate(value) {
  if (!value) return ''
  const [y, m, d] = value.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

function textInput(blockId, label, initial, optional = true) {
  return {
    type: 'input',
    block_id: blockId,
    optional,
    label: { type: 'plain_text', text: label },
    element: {
      type: 'plain_text_input',
      action_id: 'value',
      ...(initial ? { initial_value: String(initial) } : {}),
    },
  }
}

function textAreaInput(blockId, label, initial) {
  return {
    type: 'input',
    block_id: blockId,
    optional: true,
    label: { type: 'plain_text', text: label },
    element: {
      type: 'plain_text_input',
      multiline: true,
      action_id: 'value',
      ...(initial ? { initial_value: String(initial) } : {}),
    },
  }
}

function dateInput(blockId, label, initial, hint) {
  return {
    type: 'input',
    block_id: blockId,
    optional: true,
    label: { type: 'plain_text', text: label },
    ...(hint ? { hint: { type: 'plain_text', text: hint } } : {}),
    element: {
      type: 'datepicker',
      action_id: 'value',
      ...(initial ? { initial_date: initial } : {}),
      placeholder: { type: 'plain_text', text: 'Pick a date' },
    },
  }
}

// Builds the onboarding modal, pre-filled from the employee record.
// Locked birthday/anniversary fields are shown as read-only notes, not inputs.
export function onboardingModal(employee) {
  const blocks = [section(ONBOARDING_COPY.modalIntro)]

  blocks.push(textInput('full_name', 'Full name', employee.full_name, false))
  blocks.push(textInput('email', 'Work email', employee.email))

  blocks.push({
    type: 'input',
    block_id: 'employee_type',
    label: { type: 'plain_text', text: 'Employee type' },
    element: {
      type: 'static_select',
      action_id: 'value',
      placeholder: { type: 'plain_text', text: 'Choose one' },
      options: EMPLOYEE_TYPES.map((type) => ({ text: { type: 'plain_text', text: type }, value: type })),
      ...(employee.employee_type
        ? {
            initial_option: {
              text: { type: 'plain_text', text: employee.employee_type },
              value: employee.employee_type,
            },
          }
        : {}),
    },
  })

  if (employee.joining_date_pending_approval) {
    blocks.push(context(ONBOARDING_COPY.joiningDatePending(formatStoredDate(employee.suggested_joining_date))))
  }
  blocks.push(dateInput('joining_date', 'Joining date', employee.joining_date, ONBOARDING_COPY.joiningDateHint))

  if (employee.birthday_locked) {
    blocks.push(section(ONBOARDING_COPY.lockedNote('Birthday', formatStoredDate(employee.birthday))))
  } else {
    blocks.push(dateInput('birthday', 'Birthday', employee.birthday))
  }

  if (employee.anniversary_locked) {
    blocks.push(section(ONBOARDING_COPY.lockedNote('Work anniversary', formatStoredDate(employee.anniversary))))
  } else {
    blocks.push(dateInput('anniversary', 'Work anniversary', employee.anniversary))
  }

  blocks.push(textInput('favorite_slime', 'Favorite slime', employee.favorite_slime))
  blocks.push(textInput('favorite_color', 'Favorite color', employee.favorite_color))
  blocks.push(textInput('favorite_snack', 'Favorite snack', employee.favorite_snack))
  blocks.push(textAreaInput('celebration_notes', 'Any preferences around how we celebrate you?', employee.celebration_notes))

  const selectedPreference = ANNOUNCEMENT_OPTIONS.find((o) => o.value === employee.announcement_preference)
  blocks.push({
    type: 'input',
    block_id: 'announcement_preference',
    label: { type: 'plain_text', text: 'How should we celebrate you?' },
    element: {
      type: 'radio_buttons',
      action_id: 'value',
      options: ANNOUNCEMENT_OPTIONS.map((o) => ({ text: { type: 'plain_text', text: o.label }, value: o.value })),
      ...(selectedPreference
        ? { initial_option: { text: { type: 'plain_text', text: selectedPreference.label }, value: selectedPreference.value } }
        : {}),
    },
  })

  return {
    type: 'modal',
    callback_id: 'onboarding_form',
    private_metadata: JSON.stringify({ employee_id: employee.id }),
    title: { type: 'plain_text', text: ONBOARDING_COPY.modalTitle },
    submit: { type: 'plain_text', text: ONBOARDING_COPY.submitLabel },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks,
  }
}

// Reads submitted values from view.state.values. Missing block ids come back as undefined.
export function parseModalValues(stateValues) {
  const read = (blockId) => {
    const block = stateValues?.[blockId]
    if (!block) return undefined
    const el = Object.values(block)[0] || {}
    if ('selected_date' in el) return el.selected_date || null
    if ('selected_option' in el) return el.selected_option?.value || null
    return typeof el.value === 'string' ? el.value.trim() : null
  }
  return {
    full_name: read('full_name'),
    email: read('email'),
    employee_type: read('employee_type'),
    joining_date: read('joining_date'),
    birthday: read('birthday'),
    anniversary: read('anniversary'),
    favorite_slime: read('favorite_slime'),
    favorite_color: read('favorite_color'),
    favorite_snack: read('favorite_snack'),
    celebration_notes: read('celebration_notes'),
    announcement_preference: read('announcement_preference'),
  }
}

export function joiningDateApprovalRequest(employee, employeeLabel) {
  return [
    section(
      `${ONBOARDING_COPY.approverDmTitle}\n*${employeeLabel}* (${employee.employee_type || 'type not set'})\n` +
        `Current: *${formatStoredDate(employee.joining_date) || 'not set'}*  →  Suggested: *${formatStoredDate(employee.suggested_joining_date)}*`,
    ),
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          style: 'primary',
          action_id: 'approve_joining_date',
          value: employee.id,
          text: { type: 'plain_text', text: 'Approve', emoji: true },
        },
        {
          type: 'button',
          action_id: 'reject_joining_date',
          value: employee.id,
          text: { type: 'plain_text', text: 'Keep original', emoji: true },
        },
      ],
    },
  ]
}

export function shoutoutText(item, { private: isPrivate }) {
  const name = String(item.employee.full_name || '').trim().split(/\s+/)[0] || 'there'
  if (item.kind === 'birthday') return isPrivate ? CELEBRATION_COPY.privateDmBirthday(name) : CELEBRATION_COPY.birthday(name)
  return isPrivate
    ? CELEBRATION_COPY.privateDmAnniversary(name, item.years)
    : CELEBRATION_COPY.anniversary(name, item.years)
}

// Digest in the Zapier style: name, date, and favorites/preferences.
// Private employees never reach this function (filtered in jobs.js).
export function digestBlocks(title, items, timeZone) {
  const blocks = [section(`*${title}*`)]
  for (const item of items) {
    const e = item.employee
    const icon = item.kind === 'birthday' ? '🎂' : '🏆'
    const label = item.kind === 'birthday' ? 'Birthday' : `Work anniversary · ${item.years} yr 🎊`
    const when = item.daysAway === 0 ? 'Today' : formatDayLabel(item.occurrenceDate, timeZone)
    const lines = [
      `${icon} *${e.full_name}* · ${label}`,
      `📅 ${when}`,
      e.favorite_slime ? `*Favorite Slime:* ${e.favorite_slime}` : null,
      e.favorite_color ? `*Favorite Color:* ${e.favorite_color}` : null,
      e.favorite_snack ? `*Favorite Snacks:* ${e.favorite_snack}` : null,
      e.celebration_notes ? `*Further Preferences:* ${e.celebration_notes}` : null,
    ].filter(Boolean)
    blocks.push(section(lines.join('\n')))
  }
  blocks.push({ type: 'divider' })
  blocks.push(context(`${items.length} upcoming celebration${items.length === 1 ? '' : 's'} · KSC App Hub · Private employees are not listed`))
  return blocks
}
