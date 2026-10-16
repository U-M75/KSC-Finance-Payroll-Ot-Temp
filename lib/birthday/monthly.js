// Monthly automations that replace the three Zapier zaps (export of 2026-10-15):
//  - Zap 3 "Birthday and Anniversary Monthly Summary": on the 1st, post this month's
//    birthdays and work anniversaries to the HR alerts channel.
//  - Zap 1 "Intimation Existing Slack Users": on the 1st, DM the onboarding form to active employees.
//  - Zap 2 "Message to Employee and HR" (HR part): every form submission posts an alert to the HR channel.
// Private employees (announcement_preference = private_dm) never appear in the monthly summary.
import { env, timezone } from './env.js'
import { postToChannel } from './slack.js'
import { todayIn, isPrivate } from './celebrations.js'
import { loadEligibleEmployees, dispatchOnboardingForm } from './employees.js'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Pure: builds the Zapier-style monthly summary text from employee rows. No I/O.
export function buildMonthlySummary(employees, today) {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const monthLabel = MONTHS[month - 1]
  const birthdays = []
  const anniversaries = []

  for (const employee of employees) {
    if (isPrivate(employee)) continue
    if (employee.birthday && Number(employee.birthday.slice(5, 7)) === month) {
      birthdays.push({ name: employee.full_name, day: Number(employee.birthday.slice(8, 10)) })
    }
    if (employee.anniversary && Number(employee.anniversary.slice(5, 7)) === month) {
      const years = year - Number(employee.anniversary.slice(0, 4))
      if (years > 0) anniversaries.push({ name: employee.full_name, years })
    }
  }
  birthdays.sort((a, b) => a.day - b.day || a.name.localeCompare(b.name))
  anniversaries.sort((a, b) => a.years - b.years || a.name.localeCompare(b.name))

  let text = `📢 *HR Monthly Celebrations – ${monthLabel}*\n━━━━━━━━━━━━━━━━━━━━━━\n\n`
  text += `👋 *Hello Team,*\nHere are the employee birthdays and work anniversaries for this month. 🎉\n\n`
  text += `🎂 *Birthdays – ${monthLabel}*\n`
  text += birthdays.length
    ? birthdays.map((b) => `• ${b.name} — Day ${b.day}`).join('\n') + '\n'
    : 'No birthdays recorded for this month.\n'
  text += `\n🎊 *Work Anniversaries – ${monthLabel}*\n`
  text += anniversaries.length
    ? anniversaries.map((a) => `• ${a.name} — ${a.years} year${a.years > 1 ? 's' : ''} with the company`).join('\n') + '\n'
    : 'No work anniversaries this month.\n'
  text += `\n━━━━━━━━━━━━━━━━━━━━━━\n💙 *Thank you everyone for being part of the team!*`

  return { text, birthdays, anniversaries }
}

function isFirstOfMonth(today) {
  return today.slice(8, 10) === '01'
}

// Zap 3: monthly summary to the HR alerts channel.
export async function runMonthlySummary(now = new Date()) {
  const today = todayIn(timezone(), now)
  if (!isFirstOfMonth(today)) return { skipped: true, date: today, reason: 'Not the 1st of the month.' }
  const channel = env('SLACK_CHANNEL_HR_ALERTS')
  if (!channel) return { skipped: true, date: today, reason: 'SLACK_CHANNEL_HR_ALERTS is not set.' }

  const employees = await loadEligibleEmployees({ withDates: true })
  const summary = buildMonthlySummary(employees, today)
  await postToChannel(channel, summary.text)
  return { date: today, birthdays: summary.birthdays.length, anniversaries: summary.anniversaries.length }
}

// Zap 1: monthly onboarding/preference form DM to active employees.
// dispatchOnboardingForm keeps the rule that the form only goes to #ksc-chat-room members.
export async function runMonthlyReminder(now = new Date()) {
  const today = todayIn(timezone(), now)
  if (!isFirstOfMonth(today)) return { skipped: true, date: today, reason: 'Not the 1st of the month.' }

  const employees = await loadEligibleEmployees()
  const result = { date: today, sent: 0, skipped: 0, failed: 0 }
  for (const employee of employees) {
    if (!employee.slack_user_id) {
      result.skipped += 1
      continue
    }
    try {
      const dispatch = await dispatchOnboardingForm(employee, { source: 'monthly_reminder' })
      if (dispatch.sent) result.sent += 1
      else result.skipped += 1
    } catch (error) {
      result.failed += 1
      console.error('Monthly reminder failed', employee.id, error)
    }
  }
  return result
}

// Zap 2 (HR part): alert the HR channel when an employee submits the form.
export async function notifyHrOfSubmission(employee) {
  const channel = env('SLACK_CHANNEL_HR_ALERTS')
  if (!channel) return { sent: false, reason: 'SLACK_CHANNEL_HR_ALERTS is not set.' }
  const value = (v) => v || 'Not provided'
  const text = [
    '🎂 *A New Birthday & Work Anniversary Form Submitted*',
    '',
    '💼 *Employee Details:*',
    `Name: *${value(employee.full_name)}*`,
    `Type: *${value(employee.employee_type)}*`,
    `Joining date: *${value(employee.joining_date)}*`,
    `Birthday: *${value(employee.birthday)}*`,
    `Work anniversary: *${value(employee.anniversary)}*`,
    `Celebration preference: *${isPrivate(employee) ? 'Private (DM only)' : 'Public'}*`,
    `Favorite slimes: *${value(employee.favorite_slime)}*`,
    `Favorite colors or themes: *${value(employee.favorite_color)}*`,
    `Favorite snacks or treats: *${value(employee.favorite_snack)}*`,
    `Notes: *${value(employee.celebration_notes)}*`,
  ].join('\n')
  await postToChannel(channel, text)
  return { sent: true }
}
