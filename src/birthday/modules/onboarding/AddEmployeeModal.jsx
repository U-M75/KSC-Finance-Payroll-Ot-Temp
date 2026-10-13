import { useEffect, useState } from 'react'
import { api } from '../../lib/api.js'
import { ErrorBox, Modal } from '../../components/ui.jsx'
import { EMPLOYEE_TYPES } from '../../lib/format.js'

// Manual add: search Slack by username or email, pick a person, and send the onboarding form to their DM.
export default function AddEmployeeModal({ token, canSetJoining, onClose, onAdded }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState(null)
  const [employeeType, setEmployeeType] = useState('')
  const [joiningDate, setJoiningDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Debounced Slack user search.
  useEffect(() => {
    if (picked || query.trim().length < 2) {
      setResults([])
      return undefined
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const data = await api(`/api/birthday?route=onboarding&action=slack_search&q=${encodeURIComponent(query.trim())}`, { token })
        setResults(data.results || [])
        setError('')
      } catch (err) {
        setError(err.message)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, picked, token])

  async function submit(event) {
    event.preventDefault()
    if (!picked) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const data = await api('/api/birthday?route=onboarding', {
        method: 'POST',
        token,
        body: {
          action: 'add',
          slack_user_id: picked.slack_user_id,
          employee_type: employeeType || undefined,
          joining_date: joiningDate || undefined,
        },
      })
      if (data.dispatch?.sent) {
        onAdded(`Onboarding form sent to ${picked.full_name}.`)
      } else {
        // Record is saved, but the DM was not sent. Show why so HR can fix it.
        setNotice(`${picked.full_name} was saved. ${data.dispatch?.reason || 'The form was not sent.'}`)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal eyebrow="Manual onboarding" title="Add an employee" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBox>{error}</ErrorBox>
        {notice && <div className="notice">{notice}</div>}

        {!picked ? (
          <>
            <label>
              Find a Slack user
              <input autoFocus placeholder="Type a name, @username or email" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            {searching && <p className="muted small">Searching Slack…</p>}
            {results.length > 0 && (
              <ul className="search-results">
                {results.map((user) => (
                  <li key={user.slack_user_id}>
                    <button type="button" onClick={() => setPicked(user)}>
                      {user.avatar ? <img src={user.avatar} alt="" /> : <span className="avatar-fallback">{user.full_name.slice(0, 1)}</span>}
                      <span>
                        <strong>{user.full_name}</strong>
                        <small>{user.slack_username ? `@${user.slack_username}` : ''} {user.email ? `· ${user.email}` : ''}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!searching && query.trim().length >= 2 && results.length === 0 && <p className="muted small">No matching Slack users.</p>}
          </>
        ) : (
          <div className="picked-user">
            <div>
              <strong>{picked.full_name}</strong>
              <small>{picked.slack_username ? `@${picked.slack_username}` : ''} {picked.email ? `· ${picked.email}` : ''}</small>
            </div>
            <button type="button" className="link-button" onClick={() => setPicked(null)}>Change</button>
          </div>
        )}

        {picked && (
          <div className="form-grid">
            <label className="field">
              <span>Employee type</span>
              <select value={employeeType} onChange={(e) => setEmployeeType(e.target.value)}>
                <option value="">Set later</option>
                {EMPLOYEE_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            {canSetJoining && (
              <label className="field">
                <span>Joining date (HR)</span>
                <input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} />
              </label>
            )}
          </div>
        )}

        <p className="muted small">The form is only sent to people who are members of #ksc-chat-room.</p>

        <div className="modal-actions">
          <button type="button" className="cancel" onClick={onClose}>Cancel</button>
          <button className="save" disabled={!picked || busy}>{busy ? 'Sending…' : 'Save & send form'}</button>
        </div>
      </form>
    </Modal>
  )
}
