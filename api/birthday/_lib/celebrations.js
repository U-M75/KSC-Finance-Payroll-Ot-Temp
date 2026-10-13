// Pure celebration logic: date math and routing rules. No I/O here, so it is
// unit-tested in tests/celebrations.test.js.
//
// Routing rules (from the KSC spec):
//  - Public, non-Disney   -> on-the-day shoutout in #ksc-chat-room + #onboarding-insights digest
//  - Public, Disney       -> #disney-onboarding-insights digest only (no shoutout, not in chat room)
//  - Private (private_dm) -> on-the-day DM only; excluded from every channel post and digest
//  - Offboarded / disabled / revoked employees are never in the eligible list at all.

const DAY_MS = 24 * 60 * 60 * 1000

// 'YYYY-MM-DD' for "now" in the given IANA timezone.
export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function utc(dateString) {
  const [y, m, d] = dateString.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function daysBetween(fromDate, toDate) {
  return Math.round((utc(toDate) - utc(fromDate)) / DAY_MS)
}

// Next date a yearly event (birthday/anniversary) falls on, on or after today.
// Feb 29 falls back to Feb 28 in non-leap years.
export function nextOccurrence(eventDate, today) {
  const [, month, day] = eventDate.split('-')
  let year = Number(today.slice(0, 4))
  const build = (y) => {
    const candidate = `${y}-${month}-${day}`
    const check = new Date(Date.UTC(y, Number(month) - 1, Number(day)))
    return check.getUTCMonth() === Number(month) - 1 ? candidate : `${y}-${month}-28`
  }
  let occurrence = build(year)
  if (daysBetween(today, occurrence) < 0) {
    year += 1
    occurrence = build(year)
  }
  return { occurrenceDate: occurrence, daysAway: daysBetween(today, occurrence) }
}

// Upcoming birthdays and work anniversaries within `windowDays` (0 = today only).
export function upcomingCelebrations(employees, today, windowDays) {
  const items = []
  for (const employee of employees) {
    if (employee.birthday) {
      const { occurrenceDate, daysAway } = nextOccurrence(employee.birthday, today)
      if (daysAway >= 0 && daysAway <= windowDays) {
        items.push({ employee, kind: 'birthday', occurrenceDate, daysAway, years: null })
      }
    }
    if (employee.anniversary) {
      const { occurrenceDate, daysAway } = nextOccurrence(employee.anniversary, today)
      const years = Number(occurrenceDate.slice(0, 4)) - Number(employee.anniversary.slice(0, 4))
      if (years >= 1 && daysAway >= 0 && daysAway <= windowDays) {
        items.push({ employee, kind: 'anniversary', occurrenceDate, daysAway, years })
      }
    }
  }
  return items.sort((a, b) => a.daysAway - b.daysAway || a.employee.full_name.localeCompare(b.employee.full_name))
}

export function isDisney(employee) {
  return employee.employee_type === 'Disney'
}

export function isPrivate(employee) {
  return employee.announcement_preference === 'private_dm'
}

// Where an on-the-day shoutout goes: 'chat_room' | 'dm' | 'none'.
export function routeShoutout(employee) {
  if (isPrivate(employee)) return 'dm'
  if (isDisney(employee)) return 'none'
  return 'chat_room'
}

// Which digest channel an item belongs to: 'disney' | 'onboarding' | null (private, never in digests).
export function digestChannelFor(employee) {
  if (isPrivate(employee)) return null
  return isDisney(employee) ? 'disney' : 'onboarding'
}

export function formatDayLabel(dateString, timeZone) {
  return new Date(`${dateString}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  })
}
