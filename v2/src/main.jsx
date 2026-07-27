import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SplashScreen from './components/SplashScreen.jsx'
import InAppBrowserWarning from './components/InAppBrowserWarning.jsx'
import { registerServiceWorker } from './lib/registerServiceWorker.js'
import { armInstallPrompt } from './lib/installPrompt.js'

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
