import { useState } from 'react'
import { api } from '../../lib/api.js'
import { ConfirmDialog, ErrorBox, Modal, Pill } from '../../components/ui.jsx'
import { formatDate, EMPLOYEE_TYPES, STATUSES, PREFERENCES } from '../../lib/format.js'

const EDITABLE = [
  'full_name',
  'slack_username',
  'email',
  'employee_type',
  'birthday',
  'anniversary',
  'favorite_slime',
  'favorite_color',
  'favorite_snack',
  'celebration_notes',
  'announcement_preference',
]

// Edit an employee record. Only changed fields are sent. Read-only when the role cannot edit.
export default function EmployeeModal({ employee, token, canEdit, canApprove, canDisable, canDelete, canUnlock, canSetJoining, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    const initial = {}
    for (const key of EDITABLE) initial[key] = employee[key] ?? ''
    initial.joining_date = employee.joining_date ?? ''
    initial.status = employee.status
    return initial
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const readOnly = !canEdit
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })

  async function save(event) {
    event.preventDefault()
    const body = { id: employee.id }
    for (const key of EDITABLE) {
      const next = form[key] === '' ? null : form[key]
      if ((employee[key] ?? null) !== next) body[key] = next
    }
    if (canSetJoining && (employee.joining_date ?? '') !== form.joining_date) body.joining_date = form.joining_date || null
    if (canDisable && form.status !== employee.status) body.status = form.status
    if (Object.keys(body).length === 1) return onClose()

    setBusy(true)
    setError('')
    try {
      await api('/api/birthday?route=employees', { method: 'PATCH', token, body })
      onSaved(`Saved changes for ${form.full_name || employee.full_name}.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await api('/api/birthday?route=employees', { method: 'DELETE', token, body: { id: employee.id } })
      onSaved(`${employee.full_name} was deleted.`)
    } catch (err) {
      setError(err.message)
      setConfirmDelete(false)
    } finally {
      setBusy(false)
    }
  }

  async function decideJoining(action) {
    setBusy(true)
    try {
      await api('/api/birthday?route=employees', { method: 'POST', token, body: { id: employee.id, action } })
      onSaved(action === 'approve_joining_date' ? 'Joining date approved.' : 'Kept the original joining date.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleUnlock(field) {
    setBusy(true)
    try {
      await api('/api/birthday?route=employees', { method: 'PATCH', token, body: { id: employee.id, [field]: false } })
      onSaved(`${field === 'birthday_locked' ? 'Birthday' : 'Anniversary'} unlocked. The employee can submit it again.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal eyebrow={readOnly ? 'Employee · read only' : 'Employee record'} title={employee.full_name} onClose={onClose} wide>
      <form onSubmit={save}>
        <div className="meta-row">
          <Pill tone={employee.form_submitted ? 'good' : 'neutral'}>{employee.form_submitted ? 'Form submitted' : 'Form pending'}</Pill>
          <Pill tone={employee.status === 'active' ? 'good' : 'bad'}>{employee.status}</Pill>
          <span className="muted small">Slack ID: {employee.slack_user_id}</span>
        </div>

        <ErrorBox>{error}</ErrorBox>

        {employee.joining_date_pending_approval && (
          <div className="panel panel-warn inline">
            <div>
              <strong>Joining date change pending</strong>
              <p className="muted">HR date {formatDate(employee.joining_date)} → suggested {formatDate(employee.suggested_joining_date)}</p>
            </div>
            {canApprove && (
              <div className="row-actions">
                <button type="button" className="save small" disabled={busy} onClick={() => decideJoining('approve_joining_date')}>Approve</button>
                <button type="button" className="cancel small" disabled={busy} onClick={() => decideJoining('reject_joining_date')}>Keep original</button>
              </div>
            )}
          </div>
        )}

        <div className="form-grid">
          <Field label="Full name"><input disabled={readOnly} value={form.full_name} onChange={set('full_name')} required /></Field>
          <Field label="Slack username"><input disabled={readOnly} value={form.slack_username} onChange={set('slack_username')} /></Field>
          <Field label="Work email"><input disabled={readOnly} type="email" value={form.email} onChange={set('email')} /></Field>
          <Field label="Employee type">
            <select disabled={readOnly} value={form.employee_type} onChange={set('employee_type')}>
              <option value="">Not set</option>
              {EMPLOYEE_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Joining date (HR)">
            <input disabled={!canSetJoining} type="date" value={form.joining_date} onChange={set('joining_date')} />
          </Field>
          <Field label="Status">
            <select disabled={!canDisable} value={form.status} onChange={set('status')}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Birthday">
            <input disabled={readOnly} type="date" value={form.birthday} onChange={set('birthday')} />
            {employee.birthday_locked && (
              <span className="field-note">
                🔒 Locked after first submission.
                {canUnlock && <button type="button" className="link-button" disabled={busy} onClick={() => toggleUnlock('birthday_locked')}> Unlock</button>}
              </span>
            )}
          </Field>
          <Field label="Work anniversary">
            <input disabled={readOnly} type="date" value={form.anniversary} onChange={set('anniversary')} />
            {employee.anniversary_locked && (
              <span className="field-note">
                🔒 Locked after first submission.
                {canUnlock && <button type="button" className="link-button" disabled={busy} onClick={() => toggleUnlock('anniversary_locked')}> Unlock</button>}
              </span>
            )}
          </Field>
          <Field label="Favorite slime"><input disabled={readOnly} value={form.favorite_slime} onChange={set('favorite_slime')} /></Field>
          <Field label="Favorite color"><input disabled={readOnly} value={form.favorite_color} onChange={set('favorite_color')} /></Field>
          <Field label="Favorite snack"><input disabled={readOnly} value={form.favorite_snack} onChange={set('favorite_snack')} /></Field>
          <Field label="Celebration notes"><textarea rows="2" disabled={readOnly} value={form.celebration_notes} onChange={set('celebration_notes')} /></Field>
          <Field label="Celebration preference">
            <select disabled={readOnly} value={form.announcement_preference} onChange={set('announcement_preference')}>
              {PREFERENCES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
        </div>

        <div className="modal-actions split">
          <div>
            {canDelete && <button type="button" className="danger ghost" onClick={() => setConfirmDelete(true)}>Delete record</button>}
          </div>
          <div className="row-actions">
            <button type="button" className="cancel" onClick={onClose}>Close</button>
            {!readOnly && <button className="save" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>}
          </div>
        </div>
      </form>

      {confirmDelete && (
        <ConfirmDialog
          eyebrow="Delete employee"
          title={`Delete ${employee.full_name}?`}
          message="This permanently removes the record. To stop celebrations and forms, set the status to offboarded instead."
          confirmLabel="Delete permanently"
          danger
          requireCheck
          checkLabel="I understand this cannot be undone."
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  )
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}
