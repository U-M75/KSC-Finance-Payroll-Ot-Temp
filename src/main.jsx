import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

const root = createRoot(document.getElementById('root'))

// /onboard is the public Birthday form opened from the Slack DM. It loads on its own so that
// neither the Finance pages nor the login page change.
if (window.location.pathname === '/onboard') {
  import('./birthday/OnboardForm.jsx').then(({ default: OnboardForm }) => {
    root.render(<React.StrictMode><OnboardForm /></React.StrictMode>)
  })
} else {
  root.render(<React.StrictMode><App /></React.StrictMode>)
}
