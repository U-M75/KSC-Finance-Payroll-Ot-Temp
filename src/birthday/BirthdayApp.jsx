// Kawaii HQ: Birthday & Anniversary app shell. Loaded lazily so its styles do not touch Finance.
import { useEffect, useState } from 'react'
import { api } from './lib/api.js'
import OnboardingPage from './modules/onboarding/OnboardingPage.jsx'
import './birthday.css'

export default function BirthdayApp({ token, onLogout }) {
  const [me, setMe] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/api/birthday?route=me', { token })
      .then((data) => setMe(data.me))
      .catch((err) => { setError(err.message); if (err.status === 401) onLogout() })
  }, [token])

  if (error) return <div className="hq-center"><div className="hq-card"><div className="form-error">{error}</div><button className="primary-button" onClick={onLogout}>Back to sign in</button></div></div>
  if (!me) return <div className="hq-center"><div className="hq-card">Loading…</div></div>

  return <div className="hq-birthday">
    <header className="hq-topbar">
      <div><strong>Kawaii HQ</strong> · Birthday & Anniversary</div>
      <div className="hq-who">{me.name} <span className="hq-role">{me.role_label}</span> <button className="hq-signout" onClick={onLogout}>Sign out</button></div>
    </header>
    <main className="hq-main"><OnboardingPage me={me} token={token} /></main>
  </div>
}
