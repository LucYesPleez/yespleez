/**
 * THE ANDROID INSTALL PROMPT — caught at app start, used later.
 *
 * ⚠⚠ THE EVENT ARRIVES BEFORE ANY COMPONENT MOUNTS, AND IT ONLY COMES ONCE.
 * Chromium fires `beforeinstallprompt` shortly after load, once, and if nobody
 * is listening it is simply gone — no replay, no way to ask for it again. A
 * listener added inside the install sheet (or even inside App's first effect)
 * routinely misses it, which is the classic "install button works on my
 * machine, not on the user's" bug. So this is armed from main.jsx before the
 * React tree exists, and the event is stashed for whenever the UI wants it.
 *
 * ⚠ CALLING preventDefault() IS WHAT SUPPRESSES CHROME'S OWN MINI-INFOBAR.
 * That is deliberate: the owner's artwork IS the install prompt, and two
 * competing invitations on one screen is worse than either alone. It also
 * means we now OWE the user a way to install — if the sheet ever stops
 * offering one, Chrome's fallback is no longer there to cover us.
 *
 * ⚠ NOTHING HERE EXISTS ON iOS. Safari implements no part of this API, at any
 * version, installed or not. `available()` is permanently false there and the
 * sheet must fall back to instructions — see InstallSheet.
 */
let deferred = null;
const listeners = new Set();

function notify() {
  for (const fn of listeners) { try { fn(); } catch { /* a bad listener is not our problem */ } }
}

/** Call once, as early as possible. Idempotent. */
let armed = false;
export function armInstallPrompt() {
  if (armed || typeof window === 'undefined') return;
  armed = true;

  window.addEventListener('beforeinstallprompt', (e) => {
    // Suppress Chrome's own banner so ours is the only offer on screen.
    e.preventDefault();
    deferred = e;
    notify();
  });

  // Fired by the browser after a successful install, however it was started —
  // including from the browser's own menu, which we never see. Clearing here
  // stops the sheet offering to install something already installed.
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

/** True when a real native install dialog can be opened right now. */
export function installAvailable() {
  return deferred !== null;
}

/** Subscribe to availability changes. Returns an unsubscribe function. */
export function onInstallAvailabilityChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Open the native install dialog.
 *
 * ⚠ THE EVENT IS SINGLE-USE. `prompt()` can be called once per event; the
 * browser issues a fresh one later if the user dismisses without installing.
 * So it is cleared here regardless of outcome — reusing a spent event throws,
 * and holding a stale one makes the button appear available when it is not.
 *
 * @returns {Promise<'accepted'|'dismissed'|'unavailable'>}
 */
export async function promptInstall() {
  if (!deferred) return 'unavailable';
  const e = deferred;
  deferred = null;
  notify();
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    return outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'unavailable';
  }
}
