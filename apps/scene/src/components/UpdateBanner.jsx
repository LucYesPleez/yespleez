import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { watchForUpdate } from '../lib/appUpdate';

/**
 * "A NEW VERSION IS READY" — offered, never imposed.
 *
 * ⛔ IT DOES NOT RELOAD BY ITSELF, and must not be changed to. Someone may be
 * halfway through writing an event, a message or a lineup; a reload they did
 * not ask for costs them all of it. The reader decides when it is safe.
 *
 * ⚠ SITS ABOVE THE BOTTOM NAV, never over it. The nav is fixed at `bottom: 0`
 * with `z-index: 9999` and is sacred — covering it would take away the way out
 * of whatever screen someone is on to save them a reload.
 *
 * ⚠ PORTALLED TO BODY. Ancestors with `transform` or `backdrop-filter` trap
 * `position: fixed` and z-index, and this app has both in its header — a banner
 * rendered in the tree would end up positioned against a container instead of
 * the viewport, on some screens and not others.
 *
 * ⛔ NOT DISMISSIBLE, and it appears at most once per session: `watchForUpdate`
 * stops after announcing. A banner that can be waved away is one people learn
 * to wave away, and this one is the only signal that a tab is running code that
 * has since been fixed.
 */
/**
 * ⭐⭐ THE QUIET RELOAD — and it is only quiet because the banner spoke first.
 *
 * Once a newer build is known about, the next time the reader LEAVES a screen
 * the page reloads onto it. Leaving is the safe moment: they have finished with
 * whatever was in front of them, so the in-memory state being discarded is
 * state they were already walking away from. Reloading a second earlier, while
 * they were still on the screen, could take a half-written event with it.
 *
 * ⛔ NEVER BEFORE THE BANNER. The banner appears the instant staleness is
 * detected, so a reload is never the first thing someone learns about it — they
 * were told, chose not to tap REFRESH, and then moved on anyway. That is the
 * difference between an update and an interruption.
 */
const RELOAD_GUARD_KEY = 'yp_update_reloaded_at';
const RELOAD_GUARD_MS = 60 * 1000;

/**
 * ⚠ A LOOP GUARD, AND IT IS NOT PARANOIA. After a reload the running bundle
 * equals the deployed one, so staleness is false and nothing fires again — in
 * the normal case. But if `/index.html` were ever served stale by an
 * intermediary, or a deploy left the document and the asset disagreeing, the
 * app would reload, still look out of date, and reload again: an unusable page
 * that no error explains. Refusing to reload twice inside a minute costs one
 * delayed update and forecloses that entirely.
 */
function reloadAllowed() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    return true;
  } catch (_) {
    return true;   // private mode: the guard is a nicety, not a requirement
  }
}

export default function UpdateBanner() {
  const [stale, setStale] = useState(false);
  const location = useLocation();
  // The screen they were on when the banner appeared. Leaving THIS is the
  // trigger; the route that was already open is not a navigation.
  const anchorPath = useRef(null);

  useEffect(() => watchForUpdate(() => setStale(true)), []);

  useEffect(() => {
    if (!stale) return;
    if (anchorPath.current === null) { anchorPath.current = location.pathname; return; }
    if (location.pathname === anchorPath.current) return;
    if (!reloadAllowed()) return;
    // ⚠ `replace`, not `reload`, so the new URL is what loads. A bare reload()
    // re-requests the PREVIOUS url on some browsers mid-transition, which would
    // land them back on the screen they just left.
    window.location.replace(window.location.href);
  }, [stale, location.pathname]);

  if (!stale || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="status"
      style={{
        position: 'fixed',
        // Clear of the nav plus its safe-area padding. `calc` rather than a
        // guessed constant: the nav's own height is padding + icon + label, and
        // the inset varies by device.
        bottom: 'calc(64px + env(safe-area-inset-bottom, 0px) + 10px)',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(calc(100% - 24px), 460px)',
        zIndex: 9998,          // under the nav, over everything else
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 13px',
        borderRadius: 12,
        background: 'var(--card2, #20202B)',
        border: '1px solid var(--border, rgba(255,255,255,.14))',
        boxShadow: '0 8px 28px rgba(0,0,0,.45)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13,
          color: 'var(--text, #F0F0F0)',
        }}>
          A newer YesPleez is ready
        </div>
        {/* Says what refreshing is FOR. "Update available" is a chore; naming
            the cost of not doing it is a reason. */}
        <div style={{
          fontFamily: "'DM Sans', sans-serif", fontSize: 11.5, lineHeight: 1.45,
          color: 'var(--muted, #8A8A96)', marginTop: 2,
        }}>
          {/* ⚠ Says the reload is coming. It happens on the next screen change
              whether or not REFRESH is tapped, so leaving that unsaid would
              make the eventual reload feel like a glitch. */}
          Refresh now, or it will update when you next change screen.
        </div>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="yp-tap44"
        style={{
          flexShrink: 0,
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: 1.2,
          color: '#0a0a14', background: 'var(--neon2, #00E5FF)',
          border: 'none', borderRadius: 9, padding: '9px 16px', cursor: 'pointer',
        }}
      >
        REFRESH
      </button>
    </div>,
    document.body,
  );
}
