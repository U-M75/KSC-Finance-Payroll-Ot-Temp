// Dates are stored as YYYY-MM-DD. Format them in UTC so they never shift a day.
export function formatDate(value) {
  if (!value) return '—'
  const [y, m, d] = String(value).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatMonthDay(value) {
  if (!value) return '—'
  const [y, m, d] = String(value).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function dayLabel(daysAway, occurrenceDate) {
  if (daysAway === 0) return 'Today'
  if (daysAway === 1) return 'Tomorrow'
  return formatMonthDay(occurrenceDate)
}

export const EMPLOYEE_TYPES = ['Disney', 'Jellyland', 'Kawaii Slime In-house', 'None of these']
export const STATUSES = ['active', 'offboarded', 'disabled', 'revoked']
export const PREFERENCES = [
  { value: 'public', label: 'Public' },
  { value: 'private_dm', label: 'Private (DM only)' },
]
