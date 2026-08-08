import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import s from './NotificationPreferences.module.css';
import {
  messageSoundsEnabled, setMessageSoundsEnabled, preloadUiSounds, playReactionLand,
} from '../lib/uiSound';
import { getChannel, setChannel, DEFAULT_CHANNEL } from '../lib/notificationChannels';

// NP1 · the preferences panel.
//
// Preferences govern DELIVERY, never existence — so nothing here prevents a
// notification being written. Toggling a category off means the platform stops
// showing you that kind of notice; the record still exists. That is why the
// copy says "turn off" and never "stop receiving" or "delete".
//
// ── THE CATEGORIES ARE THE DATABASE'S, NOT THIS FILE'S ──────────────────
//
// `category` lives on notification_expiry_policy, one row per notification
// type, and the suppression trigger reads it there. This component only
// supplies the human-facing label and description for each. If a category is
// ever added in SQL, it will simply not appear here until it is given a label —
// which is the safe direction: an unlabelled category stays delivered.
//
// ── WHY payments AND account HAVE NO SWITCH ─────────────────────────────
//
// Owner's decision, 2026-07-20, enforced in the database by
// notification_category_is_mutable(). Both have consequences outside the app:
// a missed payment notice or an account/claim outcome is not the kind of noise
// anyone rationally opts out of.
//
// They are SHOWN rather than hidden. Hiding them would leave a user hunting for
// a switch that does not exist and concluding the app had lost their setting.
// Showing them with "always on" answers the question before it is asked.
//
// ── messages WAS ABSENT ON PURPOSE, UNTIL MESSAGING SHIPPED ─────────────
//
// The category has existed in notification_expiry_policy since NP1, held
// back from this list only because in-app messaging did not exist yet —
// a switch controlling nothing. Messaging (M8e's notify_new_message
// trigger) has since shipped and MP4 now routes it to push too, so the
// switch is added here (2026-07-25). No database change needed: the row
// was always there waiting for a label.

const CATEGORIES = [
  {
    key: 'messages',
    label: 'MESSAGES',
    desc: 'New messages in your conversations.',
  },
  {
    key: 'bookings',
    label: 'BOOKINGS',
    desc: 'Applications, slot offers, invites, confirmations and cancellations.',
  },
  {
    key: 'events',
    label: 'EVENTS',
    desc: 'Reminders, lineup changes, set times and event updates.',
  },
  {
    key: 'social',
    label: 'SOCIAL',
    desc: 'New followers and profile updates.',
  },
  {
    key: 'payments',
    label: 'PAYMENTS',
    desc: 'Payment requests and receipts.',
    locked: true,
  },
  {
    key: 'account',
    label: 'ACCOUNT',
    desc: 'Profile claims and account notices.',
    locked: true,
  },
];

export default function NotificationPreferences({ session }) {
  // Only categories the user has explicitly turned off are stored. Absence of
  // a row means enabled, so this map starts empty and stays sparse — matching
  // the database's own convention rather than materialising a row per user.
  const [disabled, setDisabled] = useState(() => new Set());
  const [soundsOn, setSoundsOn] = useState(() => messageSoundsEnabled());
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState('');

  useEffect(() => {
    if (!session?.user?.id) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('notification_preferences')
        .select('category, enabled')
        .eq('user_id', session.user.id);
      if (cancelled) return;
      if (err) setError("Couldn't load your notification settings.");
      else setDisabled(new Set((data || []).filter(r => !r.enabled).map(r => r.category)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  async function toggle(key) {
    if (!session?.user?.id) return;
    const nowEnabled = disabled.has(key);          // currently off ⇒ turning on
    setError('');

    // Optimistic: the switch must respond immediately or it reads as broken.
    const next = new Set(disabled);
    if (nowEnabled) next.delete(key); else next.add(key);
    setDisabled(next);

    const { error: err } = await supabase
      .from('notification_preferences')
      .upsert(
        { user_id: session.user.id, category: key, enabled: nowEnabled, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,category' },
      );

    if (err) {
      // Revert rather than leave the switch showing a state the database does
      // not hold. A preference that silently fails to save is worse than one
      // that visibly refuses.
      setDisabled(disabled);
      setError("Couldn't save that. Please try again.");
    }
  }

  if (loading) return null;

  return (
    <div className={s.panel}>
      {/* MESSAGE SOUNDS — device-level, not a notification category.
          It governs the tick a reaction makes as it lands, which is UI
          feedback rather than a delivery preference, so it is stored on the
          device like every other Studio-style setting rather than in
          notification_preferences. That also makes it work signed-out and
          per-device, which is what a sound setting should be.

          ⚠ There is NO web API for a phone's silent switch, on any platform.
          On iOS the hardware mute silences Web Audio anyway, enforced by the
          OS; on Android and desktop this switch is the only control. */}
      <div className={s.row}>
        <div className={s.rowText}>
          <div className={s.label}>MESSAGE SOUNDS</div>
          <div className={s.desc}>
            A short tick when a reaction lands. Silenced automatically by your
            phone&rsquo;s mute switch on iPhone.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={soundsOn}
          aria-label="Message sounds"
          className={`${s.switch}${soundsOn ? ` ${s.switchOn}` : ''}`}
          onClick={() => {
            const next = !soundsOn;
            setSoundsOn(next);
            setMessageSoundsEnabled(next);
            // Play as confirmation when switching ON — the fastest way to
            // answer "how loud is it?" is to hear it.
            if (next) { preloadUiSounds(); setTimeout(playReactionLand, 60); }
          }}
        >
          <span className={s.knob} />
        </button>
      </div>
      {CATEGORIES.map(c => {
        const on = !disabled.has(c.key);
        return (
          <div key={c.key} className={s.row}>
            <div className={s.rowText}>
              <div className={s.label}>{c.label}</div>
              <div className={s.desc}>{c.desc}</div>
            </div>
            {c.locked ? (
              <span className={s.locked}>ALWAYS ON</span>
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${c.label} notifications`}
                className={`${s.switch}${on ? ` ${s.switchOn}` : ''}`}
                onClick={() => toggle(c.key)}
              >
                <span className={s.knob} />
              </button>
            )}
          </div>
        );
      })}

      {/* CJ2 · A CHANNEL, NOT A TOGGLE — and it sits below the categories
          because it is a second axis over them, not another one of them.
          Every row above answers "do I want these at all"; this answers "by
          what route". They stack: muting SOCIAL still suppresses a contact
          join whatever is chosen here, because a channel is a delivery route
          and NP1's rule is that preferences govern delivery, never existence. */}
      <ContactJoinChannel onError={setError} />

      {error && <div className={s.error}>{error}</div>}

      {/* States what turning something off actually does. "Preferences govern
          delivery, never existence" is the architecture; this is the one
          sentence of it a user needs. */}
      <div className={s.footnote}>
        Turning a category off stops it appearing here. Payments and account
        notices always come through.
      </div>
    </div>
  );
}

/**
 * CJ2 · "When someone in your contacts joins" — three channels, one row.
 *
 * ⚠ A SEGMENTED CONTROL, NOT A SWITCH, BECAUSE THERE ARE THREE ANSWERS. The
 * rows above are binary and use the switch; forcing three states into two
 * controls (a mute toggle plus a push toggle) would create a fourth,
 * meaningless combination — "muted but push on" — that the user could reach
 * and the system would have to arbitrate. Three buttons, three states, no
 * unreachable or contradictory pairs.
 *
 * ⚠ OPTIMISTIC, AND IT REVERTS ON FAILURE. A preference that appears to save
 * and silently did not is worse than one that visibly fails: the user walks
 * away believing their phone will stay quiet.
 */
const CHANNEL_OPTIONS = [
  { key: 'push',   label: 'PUSH',        desc: 'Notify me on my phone' },
  { key: 'in_app', label: 'IN MESSAGES', desc: 'Only a badge in Messages' },
  { key: 'off',    label: 'OFF',         desc: "Don't tell me" },
];

function ContactJoinChannel({ onError }) {
  const [channel, setLocal] = useState(DEFAULT_CHANNEL);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getChannel('contact_joined').then(({ channel: c }) => {
      if (!cancelled) { setLocal(c); setReady(true); }
    });
    return () => { cancelled = true; };
  }, []);

  async function choose(next) {
    if (next === channel) return;
    const previous = channel;
    setLocal(next);
    const { error } = await setChannel('contact_joined', next);
    if (error) {
      setLocal(previous);
      onError?.("Couldn't save that. Please try again.");
    }
  }

  if (!ready) return null;

  const current = CHANNEL_OPTIONS.find(o => o.key === channel) ?? CHANNEL_OPTIONS[0];

  return (
    <div className={s.row} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div className={s.rowText}>
        <div className={s.label}>WHEN A CONTACT JOINS</div>
        {/* The description tracks the SELECTION rather than describing the
            feature, so the consequence of the current choice is always on
            screen — the thing a user actually wants confirmed. */}
        <div className={s.desc}>{current.desc}</div>
      </div>

      <div role="radiogroup" aria-label="When a contact joins" style={segWrap}>
        {CHANNEL_OPTIONS.map(o => {
          const on = o.key === channel;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => choose(o.key)}
              style={{
                ...segBtn,
                background: on ? 'rgba(0,229,255,.18)' : 'transparent',
                color: on ? 'var(--neon2)' : 'var(--muted)',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const segWrap = {
  display: 'flex', background: 'var(--card2)', borderRadius: 10,
  border: '1px solid var(--border)', overflow: 'hidden',
};
const segBtn = {
  flex: 1, border: 'none', padding: '9px 6px', cursor: 'pointer',
  fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, letterSpacing: 1.2,
  transition: 'background .15s, color .15s',
};
