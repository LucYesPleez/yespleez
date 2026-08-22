// ⚠⚠ FIRST IMPORT, DELIBERATELY. It reads the password-recovery token out of
// the URL before HashRouter can read that same hash as a route and before the
// Supabase client can race it. See lib/passwordRecovery.js — ⛔ do not sort
// this into the list below.
import './lib/passwordRecovery.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SplashScreen from './components/SplashScreen.jsx'
import InAppBrowserWarning from './components/InAppBrowserWarning.jsx'
import { registerServiceWorker } from './lib/registerServiceWorker.js'
import { armInstallPrompt } from './lib/installPrompt.js'

// TEMP: Remove after ConversationDock crash root cause is confirmed.
// Tracking commit: 8bf1704
//
// Remove together with the matching block in ErrorBoundary.jsx.
// Added 2026-08-01 to catch the intermittent ConversationDock exception.
// The ErrorBoundary only sees errors thrown during React's render/commit;
// anything from an async handler — a realtime callback, a promise rejection —
// bypasses it entirely and would otherwise leave no trace. Both are recorded
// to the same sessionStorage key so the order of events is readable.
if (typeof window !== 'undefined') {
  const record = (kind, message, stack) => {
    try {
      const prior = JSON.parse(sessionStorage.getItem('yp:crashes') || '[]')
      prior.push({ at: new Date().toISOString(), kind, message, stack, url: window.location.hash })
      sessionStorage.setItem('yp:crashes', JSON.stringify(prior.slice(-10)))
    } catch { /* never mask the error being recorded */ }
  }
  window.addEventListener('error', e => record('window.error', e?.message, e?.error?.stack))
  window.addEventListener('unhandledrejection', e =>
    record('unhandledrejection', e?.reason?.message || String(e?.reason), e?.reason?.stack))
}

// Outside the React tree on purpose: this is a property of the PAGE, not of
// any component, and it must also run its dev-cleanup branch on every load
// regardless of what App decides to render.
registerServiceWorker()

// ⚠ BEFORE THE REACT TREE EXISTS. `beforeinstallprompt` fires once, early,
// and is gone if nobody is listening — a listener added inside a component
// routinely misses it. See lib/installPrompt.js.
armInstallPrompt()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Mounted independently of App, not inside it — App renders `null`
        while it checks the session, and the splash needs to cover exactly
        that gap rather than being gated by the same loading state. */}
    <SplashScreen />
    <InAppBrowserWarning />
    <App />
  </StrictMode>,
)
