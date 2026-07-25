import { useState, useEffect } from 'react';
import { isPushSupported, subscribeToPush, unsubscribeFromPush, reconcilePushState } from '../lib/push';
import s from './NotificationPreferences.module.css';

/**
 * MP2 · one toggle: "get notified when the app is closed", for THIS device.
 *
 * Deliberately separate from NotificationPreferences (the category
 * switches). Those govern whether a notification is ever shown in-app;
 * this governs whether one can also reach a closed browser/phone via the
 * OS. A user can have every category on and still not want push, or vice
 * versa where possible — they are independent axes, not a hierarchy.
 *
 * Per-device, not per-account: a subscription is tied to one browser's
 * push endpoint, so this reads/writes THIS device's state only. A user
 * who enables it on their phone and never opens the settings page on
 * their laptop will not see it as "on" there — that is correct, not a
 * bug, because the laptop genuinely has no subscription yet.
 */
export default function PushNotificationToggle({ session }) {
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState('default');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const supportedNow = isPushSupported();
    setSupported(supportedNow);
    if (!supportedNow || !session?.user?.id) { setLoading(false); return; }

    let cancelled = false;
    let permStatus;

    // MP·11 — reconcile on mount: catches revocation that happened while
    // this screen (or the whole app) was closed, which fires no event.
    reconcilePushState(session.user.id).then(({ subscribed: sub, permission: perm }) => {
      if (cancelled) return;
      setSubscribed(sub);
      setPermission(perm);
      setLoading(false);
    });

    // Live updates while this screen stays open. Not universally supported
    // (Safari lacks a 'notifications' Permissions query) — degrades to
    // mount-time-only reconciliation there, which still covers the common
    // case of revoking in a previous session.
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'notifications' }).then((status) => {
        if (cancelled) return;
        permStatus = status;
        status.onchange = () => {
          reconcilePushState(session.user.id).then(({ subscribed: sub, permission: perm }) => {
            if (cancelled) return;
            setSubscribed(sub);
            setPermission(perm);
          });
        };
      }).catch(() => { /* Permissions API query not supported for this name */ });
    }

    return () => {
      cancelled = true;
      if (permStatus) permStatus.onchange = null;
    };
  }, [session?.user?.id]);

  async function toggle() {
    if (!session?.user?.id || busy) return;
    setError('');
    setBusy(true);

    if (subscribed) {
      const result = await unsubscribeFromPush(session.user.id);
      if (result.ok) setSubscribed(false);
      else setError("Couldn't turn that off. Please try again.");
    } else {
      const result = await subscribeToPush(session.user.id);
      if (result.ok) {
        setSubscribed(true);
        setPermission('granted');
      } else if (result.reason === 'denied') {
        setPermission('denied');
        setError('Notifications are blocked for this site in your browser settings.');
      } else if (result.reason === 'unsupported') {
        setError("This browser doesn't support push notifications.");
      } else {
        setError("Couldn't turn that on. Please try again.");
      }
    }
    setBusy(false);
  }

  if (loading || !supported) return null;

  const blocked = permission === 'denied' && !subscribed;

  return (
    <div className={s.panel}>
      <div className={s.row}>
        <div className={s.rowText}>
          <div className={s.label}>NOTIFY THIS DEVICE</div>
          <div className={s.desc}>
            {blocked
              ? 'Blocked in your browser settings — allow notifications for this site to turn it back on here.'
              : 'Get a notification here even when the app is closed.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={subscribed}
          aria-label="Push notifications on this device"
          className={`${s.switch}${subscribed ? ` ${s.switchOn}` : ''}`}
          onClick={toggle}
          disabled={busy || blocked}
        >
          <span className={s.knob} />
        </button>
      </div>
      {error && <div className={s.error}>{error}</div>}
    </div>
  );
}
