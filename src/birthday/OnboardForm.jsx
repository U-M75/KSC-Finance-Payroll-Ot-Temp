// Public onboarding form, opened from the "Fill Form Here" button in the Slack DM (/onboard?t=...).
// Loaded only on that path (see main.jsx), so the Birthday styles never touch the Finance pages.
import { useEffect, useState } from 'react'
import { api } from './lib/api.js'
import { EMPLOYEE_TYPES } from './lib/format.js'
import './birthday.css'

const ANNOUNCEMENT = [
  { value: 'public', label: 'Public: celebrate in team channels' },
  { value: 'private_dm', label: 'Private: only send me a DM' },
]

const EMPTY = {
  full_name: '', email: '', employee_type: '', joining_date: '', birthday: '', anniversary: '',
  favorite_slime: '', favorite_color: '', favorite_snack: '', celebration_notes: '', announcement_preference: 'public',
}

function fromEmployee(employee) {
  const form = { ...EMPTY }
  for (const key of Object.keys(EMPTY)) form[key] = employee[key] || ''
  if (!form.announcement_preference) form.announcement_preference = 'public'
  return form
}

export default function OnboardForm() {
  const token = new URLSearchParams(window.location.search).get('t') || ''
  const [employee, setEmployee] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    let alive = true
    api(`/api/birthday?route=onboard&t=${encodeURIComponent(token)}`)
      .then((data) => {
        if (!alive) return
        setEmployee(data.employee)
        setForm(fromEmployee(data.employee))
      })
      .catch((err) => { if (alive) setLoadError(err.message) })
    return () => { alive = false }
  }, [token])

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value })

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = {
        t: token,
        full_name: form.full_name,
        email: form.email,
        employee_type: form.employee_type,
        joining_date: form.joining_date,
        favorite_slime: form.favorite_slime,
        favorite_color: form.favorite_color,
        favorite_snack: form.favorite_snack,
        celebration_notes: form.celebration_notes,
        announcement_preference: form.announcement_preference,
        // Locked dates are not sent again. The server keeps the first submitted value.
        birthday: employee?.birthday_locked ? undefined : form.birthday,
        anniversary: employee?.anniversary_locked ? undefined : form.anniversary,
      }
      const data = await api('/api/birthday?route=onboard', { method: 'POST', body })
      setDone(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <div className="modal modal-wide" style={{ margin: '40px auto' }}>
        <h2>Form not available</h2>
        <div className="error">{loadError}</div>
      </div>
    )
  }
  if (!employee) {
    return <div className="modal modal-wide" style={{ margin: '40px auto' }}><p>Loading your form…</p></div>
  }
  if (done) {
    return (
      <div className="modal modal-wide" style={{ margin: '40px auto' }}>
        <h2>Thank you!</h2>
        <p>{done.message}</p>
        {done.joiningDateChange && <p>Your joining date change has been sent to HR for approval.</p>}
        {done.ignoredLocked?.length > 0 && <p>Birthday or anniversary was already submitted, so it was not changed. Contact HR for updates.</p>}
        <p>You can close this page now.</p>
      </div>
    )
  }

  const lockedNote = (locked) => (locked ? <span className="field-note">Locked after first submission. Contact HR to change it.</span> : null)

  return (
    <form className="modal modal-wide" style={{ margin: '40px auto' }} onSubmit={submit}>
      <h2>Birthday &amp; Anniversary form</h2>
      <p>Please fill in your details. Your birthday and anniversary can be submitted once.</p>
      {error && <div className="error">{error}</div>}

      <label>Full name
        <input value={form.full_name} onChange={set('full_name')} required />
      </label>
      <label>Work email
        <input type="email" value={form.email} onChange={set('email')} />
      </label>
      <label>Employee type
        <select value={form.employee_type} onChange={set('employee_type')} required>
          <option value="">Choose one</option>
          {EMPLOYEE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      <label>Joining date
        <input type="date" value={form.joining_date} onChange={set('joining_date')} />
        <span className="field-note">If this is different from HR's record, HR will be asked to approve it.</span>
      </label>
      <label>Birthday
        <input type="date" value={form.birthday} onChange={set('birthday')} disabled={employee.birthday_locked} />
        {lockedNote(employee.birthday_locked)}
      </label>
      <label>Work anniversary
        <input type="date" value={form.anniversary} onChange={set('anniversary')} disabled={employee.anniversary_locked} />
        {lockedNote(employee.anniversary_locked)}
      </label>
      <label>Favorite slime
        <input value={form.favorite_slime} onChange={set('favorite_slime')} />
      </label>
      <label>Favorite color
        <input value={form.favorite_color} onChange={set('favorite_color')} />
      </label>
      <label>Favorite snack
        <input value={form.favorite_snack} onChange={set('favorite_snack')} />
      </label>
      <label>Celebration notes
        <textarea rows="3" value={form.celebration_notes} onChange={set('celebration_notes')} />
      </label>
      <label>How should we celebrate you?
        <select value={form.announcement_preference} onChange={set('announcement_preference')} required>
          {ANNOUNCEMENT.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      <div className="modal-actions">
        <button className="save" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  )
}
