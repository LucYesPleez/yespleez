import { useState } from 'react';
import { nativeShare, copyLink, canNativeShare } from '../lib/shareTarget';
import QrPreview from './QrPreview';
import { qrUrl, posterKicker } from '../lib/qrDestinations';
import { exportPdf, exportPng } from '../lib/qr/qrExport';

/**
 * SHARE SHEET — the generic presentation of whatever the current screen
 * declared via `useShareTarget`. It reads a payload; it knows nothing about
 * events, profiles or venues, and must stay that way.
 *
 * Three actions, per the navigation & sharing architecture:
 *
 *   Native share sheet   where the platform provides one
 *   Copy Link            always
 *   QR Code              DEFERRED — see below
 *
 * ⚠⚠ THIS SHEET IS NOT MOUNTED ANYWHERE (verified 2026-08-21). The header's
 * share icon was removed by the owner on 2026-08-04 and nothing renders
 * `<ShareSheet>` since; the surfaces worth sharing carry their own control and
 * call `nativeShare`/`copyLink` directly. ⛔ So the QR row below is READY, not
 * SHIPPED — do not count it as a QR entry point. The live ones are the QR CODES
 * section on the venue and host dashboards, and PROMOTE in an event's manage
 * menu. If this sheet is ever mounted again the row works immediately, because
 * the screens already declare `qr: {type, id}` on their share targets.
 *
 * ── QR IS RESERVED, NOT BUILT ────────────────────────────────────────
 *
 * Generating a QR needs either a dependency or a hand-rolled encoder. This app
 * has eight dependencies and a zero-dependency test suite, so adding one is the
 * owner's call, and a hand-rolled QR encoder is exactly the kind of code that
 * is subtly wrong in ways that are hard to see. The slot is reserved and
 * visibly disabled rather than silently absent — the same treatment the Info
 * button was given, and for the same reason: a missing control reads as an
 * oversight, a disabled one reads as a decision.
 */
export default function ShareSheet({ target, onClose }) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const qrUrlFor = target?.qr ? qrUrl(target.qr.type, target.qr.id) : null;
  if (!target) return null;

  const isPrivate = target.access === 'private';

  // ⚠ BOTH ACTS LIVE IN lib/shareTarget, WITH THEIR TRACKING. They were lifted
  // out when Invite Friends became a single button that shares without opening
  // this sheet — two surfaces, still one implementation of each act. Closing on
  // success only: a cancelled native sheet returns false and leaves this open,
  // which is what dismissing a share sheet asks for.
  async function doNativeShare() {
    if (await nativeShare(target)) onClose?.();
  }

  async function doCopyLink() {
    if (await copyLink(target)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      setCopied(false);
    }
  }

  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
    background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '13px 16px', marginBottom: 8,
    color: 'var(--text)', fontSize: 14, cursor: 'pointer', textAlign: 'left',
  };

  return (
    <div
      role="dialog"
      aria-label="Share"
      onClick={onClose}
      /* CONSTITUTIONAL LAYOUT RULE — the bottom navigation is sacred. This
         sheet ends at the top of the nav; nothing renders underneath it. */
      style={{ position: 'fixed', top: 'var(--yp-header-height, 56px)', left: 0, right: 0, bottom: 'var(--yp-nav-height, 64px)', background: 'rgba(0,0,0,.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        /* ⚠ --card, NOT --bg. This panel is RAISED over a dimmed page, so it
           must read as a surface above it rather than the page colour repeated
           — and it was `var(--bg)`, an undefined token, which painted nothing
           at all and left the sheet see-through (owner, 2026-08-01: "its
           completely transparent. doesnt make sense"). --bg now exists, but a
           sheet the same colour as the page behind it is still the wrong
           answer. */
        style={{ width: '100%', maxWidth: 480, background: 'var(--card)', borderTop: '1px solid var(--border)', borderRadius: '18px 18px 0 0', padding: 20, boxSizing: 'border-box', boxShadow: '0 -12px 40px rgba(0,0,0,.55)' }}
      >
        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, letterSpacing: 2, color: 'var(--text)', marginBottom: 4 }}>
          SHARE
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {target.title}
        </div>

        {isPrivate && (
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
            This is a private resource. Anyone without access will be asked to
            request it.
          </div>
        )}

        {canNativeShare() && (
          <button type="button" style={rowStyle} onClick={doNativeShare}>Share via…</button>
        )}

        <button type="button" style={rowStyle} onClick={doCopyLink}>
          {copied ? 'Link copied' : 'Copy link'}
        </button>

        {/* ⭐⭐ THE RESERVED SLOT, NOW REAL (QR1). The encoder is in-repo and
            zero-dependency, and the objection recorded in this file's header —
            that a hand-rolled encoder is subtly wrong in ways that are hard to
            see — is answered by `lib/qr/qrEncode.test.js`, which decodes every
            symbol back with an independent reader rather than asserting on the
            writer's own output.

            ⚠ A code is offered only where the screen DECLARED a destination.
            A share target carries a URL; a QR carries a `/q/` address, and
            ⛔ this sheet does not get to guess one. Screens that have not
            declared `qr` keep the disabled row, which stays honest. */}
        {qrUrlFor ? (
          <>
            <button type="button" style={rowStyle} onClick={() => setShowQr(v => !v)}>
              {showQr ? 'Hide QR code' : 'QR code'}
            </button>
            {showQr && (
              <div style={{ marginBottom: 8 }}>
                <QrPreview
                  url={qrUrlFor}
                  title={target.title}
                  kicker={posterKicker(target.qr.type)}
                  size={200}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {[['PDF', exportPdf], ['PNG', exportPng]].map(([label, fn]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => fn({
                        url: qrUrlFor,
                        title: target.title,
                        kicker: posterKicker(target.qr.type),
                        destinationType: target.qr.type,
                      })}
                      style={{ ...rowStyle, justifyContent: 'center', marginBottom: 0, flex: 1 }}
                    >
                      Download {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <button
            type="button"
            disabled
            title="This page does not have a QR destination"
            style={{ ...rowStyle, cursor: 'not-allowed', color: 'var(--muted)', opacity: 0.6 }}
          >
            QR code
            <span style={{ marginLeft: 'auto', fontSize: 11, letterSpacing: 1 }}>NOT FOR THIS</span>
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          style={{ ...rowStyle, justifyContent: 'center', marginTop: 8, marginBottom: 0, background: 'transparent', color: 'var(--muted)' }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
