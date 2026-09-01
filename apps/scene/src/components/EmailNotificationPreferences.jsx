import { useState, useEffect } from 'react';
import s from './NotificationPreferences.module.css';
import {
  EMAIL_CATEGORIES, EMAIL_MASTER, getEmailPreferences, setEmailPreference,
} from '../lib/emailPreferences';

/**
 * E6 · EMAIL NOTIFICATIONS — the third channel's switches.
 *
 * ⭐⭐ A SEPARATE PANEL, ⛔ NOT extra rows inside NotificationPreferences. The
 * two answer different questions and their category lists deliberately DISAGREE
 * in one place: `set_times_released` is filed under EVENTS in-app and under
 * SCHEDULE by email, because email maps it through `email_category_overrides`
 * while the notification registry stays frozen. Interleaving the rows would
 * present that as one list with a contradiction in it.
 *
 * ⛔ IT REUSES NotificationPreferences.module.css DELIBERATELY. Two panels that
 * look different would imply they work differently. They are the same kind of
 * control over a different channel, so they are the same object.
 *
 * ⚠ THIS PANEL CANNOT TURN ANYTHING ON THAT THE PANEL ABOVE HAS TURNED OFF. A
 * category muted in `notification_preferences` suppresses the notification
 * itself, and a suppressed row never reaches the email enqueue. The footnote
 * says so, because a switch that silently cannot win is worse than no switch.
 */
export default function EmailNotificationPreferences({ session }) {
  const [disabled, setDisabled] = useState(() => new Set());
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const userId = session?.user?.id;
  /* ⚠ THE ADDRESS COMES FROM THE SESSION, and the confirmation state with it.
     Operational email is ON by default only for an account with a usable
     address; one that has never been confirmed can hold preferences but will
     never be sent to, because `email_delivery_queue` requires
     email_confirmed_at. Saying so here stops that reading as a bug. */
  const email = session?.user?.email || null;
  const confirmed = Boolean(session?.user?.email_confirmed_at);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { disabled: off, error: err } = await getEmailPreferences(userId);
      if (cancelled) return;
      if (err) setError("Couldn't load your email settings.");
      else setDisabled(off);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  async function toggle(key) {
    if (!userId) return;
    const nowEnabled = disabled.has(key);   // currently off ⇒ turning on
    setError('');

    // Optimistic: a switch that waits on the network reads as broken.
    const next = new Set(disabled);
    if (nowEnabled) next.delete(key); else next.add(key);
    setDisabled(next);

    const { error: err } = await setEmailPreference(userId, key, nowEnabled);
    if (err) {
      // ⛔ Revert rather than leave the switch showing a state the database does
      // not hold. A preference that silently fails to save is worse than one
      // that visibly refuses.
      setDisabled(disabled);
      setError("Couldn't save that. Please try again.");
    }
  }

  if (loading) return null;

  const masterOff = disabled.has(EMAIL_MASTER);

  return (
    <div className={s.panel}>
      <div className={s.row}>
        <div className={s.rowText}>
          <div className={s.label}>EMAIL NOTIFICATIONS</div>
          <div className={s.desc}>
            Receive important YesPleez activity by email.{' '}
            {/* ⚠ THE ADDRESS IS SHOWN, and the unconfirmed case is stated
                plainly. `email_delivery_queue` requires email_confirmed_at, so
                an unconfirmed account can hold preferences and still never be
                sent to — silence that would otherwise read as a bug. */}
            {email
              ? (confirmed
                  ? <>Sent to {email}.</>
                  : <>Sent to {email} once you confirm that address.</>)
              : 'Add an email address to your account to receive these.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!masterOff}
          aria-label="Email notifications"
          className={`${s.switch}${!masterOff ? ` ${s.switchOn}` : ''}`}
          onClick={() => toggle(EMAIL_MASTER)}
        >
          <span className={s.knob} />
        </button>
      </div>

      {/* ⭐ THE CATEGORIES STAY VISIBLE WHEN THE MASTER IS OFF, dimmed and
          inert. Hiding them would make the master switch look like it deleted
          the settings underneath, and a user turning email back on wants to see
          their choices survived. */}
      {EMAIL_CATEGORIES.map(c => {
        const on = !disabled.has(c.key);
        const inert = masterOff && c.state === 'switch';
        return (
          <div key={c.key} className={s.row} style={inert ? { opacity: 0.45 } : undefined}>
            <div className={s.rowText}>
              <div className={s.label}>{c.label}</div>
              <div className={s.desc}>{c.desc}</div>
            </div>
            {c.state === 'always' ? (
              <span className={s.locked}>ALWAYS ON</span>
            ) : c.state === 'in_app' ? (
              /* ⛔ NOT a disabled switch. A greyed toggle invites a click and
                 implies the setting could exist; this states the platform's
                 decision plainly instead. */
              <span className={s.locked}>IN THE APP</span>
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={on && !masterOff}
                aria-label={`${c.label} emails`}
                disabled={masterOff}
                className={`${s.switch}${on && !masterOff ? ` ${s.switchOn}` : ''}`}
                onClick={() => toggle(c.key)}
              >
                <span className={s.knob} />
              </button>
            )}
          </div>
        );
      })}

      {error && <div className={s.error}>{error}</div>}

      <div className={s.footnote}>
        These are separate from the settings above. Turning a category off there
        stops it reaching you at all, including by email. Payment and account
        emails always come through.
      </div>
    </div>
  );
}
