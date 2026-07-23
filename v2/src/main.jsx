import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SplashScreen from './components/SplashScreen.jsx'
import InAppBrowserWarning from './components/InAppBrowserWarning.jsx'

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
