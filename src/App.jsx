import { useEffect, useMemo, useState } from 'react'
import { generateTimecardPdf, generateTimecardImage } from '../pdf/timecard.js'

const ROLES = ['Admin', 'Supervisor', 'Payroll', 'HR']
const NAV = [
  ['dashboard', '⌂', 'Dashboard'],
  ['entries', '▤', 'OT Submissions'],
  ['temp', '◫', 'Temp Timecards'],
  ['approvals', '✓', 'Pending Approvals'],
  ['periods', '◷', 'Pay Periods'],
  ['employees', '♙', 'Employees'],
  ['workers', '♧', 'Temp Workers'],
  ['agencies', '▦', 'Temp Agencies'],
  ['departments', '◈', 'Departments'],
  ['supervisors', '♙', 'Supervisors'],
  ['payroll', '$', 'Payroll'],
  ['reports', '▥', 'Reports'],
  ['audit', '◌', 'Audit Log'],
]
const STATUS_OPTIONS = ['Draft', 'Submitted', 'Pending Approval', 'Approved', 'Rejected', 'Needs Correction', 'Processed', 'Exported to QuickBooks']
const EMPTY_FORM = {
  entry_type: 'Temp Timecard', pay_period_id: '', department_id: '', supervisor_name: '', temp_agency_id: '', temp_worker_id: '', temp_worker_name_snapshot: '', employee_id: '',
  work_date: '', work_end_date: '', regular_hours: '0', overtime_hours: '0', double_time_hours: '0', reason_for_ot: '', notes: '', assignment_location: '', job_role: '', agency_worker_id: '',
  submitted_on_behalf_of: 'Myself', representing_name: '', representation_reason: '', confirm_zero_hours: false,
}

function clean(value) { return String(value ?? '').trim() }
function moneyHours(value) { return Number(value || 0).toFixed(2) }
function dateLabel(value) { if (!value) return '—'; const d = new Date(`${String(value).slice(0, 10)}T00:00:00`); return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
function dateTime(value) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) }
function totalHours(row) { return Number(row?.regular_hours || 0) + Number(row?.overtime_hours || 0) + Number(row?.double_time_hours || 0) }
function statusClass(status) { return String(status || '').toLowerCase().replace(/\s+/g, '-') }
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
function weekdayShort(value) { const d = new Date(`${String(value || '').slice(0, 10)}T00:00:00Z`); return Number.isNaN(d.getTime()) ? '' : WEEKDAYS[d.getUTCDay()] }
function weekdayFull(value) { const d = new Date(`${String(value || '').slice(0, 10)}T00:00:00Z`); return Number.isNaN(d.getTime()) ? '' : WEEKDAYS_FULL[d.getUTCDay()] }
function periodLabel(period, includeType = false) {
  if (!period) return '—'
  const type = period.period_type === 'Employee OT' ? 'OT' : 'Temp'
  const schedule = period.start_date && period.end_date ? `${weekdayShort(period.start_date)}–${weekdayShort(period.end_date)} ${type}` : type
  return `${period.start_date} → ${period.end_date}${includeType || period.period_type ? ` · ${schedule}` : ''}`
}
function currentMonth() { return new Date().toISOString().slice(0, 7) }

async function apiJson(url, options = {}) {
  const response = await fetch(url, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data
}

function withUser(user, body = {}) { return { ...body, user_name: user?.name, user_role: user?.role } }

export default function App() {
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('ksc_finance_user') || 'null') } catch { return null } })
  const [page, setPage] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('view') === 'entry' && params.get('id')) return `entry:${params.get('id')}`
    return 'dashboard'
  })
  const [notifications, setNotifications] = useState([])
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!user) return
    apiJson(`/api/notifications?user_name=${encodeURIComponent(user.name)}`).then(data => setNotifications(data.notifications || [])).catch(() => {})
  }, [user, page])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4200); return () => clearTimeout(timer) }, [toast])

  function login(nextUser) { localStorage.setItem('ksc_finance_user', JSON.stringify(nextUser)); setUser(nextUser) }
  function logout() { localStorage.removeItem('ksc_finance_user'); setUser(null) }
  function navigate(next) { setPage(next); if (next.startsWith('entry:')) window.history.replaceState({}, '', `/?view=entry&id=${next.split(':')[1]}`); else window.history.replaceState({}, '', `/?view=${next}`) }
  async function markNotificationsRead() {
    const unread = notifications.filter(row => !row.read).map(row => row.id)
    if (!unread.length) return
    await apiJson('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: unread }) }).catch(() => {})
    setNotifications(rows => rows.map(row => ({ ...row, read: true })))
  }

  if (!user) return <Login onLogin={login} />
  let content
  if (page === 'dashboard') content = <Dashboard user={user} navigate={navigate} />
  else if (page === 'entries') content = <EntriesPage user={user} navigate={navigate} type="all" />
  else if (page === 'temp') content = <EntriesPage user={user} navigate={navigate} type="temp" />
  else if (page === 'approvals') content = <EntriesPage user={user} navigate={navigate} type="approvals" />
  else if (page === 'periods') content = <PayPeriodsPage user={user} />
  else if (page === 'employees') content = <DirectoryPage user={user} entity="employees" title="Employees" />
  else if (page === 'workers') content = <DirectoryPage user={user} entity="workers" title="Temp Workers" />
  else if (page === 'agencies') content = <DirectoryPage user={user} entity="agencies" title="Temp Agencies" />
  else if (page === 'departments') content = <DirectoryPage user={user} entity="departments" title="Departments" />
  else if (page === 'supervisors') content = <DirectoryPage user={user} entity="supervisors" title="Supervisors" />
  else if (page === 'payroll') content = <PayrollPage user={user} navigate={navigate} />
  else if (page === 'reports') content = <ReportsPage user={user} />
  else if (page === 'audit') content = <AuditPage />
  else if (page === 'new-temp') content = <EntryForm user={user} initialType="Temp Timecard" navigate={navigate} setToast={setToast} />
  else if (page === 'new-ot') content = <EntryForm user={user} initialType="Employee OT" navigate={navigate} setToast={setToast} />
  else if (page.startsWith('entry:')) content = <EntryDetail id={page.split(':')[1]} user={user} navigate={navigate} setToast={setToast} />
  else content = <Dashboard user={user} navigate={navigate} />

  const unread = notifications.filter(row => !row.read).length
  return <div className="app-shell">
    <Sidebar page={page.split(':')[0]} navigate={navigate} user={user} onLogout={logout} />
    <main className="main-content">
      <Topbar user={user} unread={unread} notifications={notifications} onRead={markNotificationsRead} />
      {content}
    </main>
    {toast && <div className="toast">{toast}</div>}
  </div>
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('Supervisor')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function submit(event) {
    event.preventDefault(); setLoading(true); setError('')
    try {
      const data = await apiJson('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, role }) })
      onLogin(data.user)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  return <div className="login-page"><div className="login-orb pink" /><div className="login-orb blue" /><div className="login-card">
    <img src="/ksc-logo.png" alt="Kawaii Slime Company" />
    <span className="eyebrow">Temp Timecard & OT Form</span>
    <h1>Temp Timecard & OT Form</h1>
    <p>OT, temporary-worker timecards, approvals and payroll tracking in one place.</p>
    <form onSubmit={submit}>
      <label>Username<input value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter your username" autoComplete="username" required /></label>
      <label>Role<select value={role} onChange={e => setRole(e.target.value)}>{ROLES.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Password<input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Enter your password" autoComplete="current-password" required /></label>
      {error && <div className="form-error">{error}</div>}
      <button className="primary-button" disabled={loading}>{loading ? 'Signing in…' : 'Open Temp Timecard & OT Form →'}</button>
    </form>
  </div></div>
}

function Sidebar({ page, navigate, user, onLogout }) {
  const allowed = user.role === 'Employee' ? new Set(['dashboard', 'entries', 'temp', 'approvals', 'reports']) : null
  return <aside className="sidebar">
    <div className="side-brand"><img src="/ksc-logo.png" alt="Kawaii Slime Company" /></div>
    <div className="side-app-title"><strong>Temp Timecard & OT Form</strong><span>OT & Payroll Operations</span></div>
    <nav className="side-nav">{NAV.filter(([id]) => !allowed || allowed.has(id)).map(([id, icon, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}><span>{icon}</span>{label}</button>)}</nav>
    <div className="side-bottom"><div className="user-chip"><div className="avatar">{String(user.name || 'U').slice(0, 1).toUpperCase()}</div><div><strong>{user.name}</strong><span>{user.role}</span></div></div><button className="logout-button" onClick={onLogout}>Sign out</button></div>
  </aside>
}

function Topbar({ user, unread, notifications, onRead }) {
  const [open, setOpen] = useState(false)
  return <div className="topbar"><div><span className="topbar-kicker">Kawaii Slime Company</span><span className="topbar-title">Temp Timecard & OT Form</span></div><div className="topbar-actions"><div className="role-pill">{user.role}</div><button className={`notification-button ${unread ? 'has-unread' : ''}`} onClick={() => { setOpen(value => !value); onRead() }}>♡<span>{unread || ''}</span></button>{open && <div className="notification-popover"><strong>Notifications</strong>{notifications.length ? notifications.slice(0, 6).map(row => <div className={`notification-item ${row.read ? '' : 'unread'}`} key={row.id}><b>{row.notification_type}</b><span>{row.message}</span><small>{dateTime(row.created_at)}</small></div>) : <p className="muted">No notifications yet.</p>}</div>}</div></div>
}

function Header({ eyebrow, title, description, actions }) {
  return <div className="content-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="header-actions">{actions}</div>}</div>
}
function StatCard({ label, value, note, tone = 'pink' }) { return <div className={`stat-card ${tone}`}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div> }
function Panel({ title, subtitle, children, action }) { return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section> }
function StatusBadge({ status }) { return <span className={`status-badge ${statusClass(status)}`}>{status || '—'}</span> }
function Loading() { return <div className="loading-state">Loading finance records…</div> }
function Empty({ title = 'No records yet', text = 'Records created in the app will appear here.' }) { return <div className="empty-state"><div className="empty-icon">♡</div><h2>{title}</h2><p>{text}</p></div> }

function useLookups() {
  const [data, setData] = useState({ departments: [], agencies: [], workers: [], employees: [], supervisors: [], supervisor_records: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  async function reload() { setLoading(true); try { setData(await apiJson('/api/lookups')); setError('') } catch (err) { setError(err.message) } finally { setLoading(false) } }
  useEffect(() => { reload() }, [])
  return { ...data, loading, error, reload }
}
function usePeriods() {
  const [periods, setPeriods] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  async function reload() { setLoading(true); try { setPeriods((await apiJson('/api/pay-periods')).periods || []); setError('') } catch (err) { setError(err.message) } finally { setLoading(false) } }
  useEffect(() => { reload() }, [])
  return { periods, loading, error, reload }
}

function Dashboard({ user, navigate }) {
  const periods = usePeriods(); const [selected, setSelected] = useState(''); const [entries, setEntries] = useState([]); const [error, setError] = useState('')
  useEffect(() => { if (!selected && periods.periods[0]) setSelected(periods.periods[0].id) }, [periods.periods, selected])
  useEffect(() => { if (!selected) return; apiJson(`/api/time-entries?pay_period_id=${encodeURIComponent(selected)}&user_role=${encodeURIComponent(user.role)}&user_name=${encodeURIComponent(user.name)}`).then(data => setEntries(data.entries || [])).catch(err => setError(err.message)) }, [selected, user])
  const metrics = useMemo(() => ({ pending: entries.filter(row => ['Submitted','Pending Approval'].includes(row.status)).length, regular: entries.reduce((sum, row) => sum + Number(row.regular_hours || 0), 0), ot: entries.reduce((sum, row) => sum + Number(row.overtime_hours || 0), 0), dt: entries.reduce((sum, row) => sum + Number(row.double_time_hours || 0), 0), workers: new Set(entries.map(row => row.subject_name).filter(Boolean)).size, total: entries.length, rejected: entries.filter(row => ['Rejected','Needs Correction'].includes(row.status)).length }), [entries])
  const period = periods.periods.find(row => row.id === selected)
  return <><Header eyebrow="Finance operations" title="Payroll dashboard" description="A single source of truth for OT, temporary-worker timecards and approvals." actions={<><select className="period-select" value={selected} onChange={e => setSelected(e.target.value)}><option value="">Select pay period</option>{periods.periods.map(row => <option key={row.id} value={row.id}>{periodLabel(row)}</option>)}</select><button className="primary-button" onClick={() => navigate('new-temp')}>+ New timecard</button></>} />
    {error && <div className="form-error">{error}</div>}
    {periods.loading ? <div className="dashboard-loading">Loading pay period data…</div> : <>
      <div className="selected-period"><span>Selected pay period</span><strong>{period ? periodLabel(period) : 'No pay period created yet'}</strong><StatusBadge status={period?.status || 'Open'} /></div>
      <div className="stat-grid"><StatCard label="Pending Approvals" value={metrics.pending} tone="pink" /><StatCard label="Regular Hours" value={moneyHours(metrics.regular)} tone="blue" /><StatCard label="OT Hours" value={moneyHours(metrics.ot)} tone="gold" /><StatCard label="DT Hours" value={moneyHours(metrics.dt)} tone="pink" /><StatCard label="Temp Workers" value={metrics.workers} tone="blue" /><StatCard label="Total Submissions" value={metrics.total} tone="green" /><StatCard label="Rejected / Correction" value={metrics.rejected} tone="red" /></div>
      {!periods.periods.length ? <Empty title="Create your first pay period" text="Payroll or Admin must create a valid pay period before timecards can be submitted." /> : <>
        <div className="dashboard-grid"><Panel title="Hours at a glance" subtitle="For the selected pay period"><div className="hours-visual"><div><span>Regular</span><strong>{moneyHours(metrics.regular)}</strong></div><div><span>OT</span><strong>{moneyHours(metrics.ot)}</strong></div><div><span>DT</span><strong>{moneyHours(metrics.dt)}</strong></div><div><span>Total</span><strong>{moneyHours(metrics.regular + metrics.ot + metrics.dt)}</strong></div></div></Panel><Panel title="Workflow status" subtitle="Keep approvals moving"><StatusSummary entries={entries} /></Panel></div>
        <Panel title="Recent submissions" subtitle="Click a record to see approval history" action={<button className="text-button" onClick={() => navigate('entries')}>View all →</button>}>{entries.length ? <EntryTable entries={entries.slice(0, 8)} navigate={navigate} user={user} /> : <Empty title="No submissions for this period" text="Use the New timecard button to start the workflow." />}</Panel>
      </>}
    </>}  </>
}

function StatusSummary({ entries }) { const statuses = ['Pending Approval', 'Approved', 'Needs Correction', 'Processed']; return <div className="status-summary">{statuses.map(status => <div key={status}><StatusBadge status={status} /><strong>{entries.filter(row => row.status === status).length}</strong></div>)}</div> }

function EntriesPage({ user, navigate, type }) {
  const periods = usePeriods(); const lookups = useLookups(); const [entries, setEntries] = useState(null); const [q, setQ] = useState(''); const [status, setStatus] = useState(type === 'approvals' ? 'Pending Approval' : ''); const [periodId, setPeriodId] = useState(''); const [error, setError] = useState('')
  async function load() { try { const params = new URLSearchParams({ user_role: user.role, user_name: user.name }); if (q) params.set('q', q); if (status) params.set('status', status); if (periodId) params.set('pay_period_id', periodId); if (type === 'temp') params.set('entry_type', 'Temp Timecard'); else if (type === 'all') {} const data = await apiJson(`/api/time-entries?${params}`); setEntries(data.entries || []) } catch (err) { setError(err.message) } }
  useEffect(() => { load() }, [q, status, periodId, type, user])
  const title = type === 'temp' ? 'Temp Agency Timecards' : type === 'approvals' ? 'Pending Approvals' : 'OT Submissions'
  const eyebrow = type === 'approvals' ? 'Supervisor review queue' : 'Time entry records'
  return <><Header eyebrow={eyebrow} title={title} description={type === 'approvals' ? 'Review, approve, reject or request corrections without searching Slack.' : 'Search and filter every OT and temporary-worker payroll submission.'} actions={<><button className="secondary-button" onClick={() => navigate(type === 'temp' ? 'new-temp' : 'new-ot')}>+ {type === 'temp' ? 'New temp timecard' : 'New OT submission'}</button></>} />
    {error && <div className="form-error">{error}</div>}
    <div className="filter-bar"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search worker, agency, department, supervisor or submission #" /><select value={periodId} onChange={e => setPeriodId(e.target.value)}><option value="">All pay periods</option>{periods.periods.map(row => <option key={row.id} value={row.id}>{periodLabel(row)}</option>)}</select><select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{STATUS_OPTIONS.map(item => <option key={item}>{item}</option>)}</select></div>
    {entries === null ? <Loading /> : entries.length ? <Panel title={`${entries.length} record(s)`} subtitle="Hours are stored as 0 when no OT or DT was entered."><EntryTable entries={entries} navigate={navigate} user={user} onReload={load} /></Panel> : <Empty title="No matching submissions" text="Try a different filter or create a new timecard." />}
  </>
}

function EntryTable({ entries, navigate, user, onReload }) {
  async function update(entry, status) {
    let comment = ''
    if (status === 'Rejected' || status === 'Needs Correction') { comment = window.prompt(status === 'Rejected' ? 'Reason for rejection:' : 'What needs correction?') || ''; if (!comment) return }
    try { await apiJson('/api/time-entries', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withUser(user, { id: entry.id, status, comment })) }); onReload?.() } catch (err) { window.alert(err.message) }
  }
  return <div className="table-wrap"><table className="data-table"><thead><tr>{['Submission', 'Worker / Employee', 'Type', 'Department', 'Pay Period', 'Regular', 'OT', 'DT', 'Total', 'Status', 'Submitted', 'Actions'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{entries.map(entry => <tr key={entry.id} onClick={() => navigate(`entry:${entry.id}`)}><td className="strong-cell">{entry.submission_number}</td><td><strong>{entry.subject_name || '—'}</strong><small>{entry.entry_type === 'Temp Timecard' ? entry.agency_label : 'Employee OT'}</small></td><td>{entry.entry_type}</td><td>{entry.department_label}</td><td>{entry.period_label}</td><td>{moneyHours(entry.regular_hours)}</td><td>{moneyHours(entry.overtime_hours)}</td><td>{moneyHours(entry.double_time_hours)}</td><td className="strong-cell">{moneyHours(totalHours(entry))}</td><td><StatusBadge status={entry.status} /></td><td>{dateTime(entry.created_at)}</td><td onClick={e => e.stopPropagation()}><div className="row-actions"><button className="icon-action" onClick={() => navigate(`entry:${entry.id}`)}>View</button><button className="icon-action" onClick={() => generateTimecardPdf(entry)}>PDF</button>{['Supervisor','Payroll','Admin'].includes(user.role) && ['Pending Approval','Submitted'].includes(entry.status) && <button className="icon-action approve" onClick={() => update(entry, 'Approved')}>Approve</button>}{['Supervisor','Payroll','Admin'].includes(user.role) && ['Pending Approval','Submitted'].includes(entry.status) && <button className="icon-action danger" onClick={() => update(entry, 'Needs Correction')}>Return</button>}</div></td></tr>)}</tbody></table></div>
}

function EntryForm({ user, initialType, navigate, setToast }) {
  const lookups = useLookups(); const periods = usePeriods(); const [form, setForm] = useState({ ...EMPTY_FORM, entry_type: initialType, work_days: [{ date: '', regular_hours: '0', overtime_hours: '0', double_time_hours: '0' }] }); const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  const availablePeriods = periods.periods.filter(row => !row.period_type || row.period_type === initialType)
  const selectedWorker = lookups.workers.find(row => row.id === form.temp_worker_id)
  function setWorker(value) {
    const match = lookups.workers.find(row => row.status === 'Active' && row.name === value)
    setForm(current => ({ ...current, temp_worker_name_snapshot: value, temp_worker_id: match ? match.id : '' }))
  }
  useEffect(() => { if ((!form.pay_period_id || !availablePeriods.some(row => row.id === form.pay_period_id)) && availablePeriods[0]) setForm(value => ({ ...value, pay_period_id: availablePeriods[0].id })) }, [availablePeriods, form.pay_period_id])
  useEffect(() => {
    if (!form.pay_period_id) return
    const period = availablePeriods.find(row => row.id === form.pay_period_id)
    if (!period) return
    setForm(value => ({ ...value, work_days: value.work_days.map((day, index) => index === 0 && !day.date ? { ...day, date: period.start_date } : day) }))
  }, [form.pay_period_id, availablePeriods])
  useEffect(() => { if (user.role === 'Supervisor' && !form.supervisor_name) setForm(value => ({ ...value, supervisor_name: user.name })) }, [user.role, user.name, form.supervisor_name])
  useEffect(() => { if (selectedWorker && form.entry_type === 'Temp Timecard') setForm(value => ({ ...value, temp_agency_id: selectedWorker.agency_id || value.temp_agency_id, department_id: selectedWorker.department_id || value.department_id, supervisor_name: selectedWorker.supervisor_name || value.supervisor_name })) }, [selectedWorker?.id])
  function set(key, value) { setForm(current => ({ ...current, [key]: value })) }
  function updateDay(index, key, value) { setForm(current => ({ ...current, work_days: current.work_days.map((day, i) => i === index ? { ...day, [key]: value } : day) })) }
  function removeDay(index) { setForm(current => ({ ...current, work_days: current.work_days.length > 1 ? current.work_days.filter((_, i) => i !== index) : current.work_days })) }
  function addDay() {
    setForm(current => {
      if (current.work_days.length >= 62) return current
      const rows = current.work_days
      const last = rows[rows.length - 1]
      let date = ''
      if (last?.date && selectedPeriod) {
        const next = new Date(`${last.date}T00:00:00Z`)
        next.setUTCDate(next.getUTCDate() + 1)
        const nextIso = next.toISOString().slice(0, 10)
        if (nextIso <= selectedPeriod.end_date) date = nextIso
      }
      return { ...current, work_days: [...rows, { date, regular_hours: '0', overtime_hours: '0', double_time_hours: '0' }] }
    })
  }
  async function submit(saveAsDraft) {
    const dates = form.work_days.map(day => day.date)
    if (dates.some(date => !date)) { setError('Add a date for every work day.'); return }
    if (new Set(dates).size !== dates.length) { setError('Each work day must have a unique date.'); return }
    setSaving(true); setError('')
    try {
      const data = await apiJson('/api/time-entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withUser(user, { ...form, save_as_draft: saveAsDraft })) })
      setToast(saveAsDraft ? 'Draft saved successfully.' : `${data.entry.submission_number} submitted for approval.`)
      navigate(`entry:${data.entry.id}`)
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }
  const selectedPeriod = availablePeriods.find(row => row.id === form.pay_period_id)
  const dayTotals = form.work_days.reduce((sum, day) => ({ regular: sum.regular + Number(day.regular_hours || 0), ot: sum.ot + Number(day.overtime_hours || 0), dt: sum.dt + Number(day.double_time_hours || 0) }), { regular: 0, ot: 0, dt: 0 })
  return <><Header eyebrow="New submission" title={initialType === 'Temp Timecard' ? 'New temp agency timecard' : 'New employee OT submission'} description="Enter each work day's hours. The app will validate the pay period, calculate the totals and start the approval workflow." actions={<button className="secondary-button" onClick={() => navigate(initialType === 'Temp Timecard' ? 'temp' : 'entries')}>← Back</button>} />
    {error && <div className="form-error">{error}</div>}
    {!availablePeriods.length && !periods.loading && <div className="form-error">No {initialType === 'Temp Timecard' ? 'Mon–Sun Temp' : 'Tue–Mon OT'} pay period exists yet. Ask Payroll or Admin to generate the weekly periods first.</div>}
    <div className="form-layout"><form className="entry-form" onSubmit={e => { e.preventDefault(); submit(false) }}>
      <FormSection number="01" title="Pay period & internal details" hint="The pay period controls the valid date range for your work days. Supervisor = the worker's actual supervisor, who approves this timecard."><div className="form-grid two"><Select label="Pay Period" value={form.pay_period_id} onChange={value => set('pay_period_id', value)} options={availablePeriods.map(row => ({ value: row.id, label: `${periodLabel(row)} · ${row.status}` }))} required /><Select label="Department" value={form.department_id} onChange={value => set('department_id', value)} options={lookups.departments.filter(row => row.status === 'Active').map(row => ({ value: row.id, label: `${row.name}${row.code ? ` (${row.code})` : ''}` }))} required /><Select label="Supervisor" value={form.supervisor_name} onChange={value => set('supervisor_name', value)} options={(user.role === 'Supervisor' && !lookups.supervisors.includes(user.name) ? [...lookups.supervisors, user.name] : lookups.supervisors).map(row => ({ value: row, label: row }))} required /></div></FormSection>
      <FormSection number="02" title={initialType === 'Temp Timecard' ? 'Temporary worker details' : 'Employee details'} hint={initialType === 'Temp Timecard' ? 'Type the worker name — registered workers show suggestions and auto-fill; one-day or two-day workers can be typed in directly.' : 'Choose the employee connected to this OT submission.'}>{initialType === 'Temp Timecard' ? <div className="form-grid two"><Select label="Temp Agency" value={form.temp_agency_id} onChange={value => set('temp_agency_id', value)} options={lookups.agencies.filter(row => row.status === 'Active').map(row => ({ value: row.id, label: row.name }))} required /><TypeaheadInput label="Temp Worker" value={form.temp_worker_name_snapshot} onChange={setWorker} options={lookups.workers.filter(row => row.status === 'Active').map(row => row.name)} placeholder="Type a name (suggestions appear)" required /><Input label="Agency Worker ID" value={form.agency_worker_id} onChange={value => set('agency_worker_id', value)} /><Input label="Assignment / Location" value={form.assignment_location} onChange={value => set('assignment_location', value)} /><Input label="Job / Role" value={form.job_role} onChange={value => set('job_role', value)} /></div> : <div className="form-grid two"><Select label="Employee" value={form.employee_id} onChange={value => set('employee_id', value)} options={lookups.employees.filter(row => row.status === 'Active').map(row => ({ value: row.id, label: row.name }))} required /><Input label="Assignment / Location" value={form.assignment_location} onChange={value => set('assignment_location', value)} /></div>}</FormSection>
      <FormSection number="03" title="Work days & hours" hint="Add every day worked with its own hours — any value like 7.4 or 7.83 is allowed (2 decimals). The weekly totals calculate automatically.">
        <div className="work-day-list">{form.work_days.map((day, index) => <div className="work-day-row" key={index}>
          <Input label="Date" type="date" value={day.date} min={selectedPeriod?.start_date} max={selectedPeriod?.end_date} onChange={value => updateDay(index, 'date', value)} />
          <Input label="Regular" type="number" min="0" step="0.01" value={day.regular_hours} onChange={value => updateDay(index, 'regular_hours', value)} />
          <Input label="OT" type="number" min="0" step="0.01" value={day.overtime_hours} onChange={value => updateDay(index, 'overtime_hours', value)} />
          <Input label="DT" type="number" min="0" step="0.01" value={day.double_time_hours} onChange={value => updateDay(index, 'double_time_hours', value)} />
          <button type="button" className="day-remove" onClick={() => removeDay(index)} disabled={form.work_days.length === 1} title="Remove this day">×</button>
        </div>)}</div>
        <button type="button" className="add-day-button" onClick={addDay}>+ Add day</button>
        <div className="day-totals"><div><span>Regular</span><strong>{moneyHours(dayTotals.regular)}</strong></div><div><span>OT</span><strong>{moneyHours(dayTotals.ot)}</strong></div><div><span>DT</span><strong>{moneyHours(dayTotals.dt)}</strong></div><div className="grand"><span>Weekly Total</span><strong>{moneyHours(dayTotals.regular + dayTotals.ot + dayTotals.dt)}</strong></div></div>
        <Input label="Reason for OT" value={form.reason_for_ot} onChange={value => set('reason_for_ot', value)} /><TextArea label="Notes" value={form.notes} onChange={value => set('notes', value)} placeholder="Add context, such as submitting on behalf of someone else." /></FormSection>
      <FormSection number="04" title="Submitting on behalf of someone" hint="'Submitted By' is you — the person filling this form. Supervisor (section 01) is the worker's actual supervisor; the two are independent. Use this section only when submitting for someone else."><div className="form-grid two"><Select label="Submitting on behalf of" value={form.submitted_on_behalf_of} onChange={value => set('submitted_on_behalf_of', value)} options={['Myself', 'Another Employee', 'Another Supervisor'].map(value => ({ value, label: value }))} /><Input label="Person represented" value={form.representing_name} onChange={value => set('representing_name', value)} /><TextArea label="Reason / notes" value={form.representation_reason} onChange={value => set('representation_reason', value)} /></div></FormSection>
      <div className="form-footer"><label className="checkbox"><input type="checkbox" checked={form.confirm_zero_hours} onChange={e => set('confirm_zero_hours', e.target.checked)} /> I confirm these hours are correct, including when the total is 0.</label><div className="form-buttons"><button type="button" className="secondary-button" disabled={saving} onClick={() => submit(true)}>Save Draft</button><button className="primary-button" disabled={saving || !availablePeriods.length}>{saving ? 'Saving…' : 'Submit for approval →'}</button></div></div>
    </form><aside className="form-side"><Panel title="Submission checklist"><Checklist items={['Valid pay period selected', 'Department and supervisor selected', initialType === 'Temp Timecard' ? 'Agency and worker selected' : 'Employee selected', 'Each work day has its hours', 'Reason or notes added when needed']} /></Panel><Panel title="Selected period"><strong>{selectedPeriod ? periodLabel(selectedPeriod) : 'Choose a period'}</strong><p className="muted">{selectedPeriod?.status || '—'}</p></Panel></aside></div>
  </>
}

function FormSection({ number, title, hint, children }) { return <section className="form-section"><div className="section-heading"><span>{number}</span><div><h2>{title}</h2><p>{hint}</p></div></div>{children}</section> }
function Checklist({ items }) { return <ul className="checklist">{items.map(item => <li key={item}><span>✓</span>{item}</li>)}</ul> }
function Input({ label, value, onChange, type = 'text', required = false, ...props }) { return <label className="field"><span>{label}{required && <b>*</b>}</span><input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} required={required} {...props} /></label> }
function TextArea({ label, value, onChange, ...props }) { return <label className="field"><span>{label}</span><textarea value={value ?? ''} onChange={e => onChange(e.target.value)} rows="3" {...props} /></label> }
function Select({ label, value, onChange, options, required = false }) { return <label className="field"><span>{label}{required && <b>*</b>}</span><select value={value ?? ''} onChange={e => onChange(e.target.value)} required={required}><option value="">Select {label.toLowerCase()}</option>{options.map(option => typeof option === 'string' ? <option key={option}>{option}</option> : <option key={option.value} value={option.value}>{option.label}</option>)}</select></label> }
function TypeaheadInput({ label, value, onChange, options = [], required = false, placeholder = '' }) { const listId = `datalist-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`; return <label className="field"><span>{label}{required && <b>*</b>}</span><input list={listId} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required} /><datalist id={listId}>{options.map(option => <option key={option} value={option} />)}</datalist></label> }

function EntryDetail({ id, user, navigate, setToast }) {
  const [entry, setEntry] = useState(null); const [auditRows, setAuditRows] = useState([]); const [error, setError] = useState(''); const [comment, setComment] = useState('')
  async function load() { try { const data = await apiJson(`/api/time-entries?id=${encodeURIComponent(id)}`); setEntry(data.entry); setAuditRows((await apiJson(`/api/audit?time_entry_id=${encodeURIComponent(id)}`)).logs || []) } catch (err) { setError(err.message) } }
  useEffect(() => { load() }, [id])
  async function changeStatus(status) { if (['Rejected','Needs Correction'].includes(status) && !comment.trim()) { setError('Add a comment before returning this submission.'); return } try { const data = await apiJson('/api/time-entries', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withUser(user, { id, status, comment })) }); setEntry(data.entry); setComment(''); setToast(`Submission updated to ${data.entry.status}.`); load() } catch (err) { setError(err.message) } }
  async function prepareQuickBooks() { try { const data = await apiJson('/api/quickbooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withUser(user, { id })) }); setToast(data.message || 'QuickBooks export prepared.'); load() } catch (err) { setError(err.message) } }
  if (error && !entry) return <div className="form-error">{error}</div>
  if (!entry) return <Loading />
  const subject = entry.subject_name || '—'
  const canApprove = ['Supervisor','Payroll','Admin'].includes(user.role) && ['Pending Approval','Submitted'].includes(entry.status)
  const canProcess = ['Payroll','Admin'].includes(user.role) && entry.status === 'Approved'
  return <><Header eyebrow="Submission detail" title={entry.submission_number} description={`${entry.entry_type} · ${subject}`} actions={<button className="secondary-button" onClick={() => navigate('entries')}>← Back to submissions</button>} />
    {error && <div className="form-error">{error}</div>}
    <div className="detail-grid"><div className="detail-main"><div className="detail-status-bar"><StatusBadge status={entry.status} /><span>Created {dateTime(entry.created_at)}</span><span>Pay period {entry.period_label}</span></div><div className="detail-info-grid"><Info label="Department" value={entry.department_label} /><Info label="Supervisor" value={entry.supervisor_name} /><Info label="Submitted By" value={entry.submitted_by_name} /><Info label="On Behalf Of" value={entry.submitted_on_behalf_of || 'Myself'} /><Info label="Agency / Employer" value={entry.agency_label || 'Employee'} /><Info label={entry.work_end_date && entry.work_end_date !== entry.work_date ? 'Work Dates' : 'Work Date'} value={entry.work_end_date && entry.work_end_date !== entry.work_date ? `${dateLabel(entry.work_date)} → ${dateLabel(entry.work_end_date)}` : dateLabel(entry.work_date)} /></div><Panel title="Worker / employee"><div className="worker-card"><div className="worker-avatar">{subject.slice(0, 1).toUpperCase()}</div><div><h2>{subject}</h2><p>{entry.entry_type === 'Temp Timecard' ? `${entry.agency_label} · ${entry.worker_id_snapshot || 'No worker ID'}` : 'Employee OT submission'}</p></div></div></Panel><Panel title="Hours"><div className="detail-hours"><Info label="Regular" value={moneyHours(entry.regular_hours)} /><Info label="OT" value={moneyHours(entry.overtime_hours)} /><Info label="DT" value={moneyHours(entry.double_time_hours)} /><Info label="Total" value={moneyHours(totalHours(entry))} /></div>{Array.isArray(entry.work_days) && entry.work_days.length > 0 && <div className="day-breakdown"><div className="day-breakdown-head"><span>Date</span><span>Regular</span><span>OT</span><span>DT</span></div>{entry.work_days.map(day => <div className="day-breakdown-row" key={day.date}><span>{dateLabel(day.date)}</span><span>{moneyHours(day.regular_hours)}</span><span>{moneyHours(day.overtime_hours)}</span><span>{moneyHours(day.double_time_hours)}</span></div>)}</div>}</Panel><Panel title="Notes"><p className="detail-notes">{entry.notes || entry.reason_for_ot || 'No notes added.'}</p>{entry.rejection_comment && <div className="correction-note"><strong>Review comment</strong><p>{entry.rejection_comment}</p></div>}</Panel></div><aside className="detail-side"><Panel title="Actions"><button className="wide-action" onClick={() => generateTimecardPdf(entry)}>Download PDF</button><button className="wide-action" onClick={() => generateTimecardImage(entry).catch(err => window.alert(err.message))}>Download Image</button>{canApprove && <button className="wide-action approve" onClick={() => changeStatus('Approved')}>Approve submission</button>}{canApprove && <TextArea label="Review comment" value={comment} onChange={setComment} placeholder="Required for rejection or correction." />}{canApprove && <div className="split-actions"><button className="wide-action danger" onClick={() => changeStatus('Rejected')}>Reject</button><button className="wide-action" onClick={() => changeStatus('Needs Correction')}>Request correction</button></div>}{canProcess && <button className="wide-action blue" onClick={() => changeStatus('Processed')}>Mark processed</button>}{['Payroll','Admin'].includes(user.role) && ['Approved','Processed'].includes(entry.status) && <button className="wide-action" onClick={prepareQuickBooks}>Prepare QuickBooks export</button>}</Panel><Panel title="Audit history"><div className="timeline">{auditRows.length ? auditRows.map(row => <div className="timeline-entry" key={row.id}><strong>{row.action}</strong><span>{dateTime(row.created_at)} · {row.user_name}</span>{row.comment && <p>{row.comment}</p>}</div>) : <span className="muted">No audit entries.</span>}</div></Panel></aside></div>
  </>
}
function Info({ label, value }) { return <div className="info-cell"><span>{label}</span><strong>{value || '—'}</strong></div> }

function PayPeriodsPage({ user }) {
  const { periods, reload, error } = usePeriods()
  const [showForm, setShowForm] = useState(false)
  const [year, setYear] = useState(new Date().getFullYear())
  const [generating, setGenerating] = useState(false)
  const [form, setForm] = useState({ period_type: 'Temp Timecard', start_date: '', end_date: '', submission_deadline: '', payroll_processing_date: '', notes: '' })
  const [message, setMessage] = useState('')
  async function generateYear() {
    setGenerating(true); setMessage('')
    try {
      const data = await apiJson('/api/pay-periods', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withUser(user, { generate_year: Number(year) })) })
      setMessage(`${data.created || 0} periods created for ${year}. ${data.skipped || 0} already existed.${data.converted ? ` ${data.converted} old Mon–Fri week(s) extended to Sunday.` : ''}`)
      reload()
    } catch (err) { setMessage(err.message) } finally { setGenerating(false) }
  }
  async function create(event) {
    event.preventDefault(); setMessage('')
    try {
      await apiJson('/api/pay-periods', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withUser(user, form)) })
      setForm({ period_type: 'Temp Timecard', start_date: '', end_date: '', submission_deadline: '', payroll_processing_date: '', notes: '' })
      setShowForm(false); setMessage('Pay period created.'); reload()
    } catch (err) { setMessage(err.message) }
  }
  return <><Header eyebrow="Payroll calendar" title="Pay periods" description="Generate the weekly dropdowns once, then select the correct schedule in each submission." actions={['Admin','Payroll'].includes(user.role) && <><input className="year-input" type="number" min="2020" max="2100" value={year} onChange={e => setYear(e.target.value)} /><button className="primary-button" disabled={generating} onClick={generateYear}>{generating ? 'Generating…' : `Generate ${year} weeks`}</button><button className="secondary-button" onClick={() => setShowForm(value => !value)}>+ Custom period</button></>} />
    <div className="schedule-note"><div><strong>Temp timecards</strong><span>Monday → Sunday · 52 weekly periods</span></div><div><strong>Employee OT</strong><span>Tuesday → Monday · 52 weekly periods</span></div><div><strong>Dropdowns</strong><span>Forms only show the matching schedule</span></div></div>
    {error && <div className="form-error">{error}</div>}{message && <div className="inline-message">{message}</div>}
    {showForm && <form className="panel compact-form" onSubmit={create}><div className="form-grid three"><Select label="Period type" value={form.period_type} onChange={value => setForm({ ...form, period_type: value })} options={['Temp Timecard','Employee OT']} required /><Input label="Start date" type="date" value={form.start_date} onChange={value => setForm({ ...form, start_date: value })} required /><Input label="End date" type="date" value={form.end_date} min={form.start_date} onChange={value => setForm({ ...form, end_date: value })} required /></div><div className="form-grid two"><Input label="Payroll processing date" type="date" value={form.payroll_processing_date} onChange={value => setForm({ ...form, payroll_processing_date: value })} /><Input label="Submission deadline" type="datetime-local" value={form.submission_deadline} onChange={value => setForm({ ...form, submission_deadline: value })} /></div><TextArea label="Notes" value={form.notes} onChange={value => setForm({ ...form, notes: value })} /><button className="primary-button">Create pay period</button></form>}
    <Panel title={`${periods.length} pay period(s)`} subtitle="The app prevents an end date earlier than the start date."><div className="period-cards">{periods.map(period => <div className="period-card" key={period.id}><div><strong>{periodLabel(period)}</strong><span>{period.period_type === 'Employee OT' ? 'OT schedule: ' : 'Temp schedule: '}{weekdayFull(period.start_date)}–{weekdayFull(period.end_date)}</span><span>Deadline {period.submission_deadline ? dateTime(period.submission_deadline) : 'Not set'} · Payroll {period.payroll_processing_date || 'Not set'}</span></div><StatusBadge status={period.status} /></div>)}</div>{!periods.length && <Empty title="No pay periods yet" text="Generate the weekly periods above to populate every submission dropdown." />}</Panel>
  </>
}
function DirectoryPage({ user, entity, title }) {
  const lookups = useLookups(); const [showForm, setShowForm] = useState(false); const [name, setName] = useState(''); const [message, setMessage] = useState(''); const [deletingId, setDeletingId] = useState(null); const [togglingId, setTogglingId] = useState(null)
  const rows = entity === 'departments' ? lookups.departments : entity === 'agencies' ? lookups.agencies : entity === 'workers' ? lookups.workers : entity === 'supervisors' ? (lookups.supervisor_records || []) : lookups.employees
  async function addRecord(event) { event.preventDefault(); try { const record = entity === 'departments' ? { name, status: 'Active' } : entity === 'agencies' ? { name, status: 'Active' } : entity === 'workers' ? { name, status: 'Active' } : { name, status: 'Active' }; await apiJson('/api/lookups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withUser(user, { entity, record })) }); setName(''); setShowForm(false); setMessage('Record added.'); lookups.reload() } catch (err) { setMessage(err.message) } }
  async function toggleStatus(row) {
    const next = row.status === 'Active' ? 'Inactive' : 'Active'
    setTogglingId(row.id); setMessage('')
    try {
      await apiJson('/api/lookups', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withUser(user, { entity, id: row.id, record: { status: next } })) })
      setMessage(`"${row.name}" is now ${next}.`)
      lookups.reload()
    } catch (err) { setMessage(err.message) } finally { setTogglingId(null) }
  }
  async function removeRecord(row) {
    const label = row.name || 'this record'
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return
    setDeletingId(row.id); setMessage('')
    try {
      await apiJson('/api/lookups', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withUser(user, { entity, id: row.id })) })
      setMessage(`"${label}" deleted.`)
      lookups.reload()
    } catch (err) { setMessage(err.message) } finally { setDeletingId(null) }
  }
  return <><Header eyebrow="Directory management" title={title} description="Keep the worker, agency, department and employee directories clean for accurate payroll records." actions={user.role === 'Admin' && <button className="primary-button" onClick={() => setShowForm(value => !value)}>+ Add {title.slice(0, -1)}</button>} />
    {message && <div className="inline-message">{message}</div>}{showForm && <form className="panel compact-form" onSubmit={addRecord}><Input label={`${title.slice(0, -1)} name`} value={name} onChange={setName} required /><button className="primary-button">Save record</button></form>}
    <Panel title={`${rows.length} active record(s)`}>{rows.length ? <div className="directory-grid">{rows.map(row => <div className="directory-card" key={row.id}><div className="directory-avatar">{String(row.name || '—').slice(0, 1).toUpperCase()}</div><div><strong>{row.name}</strong><span>{row.status || 'Active'}{row.worker_id ? ` · ${row.worker_id}` : ''}{row.supervisor_name ? ` · ${row.supervisor_name}` : ''}{row.code ? ` · ${row.code}` : ''}</span></div><StatusBadge status={row.status || 'Active'} />{user.role === 'Admin' && <button type="button" className="directory-toggle" disabled={togglingId === row.id} onClick={() => toggleStatus(row)} title={row.status === 'Active' ? 'Hide from dropdowns without deleting' : 'Show in dropdowns again'}>{togglingId === row.id ? 'Saving…' : row.status === 'Active' ? 'Deactivate' : 'Activate'}</button>}{user.role === 'Admin' && <button type="button" className="directory-delete" disabled={deletingId === row.id} onClick={() => removeRecord(row)}>{deletingId === row.id ? 'Deleting…' : 'Delete'}</button>}</div>)}</div> : <Empty title={`No ${title.toLowerCase()} yet`} />}</Panel>
  </>
}

function PayrollPage({ user, navigate }) {
  const periods = usePeriods(); const [periodId, setPeriodId] = useState(''); const [entries, setEntries] = useState([]); const [error, setError] = useState('')
  useEffect(() => { if (!periodId && periods.periods[0]) setPeriodId(periods.periods[0].id) }, [periods.periods, periodId])
  useEffect(() => { if (!periodId) return; apiJson(`/api/time-entries?pay_period_id=${encodeURIComponent(periodId)}&user_role=${user.role}&user_name=${encodeURIComponent(user.name)}`).then(data => setEntries(data.entries || [])).catch(err => setError(err.message)) }, [periodId, user])
  const metrics = { employees: new Set(entries.filter(row => row.entry_type === 'Employee OT').map(row => row.subject_name)).size, workers: new Set(entries.filter(row => row.entry_type === 'Temp Timecard').map(row => row.subject_name)).size, regular: entries.reduce((sum, row) => sum + Number(row.regular_hours || 0), 0), ot: entries.reduce((sum, row) => sum + Number(row.overtime_hours || 0), 0), dt: entries.reduce((sum, row) => sum + Number(row.double_time_hours || 0), 0) }
  function exportCsv() { const headers = ['Submission ID','Pay Period','Worker / Employee','Agency','Department','Supervisor','Regular Hours','OT Hours','DT Hours','Total Hours','Status','Submitted By','Approved By','Approved Date']; const lines = entries.map(row => [row.submission_number,row.period_label,row.subject_name,row.agency_label,row.department_label,row.supervisor_name,row.regular_hours,row.overtime_hours,row.double_time_hours,totalHours(row),row.status,row.submitted_by_name,row.approved_by_name || '',row.approved_at || ''].map(csvCell).join(',')); const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `ksc-payroll-${periodId}.csv`; a.click(); URL.revokeObjectURL(url) }
  return <><Header eyebrow="Payroll review" title="Payroll processing" description="Verify approved records, export payroll data and track processed status." actions={<><select className="period-select" value={periodId} onChange={e => setPeriodId(e.target.value)}><option value="">Select pay period</option>{periods.periods.map(row => <option key={row.id} value={row.id}>{periodLabel(row)}</option>)}</select><button className="secondary-button" onClick={exportCsv}>Export CSV</button></>} />{error && <div className="form-error">{error}</div>}<div className="stat-grid"><StatCard label="Employees" value={metrics.employees} /><StatCard label="Temp Workers" value={metrics.workers} tone="blue" /><StatCard label="Regular Hours" value={moneyHours(metrics.regular)} tone="green" /><StatCard label="OT Hours" value={moneyHours(metrics.ot)} tone="gold" /><StatCard label="DT Hours" value={moneyHours(metrics.dt)} tone="pink" /><StatCard label="Total Hours" value={moneyHours(metrics.regular + metrics.ot + metrics.dt)} /></div><Panel title="Payroll records" subtitle="Only Payroll/Admin can mark approved records as processed.">{entries.length ? <EntryTable entries={entries} navigate={navigate} user={user} /> : <Empty title="No payroll records for this period" />}</Panel></>
}
function csvCell(value) { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text }

function ReportsPage({ user }) {
  const periods = usePeriods(); const [periodId, setPeriodId] = useState(''); const [entries, setEntries] = useState([])
  useEffect(() => { if (!periodId && periods.periods[0]) setPeriodId(periods.periods[0].id) }, [periods.periods, periodId])
  useEffect(() => { if (periodId) apiJson(`/api/time-entries?pay_period_id=${periodId}&user_role=${user.role}&user_name=${encodeURIComponent(user.name)}`).then(data => setEntries(data.entries || [])) }, [periodId, user])
  const byDepartment = Object.entries(entries.reduce((map, row) => { const key = row.department_label || 'Unknown'; map[key] = (map[key] || 0) + totalHours(row); return map }, {})).sort((a, b) => b[1] - a[1])
  return <><Header eyebrow="Management reporting" title="Payroll reports" description="See labor hours by department, agency and status." actions={<select className="period-select" value={periodId} onChange={e => setPeriodId(e.target.value)}><option value="">Select pay period</option>{periods.periods.map(row => <option key={row.id} value={row.id}>{periodLabel(row)}</option>)}</select>} /><div className="dashboard-grid"><Panel title="Hours by department"><Bars rows={byDepartment} /></Panel><Panel title="Status breakdown"><Bars rows={Object.entries(entries.reduce((map, row) => { map[row.status] = (map[row.status] || 0) + 1; return map }, {}))} count /></Panel></div><Panel title="Agency summary"><Bars rows={Object.entries(entries.reduce((map, row) => { const key = row.agency_label || 'Employees'; map[key] = (map[key] || 0) + totalHours(row); return map }, {}))} /></Panel></>
}
function Bars({ rows, count = false }) { const max = Math.max(...rows.map(row => row[1]), 1); return rows.length ? <div className="bars">{rows.map(([label, value]) => <div className="bar-row" key={label}><div className="bar-label"><span>{label}</span><strong>{count ? value : moneyHours(value)}{count ? ' record(s)' : ' hours'}</strong></div><div className="bar-track"><i style={{ width: `${Math.max(5, value / max * 100)}%` }} /></div></div>)}</div> : <p className="muted">No data for this period.</p> }

function AuditPage() { const [logs, setLogs] = useState(null); useEffect(() => { apiJson('/api/audit').then(data => setLogs(data.logs || [])).catch(() => setLogs([])) }, []); return <><Header eyebrow="Accountability" title="Audit log" description="Every create, edit, approval, correction, PDF and payroll action is recorded." />{logs === null ? <Loading /> : <Panel title={`${logs.length} audit events`}><div className="audit-list">{logs.map(row => <div className="audit-row" key={row.id}><div className="audit-dot" /><div><strong>{row.action}</strong><span>{row.user_name} · {row.user_role || 'System'} · {dateTime(row.created_at)}</span>{row.comment && <p>{row.comment}</p>}</div><small>{row.time_entry_id ? 'Time entry linked' : 'System event'}</small></div>)}</div>{!logs.length && <Empty />}</Panel>}</> }
