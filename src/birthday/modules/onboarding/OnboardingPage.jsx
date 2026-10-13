import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api.js'
import { ConfirmDialog, ErrorBox, Pill, Toast } from '../../components/ui.jsx'
import { dayLabel, formatDate, formatMonthDay, EMPLOYEE_TYPES, STATUSES } from '../../lib/format.js'
import EmployeeModal from './EmployeeModal.jsx'
import AddEmployeeModal from './AddEmployeeModal.jsx'

// Onboarding & Milestones dashboard.
// Ops (Mika) gets a read-only gift-prep view: names, birthdays and preferences only.
export default function OnboardingPage({ me, token }) {
  const can = (permission) => me.permissions.includes(permission)
  const canEdit = can('employees:edit')
  const canTrigger = can('onboarding:trigger')
  const canApprove = can('joining_date:approve')
  const canSeeFull = can('employees:read_full')

  const [employees, setEmployees] = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [selected, setSelected] = useState(null)
  const [adding, setAdding] = useState(false)
  const [retriggerTarget, setRetriggerTarget] = useState(null)
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [people, soon] = await Promise.all([
        api('/api/birthday?route=employees', { token }),
        api('/api/birthday?route=onboarding&action=upcoming&days=7', { token }),
      ])
      setEmployees(people.employees || [])
      setUpcoming(soon.items || [])
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  const stats = useMemo(() => {
    const active = employees.filter((e) => e.status === 'active')
    return {
      active: active.length,
      submitted: active.filter((e) => e.form_submitted).length,
      pending: employees.filter((e) => e.joining_date_pending_approval).length,
      upcoming: upcoming.length,
    }
  }, [employees, upcoming])

  const pendingApprovals = useMemo(() => employees.filter((e) => e.joining_date_pending_approval), [employees])

  const filtered = useMemo(
    () =>
      employees.filter((e) => {
        const text = `${e.full_name} ${e.slack_username || ''} ${e.email || ''}`.toLowerCase()
        return (
          text.includes(search.trim().toLowerCase()) &&
          (typeFilter === 'All' || e.employee_type === typeFilter) &&
          (statusFilter === 'All' || e.status === statusFilter)
        )
      }),
    [employees, search, typeFilter, statusFilter],
  )

  async function decideJoining(employee, action) {
    setBusyId(employee.id)
    try {
      await api('/api/birthday?route=employees', { method: 'POST', token, body: { id: employee.id, action } })
      setToast(action === 'approve_joining_date' ? `Joining date updated for ${employee.full_name}.` : `Kept the original date for ${employee.full_name}.`)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId('')
    }
  }

  async function retrigger() {
    const employee = retriggerTarget
    setBusyId(employee.id)
    try {
      const data = await api('/api/birthday?route=onboarding', {
        method: 'POST',
        token,
        body: { action: 'retrigger', id: employee.id, confirm: true },
      })
      setRetriggerTarget(null)
      setToast(data.dispatch?.sent ? `Onboarding form re-sent to ${employee.full_name}.` : data.dispatch?.reason || 'Form was not sent.')
      load()
    } catch (err) {
      setError(err.message)
      setRetriggerTarget(null)
    } finally {
      setBusyId('')
    }
  }

  return (
    <section className="module-section">
      <div className="module-head">
        <div>
          <span className="eyebrow">{canSeeFull ? 'Onboarding & milestones' : 'Gift prep · read only'}</span>
          <h2>{canSeeFull ? 'Employee onboarding dashboard' : 'Celebrations & preferences'}</h2>
          <p className="muted">
            {canSeeFull
              ? 'Track onboarding forms, approve joining dates and see who is celebrating next.'
              : 'Birthdays, anniversaries and favorites for preparing gift packages.'}
          </p>
        </div>
        <div className="module-actions">
          <button className="ghost-button" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          {canTrigger && <button className="add-button" onClick={() => setAdding(true)}>+ Add employee</button>}
        </div>
      </div>

      <ErrorBox>{error}</ErrorBox>

      {canSeeFull && (
        <div className="stats-grid">
          <Stat label="Active employees" value={stats.active} />
          <Stat label="Forms submitted" value={`${stats.submitted}/${stats.active}`} />
          <Stat label="Joining dates to approve" value={stats.pending} tone={stats.pending ? 'warn' : undefined} />
          <Stat label="Celebrations in 7 days" value={stats.upcoming} />
        </div>
      )}

      {canApprove && pendingApprovals.length > 0 && (
        <div className="panel panel-warn">
          <h3>Joining date approvals</h3>
          <p className="muted">These employees suggested a different joining date. The live record is unchanged until you approve it.</p>
          <ul className="list">
            {pendingApprovals.map((e) => (
              <li key={e.id}>
                <div>
                  <strong>{e.full_name}</strong>
                  <span className="muted"> {e.employee_type || 'type not set'} · HR date {formatDate(e.joining_date)} → suggested <b>{formatDate(e.suggested_joining_date)}</b></span>
                </div>
                <div className="row-actions">
                  <button className="save small" disabled={busyId === e.id} onClick={() => decideJoining(e, 'approve_joining_date')}>Approve</button>
                  <button className="cancel small" disabled={busyId === e.id} onClick={() => decideJoining(e, 'reject_joining_date')}>Keep original</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="two-col">
        <div className="panel">
          <h3>Next 7 days</h3>
          {upcoming.length ? (
            <ul className="list compact">
              {upcoming.map((item) => (
                <li key={`${item.employee_id}-${item.kind}`}>
                  <span className="celebration-icon">{item.kind === 'birthday' ? '🎂' : '🎊'}</span>
                  <div>
                    <strong>{item.full_name}</strong>
                    <span className="muted"> {item.kind === 'birthday' ? 'Birthday' : `Work anniversary · ${item.years} yr`}</span>
                  </div>
                  <Pill tone={item.daysAway === 0 ? 'pink' : 'blue'}>{dayLabel(item.days_away, item.occurrence_date)}</Pill>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No celebrations in the next 7 days.</p>
          )}
        </div>
        <div className="panel">
          <h3>Routing rules</h3>
          <ul className="rules">
            <li><b>Public, non-Disney:</b> on-the-day shoutout in #ksc-chat-room and the #onboarding-insights digest.</li>
            <li><b>Disney:</b> digest only in #disney-onboarding-insights. No shoutout in the chat room.</li>
            <li><b>Private:</b> on-the-day DM only. Never listed in channels or digests.</li>
            <li><b>Offboarded, disabled or revoked:</b> excluded from forms and celebrations automatically.</li>
          </ul>
        </div>
      </div>

      <div className="filters">
        <input placeholder="Search name, Slack username or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {canSeeFull && (
          <>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option>All</option>
              {EMPLOYEE_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option>All</option>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </>
        )}
      </div>

      {loading ? (
        <div className="loading">Loading employees…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">No employees match these filters.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              {canSeeFull ? (
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Joining date</th>
                  <th>Birthday</th>
                  <th>Anniversary</th>
                  <th>Announcement</th>
                  <th>Favorite snack</th>
                  <th>Favorite slime</th>
                  <th>Favorite color</th>
                  <th>Form</th>
                  <th>Status</th>
                  <th />
                </tr>
              ) : (
                <tr>
                  <th>Name</th>
                  <th>Birthday</th>
                  <th>Anniversary</th>
                  <th>Favorite snack</th>
                  <th>Favorite slime</th>
                  <th>Favorite color</th>
                </tr>
              )}
            </thead>
            <tbody>
              {filtered.map((e) =>
                canSeeFull ? (
                  <tr key={e.id}>
                    <td>
                      <strong>{e.full_name}</strong>
                      <div className="muted small">{e.slack_username ? `@${e.slack_username}` : e.email || ''}</div>
                    </td>
                    <td>{e.employee_type || <span className="muted">Not set</span>}</td>
                    <td>
                      {formatDate(e.joining_date)}
                      {e.joining_date_pending_approval && <Pill tone="warn">Approval</Pill>}
                    </td>
                    <td>{formatMonthDay(e.birthday)}{e.birthday_locked && <span title="Locked after submission"> 🔒</span>}</td>
                    <td>{formatMonthDay(e.anniversary)}{e.anniversary_locked && <span title="Locked after submission"> 🔒</span>}</td>
                    <td>{e.announcement_preference === 'private_dm' ? 'Private (DM)' : 'Public'}</td>
                    <td>{e.favorite_snack || <span className="muted">—</span>}</td>
                    <td>{e.favorite_slime || <span className="muted">—</span>}</td>
                    <td>{e.favorite_color || <span className="muted">—</span>}</td>
                    <td><Pill tone={e.form_submitted ? 'good' : 'neutral'}>{e.form_submitted ? 'Submitted' : 'Pending'}</Pill></td>
                    <td><Pill tone={e.status === 'active' ? 'good' : 'bad'}>{e.status}</Pill></td>
                    <td className="actions-cell">
                      <button className="link-button" onClick={() => setSelected(e)}>{canEdit ? 'Edit' : 'View'}</button>
                      {canTrigger && e.status === 'active' && (
                        <button className="link-button" onClick={() => setRetriggerTarget(e)}>Re-trigger form</button>
                      )}
                    </td>
                  </tr>
                ) : (
                  <tr key={e.id}>
                    <td><strong>{e.full_name}</strong></td>
                    <td>{formatMonthDay(e.birthday)}</td>
                    <td>{formatMonthDay(e.anniversary)}</td>
                    <td>{e.favorite_snack || '—'}</td>
                    <td>{e.favorite_slime || '—'}</td>
                    <td>{e.favorite_color || '—'}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <EmployeeModal
          employee={selected}
          token={token}
          canEdit={canEdit}
          canApprove={canApprove}
          canDisable={can('employees:disable')}
          canDelete={can('employees:delete')}
          canUnlock={can('employees:unlock')}
          canSetJoining={can('joining_date:set')}
          onClose={() => setSelected(null)}
          onSaved={(message) => {
            setSelected(null)
            setToast(message)
            load()
          }}
        />
      )}

      {adding && (
        <AddEmployeeModal
          token={token}
          canSetJoining={can('joining_date:set')}
          onClose={() => setAdding(false)}
          onAdded={(message) => {
            setAdding(false)
            setToast(message)
            load()
          }}
        />
      )}

      {retriggerTarget && (
        <ConfirmDialog
          eyebrow="Re-send onboarding form"
          title={`Send the form to ${retriggerTarget.full_name} again?`}
          message="This resets their submission status and sends a new DM with the onboarding form. Birthday and anniversary stay locked if they were already submitted."
          confirmLabel="Re-send form"
          requireCheck
          checkLabel={`I understand this sends a Slack DM to ${retriggerTarget.full_name}.`}
          busy={busyId === retriggerTarget.id}
          onConfirm={retrigger}
          onCancel={() => setRetriggerTarget(null)}
        />
      )}

      <Toast message={toast} onDone={() => setToast('')} />
    </section>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className={`stat-card${tone ? ` stat-${tone}` : ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}
