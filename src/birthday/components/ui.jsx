import { useEffect, useState } from 'react'

export function Modal({ eyebrow, title, onClose, children, wide = false }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="close" onClick={onClose} aria-label="Close">×</button>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

// Mandatory confirmation before a risky action. Optional checkbox forces an explicit "yes".
export function ConfirmDialog({ eyebrow = 'Please confirm', title, message, confirmLabel, requireCheck, checkLabel, danger = false, busy = false, onConfirm, onCancel }) {
  const [checked, setChecked] = useState(!requireCheck)
  return (
    <div className="modal-backdrop">
      <div className="modal modal-small" role="alertdialog" aria-modal="true" aria-label={title}>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p className="muted">{message}</p>
        {requireCheck && (
          <label className="check-row">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>{checkLabel}</span>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="cancel" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={danger ? 'danger' : 'save'} disabled={!checked || busy} onClick={onConfirm}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Toast({ message, onDone }) {
  useEffect(() => {
    if (!message) return undefined
    const timer = setTimeout(onDone, 4500)
    return () => clearTimeout(timer)
  }, [message, onDone])
  if (!message) return null
  return <div className="toast" role="status">{message}</div>
}

export function Pill({ tone = 'neutral', children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

export function ErrorBox({ children }) {
  if (!children) return null
  return <div className="error">{children}</div>
}
