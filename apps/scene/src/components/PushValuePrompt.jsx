/**
 * THE NOTIFICATION ASK, OFFERED ONCE, AT THE MOMENT IT ANSWERS SOMETHING.
 *
 * Mounted once in Shell. It listens for `yp:push-worth-it` — dispatched by
 * whatever just happened that a notification would answer, today submitting
 * an application — applies the policy in lib/pushPrompt, and offers.
 *
 * ⭐⭐ THE ENABLE BUTTON IS THE USER GESTURE. `Notification.requestPermission()`
 * is only honoured from a real tap, and an origin that gets dismissed once is
 * blocked forever with no way back from JS. So subscribeToPush is called
 * DIRECTLY from this button's onClick — ⛔ never from an effect, never after
 * an await that could break the gesture's trust chain, and never on mount.
 * lib/push.js's own docblock has said this since MP2; this is the first
 * caller outside the settings toggle and it must not be the one that breaks
 * the rule.
 *
 * ⚠ THE SERVICE WORKER ONLY REGISTERS IN A PRODUCTION BUILD, so
 * subscribeToPush cannot complete under `npm run dev` — it waits on
 * `navigator.serviceWorker.ready` forever. The offer still renders in dev
 * (the policy is what dev proves); enabling is a production-build test.
 *
 * ⛔ NOT A SECOND SETTINGS SCREEN. Saying no here is remembered in P8 and the
 * permanent control on /notifications is untouched.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '../App';
import { isPushSupported, getPushPermission, subscribeToPush } from '../lib/push';
import {
  PUSH_PROMPT_EVENT, shouldOfferPush, isPushPromptSuppressed, suppressPushPrompt,
} from '../lib/pushPrompt';
import s from './AccountInviteSheet.module.css';

export default function PushValuePrompt() {
  const { session } = useSession() ?? {};
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const userId = session?.user?.id;

  useEffect(() => {
    async function onWorthIt() {
      // Cheap, synchronous gates first — a supported check and a permission
      // read cost nothing and rule out most cases without a round trip.
      if (!shouldOfferPush({
        signedIn: !!userId, supported: isPushSupported(),
        permission: getPushPermission(), suppressed: false,
      })) return;
      if (await isPushPromptSuppressed(userId)) return;
      setOpen(true);
    }
    window.addEventListener(PUSH_PROMPT_EVENT, onWorthIt);
    return () => window.removeEventListener(PUSH_PROMPT_EVENT, onWorthIt);
  }, [userId]);

  if (!open) return null;

  /** ⚠ NOT async before subscribeToPush — see the docblock. The permission
   *  request must be the first thing this gesture does. */
  function enable() {
    setBusy(true);
    subscribeToPush(userId)
      .catch(() => {})
      .finally(() => { suppressPushPrompt(userId); setOpen(false); setBusy(false); });
  }

  function notNow() {
    suppressPushPrompt(userId);
    setOpen(false);
  }

  return createPortal(
    <>
      <div className={s.scrim} onClick={notNow} />
      <div className={s.sheet} role="dialog" aria-modal="true" aria-label="Get notified about replies">
        <div className={s.handle} />
        <div style={{ textAlign: 'center', maxWidth: 420, margin: '0 auto' }}>
          <h2 style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 2,
            color: 'var(--text)', margin: '0 0 8px',
          }}>
            DON'T MISS THE REPLY
          </h2>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--muted)', margin: '0 0 18px' }}>
            We'll let you know the moment the host answers.
          </p>
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            style={{
              display: 'block', width: '100%', border: 'none', borderRadius: 10,
              padding: 13, cursor: 'pointer', marginBottom: 6,
              background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)', color: '#000',
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: 2,
            }}
          >
            {busy ? '…' : 'TURN ON NOTIFICATIONS'}
          </button>
          <button
            type="button"
            onClick={notNow}
            style={{
              background: 'none', border: 'none', color: 'var(--muted)',
              fontSize: 12.5, padding: '10px 16px', cursor: 'pointer',
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
