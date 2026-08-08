import { useState } from 'react';
import HandIcon from './HandIcon';

// Same detection list as the legacy prototype — the in-app browsers built
// into these apps' own "open link" webview, not full Safari/Chrome.
const IN_APP_UA = /FBAN|FBAV|Instagram|Messenger|Twitter|Line\/|MicroMessenger|WeChat|Snapchat/;

/**
 * Ported from the legacy prototype's "IN-APP BROWSER WARNING". No
 * persistence, by design, matching the original — it checks the user agent
 * fresh on every load, so it reappears every time someone is still inside
 * an in-app browser, not just once. The problem it's warning about (broken
 * mic/camera access, cookie quirks) is a property of the CURRENT tab, not
 * something a past dismissal fixes.
 */
export default function InAppBrowserWarning() {
  const [dismissed, setDismissed] = useState(false);
  const isInApp = typeof navigator !== 'undefined' && IN_APP_UA.test(navigator.userAgent || '');

  if (!isInApp || dismissed) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 999998,
        background: 'rgba(10,10,15,.95)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          position: 'relative', overflow: 'hidden',
          background: 'var(--card)', border: '1px solid var(--neon)',
          borderRadius: 14, padding: '32px 24px', maxWidth: 340, width: '100%',
          textAlign: 'center',
          boxShadow: '0 0 40px rgba(255,45,120,.2), 0 0 80px rgba(0,229,255,.08)',
        }}
      >
        {/* Background logo watermark */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', zIndex: 0,
        }}>
          <HandIcon size={200} style={{ color: '#fff', opacity: 0.135 }} />
        </div>

        {/* Cyan/pink glow blobs */}
        <div style={{
          position: 'absolute', top: -40, left: -40, width: 160, height: 160,
          background: 'radial-gradient(circle, rgba(0,229,255,.2) 0%, transparent 70%)',
          pointerEvents: 'none', zIndex: 0,
        }} />
        <div style={{
          position: 'absolute', bottom: -40, right: -40, width: 160, height: 160,
          background: 'radial-gradient(circle, rgba(255,45,120,.18) 0%, transparent 70%)',
          pointerEvents: 'none', zIndex: 0,
        }} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 2,
            color: 'var(--neon)', marginBottom: 10,
          }}>
            OPEN IN YOUR BROWSER
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 20 }}>
            To avoid potential issues while in beta, tap the <strong style={{ color: 'var(--text)' }}>···</strong> menu
            and select <strong style={{ color: 'var(--text)' }}>"Open in external browser"</strong> before signing in.
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            style={{
              width: '100%', background: 'var(--neon2)', color: '#0a0a0f',
              border: 'none', fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 16, letterSpacing: 2, padding: 14, borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            CHZ!
          </button>
        </div>
      </div>
    </div>
  );
}
