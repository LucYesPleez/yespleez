import { useState } from 'react';
import { isInstalled } from '../lib/analytics';
import s from './GlobalHeader.module.css';

/**
 * ADD TO HOME SCREEN — header entry point, beside BETA.
 *
 * ⚠ HIDDEN ONCE INSTALLED. `isInstalled()` (analytics.js) already knows, via
 * display-mode plus the iOS-only `navigator.standalone`. A permanent invitation
 * to install something you are already running reads as a broken check.
 *
 * ⚠ INSTRUCTIONS, NOT A NATIVE PROMPT — for now, and deliberately.
 * The native dialog needs `beforeinstallprompt`, which only Chromium fires and
 * which arrives EARLY, usually before any component mounts; catching it means
 * stashing it at app start, not listening from here. iOS has no such event at
 * all — Safari cannot be asked to install, ever, so instructions are the only
 * thing that works on the platform where installing matters MOST (web push is
 * home-screen-only on iOS). Rather than ship a button that works on one
 * platform and dead-ends on the other, both get the same honest answer.
 *
 * When the prompt capture lands, this becomes: fire the native dialog where we
 * have one, fall back to these instructions everywhere else.
 */
export default function InstallButton() {
  const [open, setOpen] = useState(false);

  // Called during render on purpose — it is a synchronous media/navigator
  // read, not state, and it must re-evaluate if the app is opened installed.
  if (isInstalled()) return null;

  const ios = typeof navigator !== 'undefined'
    && /iPad|iPhone|iPod/.test(navigator.userAgent || '');

  return (
    <>
      <button
        type="button"
        className={s.iconBtn}
        onClick={() => setOpen(true)}
        aria-label="Add YesPleez to your home screen"
        title="Add to home screen"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          {/* Phone outline, interrupted lower-right so the badge sits in a gap
              rather than crossing the stroke — matches the supplied artwork. */}
          <path d="M15.5 10V5.5A3.5 3.5 0 0 0 12 2H6.5A3.5 3.5 0 0 0 3 5.5v13A3.5 3.5 0 0 0 6.5 22H12a3.5 3.5 0 0 0 3.32-2.4" />
          <path d="M7.6 4.9h3.3" />
          <path d="M7.6 19.3h3.3" />
          <rect x="13.6" y="11.6" width="9.4" height="9.4" rx="3.2" />
          <path d="M18.3 14.4v3.8" />
          <path d="M16.4 16.3h3.8" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Add to home screen"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 340, background: '#13131a', borderRadius: 18,
              border: '1px solid var(--border)', padding: 20,
            }}
          >
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, letterSpacing: 2, color: '#fff', marginBottom: 10 }}>
              ADD TO HOME SCREEN
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 14 }}>
              {ios
                ? <>Tap <strong style={{ color: 'var(--text)' }}>Share</strong> in Safari&rsquo;s toolbar, then{' '}
                    <strong style={{ color: 'var(--text)' }}>Add to Home Screen</strong>.</>
                : <>Open your browser menu <strong style={{ color: 'var(--text)' }}>⋮</strong>, then{' '}
                    <strong style={{ color: 'var(--text)' }}>Install app</strong> or{' '}
                    <strong style={{ color: 'var(--text)' }}>Add to Home screen</strong>.</>}
            </div>
            {/* The reason it is worth doing, and on iOS it is not a nicety:
                web push does not work at all in a Safari tab. */}
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 16 }}>
              {ios
                ? 'On iPhone, notifications only work once YesPleez is on your home screen.'
                : 'Opens full screen, and keeps notifications working reliably.'}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                width: '100%', background: 'none', border: '1px solid var(--border)',
                borderRadius: 999, color: 'var(--muted)', fontFamily: "'Bebas Neue',sans-serif",
                fontSize: 13, letterSpacing: 1.5, padding: '9px 0', cursor: 'pointer',
              }}
            >
              GOT IT
            </button>
          </div>
        </div>
      )}
    </>
  );
}
