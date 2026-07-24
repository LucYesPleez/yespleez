/**
 * SERVICE WORKER REGISTRATION.
 *
 * The worker itself is `public/sw.js` — read its header before changing
 * anything here; the caching rules are where the risk lives.
 *
 * ── PRODUCTION ONLY, AND THE DEV BRANCH IS NOT OPTIONAL ──────────────
 *
 * A service worker in dev intercepts Vite's module graph and breaks HMR in
 * ways that look like the app being broken rather than the worker being
 * wrong. So it is never registered from `npm run dev`.
 *
 * But "don't register in dev" is only half of it. A registration is
 * PER-ORIGIN AND PERSISTENT: test a production build on localhost:5200 once
 * and that worker keeps controlling localhost:5200 afterwards, including
 * when the dev server is running there later. Not registering does nothing
 * about a worker that is already installed — it has to be actively removed,
 * which is what the dev branch below does.
 */

/** True when the page is being served by a real build rather than the dev server. */
const IS_PROD = import.meta.env?.PROD === true;

export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  if (!IS_PROD) {
    // Clean up anything a previous production-build test left behind on this
    // origin. See the header — this is the half that "just don't register"
    // misses, and its absence presents as inexplicably broken HMR.
    navigator.serviceWorker.getRegistrations()
      .then(regs => regs.forEach(r => r.unregister()))
      .catch(() => {});
    return;
  }

  // After load, deliberately: registration competes with the app's own first
  // paint for bandwidth otherwise, and nothing about the first visit needs
  // the worker — it exists for the SECOND visit and for installability.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // An unregistrable worker costs offline support and the install
      // prompt. It must not cost the user a working page, so this is
      // swallowed the same way analytics failures are.
    });
  });
}
