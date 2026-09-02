/**
 * `/calendar` — YESPLEEZ → YOUR CALENDAR (Stage 1).
 *
 * The user turns sync ON, chooses what to include, and subscribes their
 * calendar app to a private feed URL. From then on YesPleez keeps the
 * calendar up to date: the feed always serves the CURRENT truth, so changes
 * update items and removals remove them, on the client's own refresh cycle.
 *
 * ⚠ THE HONEST MECHANISM, stated in the UI too: this is a standard
 * iCalendar SUBSCRIPTION (webcal). Calendar apps poll it — Google roughly
 * every 12 to 24 hours, Apple at a chosen interval. ⛔ Nothing here claims
 * instant push, and ⛔ Stage 2 (reading the user's own calendar,
 * availability, clash detection) is not built.
 *
 * ⭐⭐ IT WEARS THE NOTIFICATION SETTINGS' CLOTHES, AND THAT IS THE POINT
 * (owner, 2026-09-02). This is the app's second preferences surface, and a
 * settings screen that invents its own panel, its own switch and its own
 * heading treatment reads as a different product. It imports
 * `NotificationPreferences.module.css` — the panel, row, label, desc, switch
 * and locked-pill treatment — ⛔ rather than copying those rules into a
 * second stylesheet that would drift the first time either is touched. Same
 * reasoning as SchedulePortrait reading SlotCard's own stylesheet.
 *
 * ⛔ Preferences here are CALENDAR preferences — a different question from
 * notification preferences, and never conflated with them.
 */

import { useEffect, useState, Fragment } from 'react';
import { useSession } from '../App';
import {
  QUESTIONS, ABSENT_CATEGORIES, mergeCategories,
  rolesForAccount, categoriesForRole,
} from '../lib/calendarFeed';
import {
  fetchCalendarPrefs, fetchProfileTypes, enableCalendarSync, disableCalendarSync,
  setCalendarCategory, calendarFeedUrl, calendarWebcalUrl,
} from '../lib/calendarPrefs';

/**
 * ⭐ ALL IS A SELECTED STATE, ⛔ NOT THE PRIMARY CHIP (owner, 2026-09-02).
 * The roles are the product language; "All" is what you pick when you want
 * the combined calendar, so it sits at the end rather than leading.
 */
const ALL_ROLE = '__all__';
/* ⚠ The notification panel's stylesheet, ⛔ not a copy of it — see the note
   above. `.panel`, `.row`, `.label`, `.desc`, `.switch`, `.knob`,
   `.footnote` and `.error` are the app's settings idiom and live with the
   component that first needed them. */
import s from '../components/NotificationPreferences.module.css';

/** The page title's treatment, matching NOTIFICATIONS exactly. */
const pageTitle = {
  fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 3,
  background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)',
  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  backgroundClip: 'text', display: 'inline-block',
};

/** The page's pill button — the same one MANAGE / DONE uses up there. */
const pill = {
  background: 'none', border: '1px solid var(--border)', borderRadius: 999,
  color: 'var(--muted)', fontFamily: "'Bebas Neue', sans-serif", fontSize: 12,
  letterSpacing: 1.5, padding: '5px 12px', cursor: 'pointer',
  textDecoration: 'none', display: 'inline-block',
};

/** The settings switch, from the shared stylesheet. */
function Switch({ on, onFlip, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      aria-label={label}
      disabled={disabled}
      className={`${s.switch}${on ? ` ${s.switchOn}` : ''}`}
      onClick={onFlip}
    >
      <span className={s.knob} />
    </button>
  );
}

export default function CalendarScreen() {
  const { session } = useSession();
  const userId = session?.user?.id || null;

  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [row, setRow] = useState(null);
  const [profileTypes, setProfileTypes] = useState([]);
  const [role, setRole] = useState(ALL_ROLE);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let dead = false;
    (async () => {
      const [{ row: r, error: err }, types] = await Promise.all([
        fetchCalendarPrefs(userId),
        fetchProfileTypes(userId),
      ]);
      if (dead) return;
      /* ⚠ The table ships by migration. Until it is applied the select
         errors — say "not available yet" rather than rendering a switch
         that cannot save. A dead control is worse than an absent one. */
      if (err) setUnavailable(true);
      else setRow(r);
      setProfileTypes(types);
      setLoading(false);
    })();
    return () => { dead = true; };
  }, [userId]);

  const enabled = !!row?.enabled;
  const cats = mergeCategories(row?.categories);
  /* ⭐ The roles this account actually holds, from its PROFILES — ⛔ never
     guessed from having been booked somewhere. */
  const roles = rolesForAccount(profileTypes);
  const shownRoles = role === ALL_ROLE ? roles : roles.filter(r => r.key === role);
  /* ⚠ Honest about what a role does NOT carry. Per the data rule an
     unsupported question is ABSENT — this says so in one line rather than
     leaving a reader wondering where their deadlines went. */
  const absent = ABSENT_CATEGORIES.filter(a => shownRoles.some(r => r.key === a.role));

  const flipMaster = async () => {
    if (busy || !userId) return;
    setBusy(true);
    setError('');
    if (enabled) {
      const { error: err } = await disableCalendarSync(userId);
      if (err) setError("Couldn't save that. Please try again.");
      else setRow(r => ({ ...r, enabled: false }));
    } else {
      const { row: r, error: err } = await enableCalendarSync(userId);
      if (err) setError("Couldn't save that. Please try again.");
      else setRow(r);
    }
    setBusy(false);
  };

  const flipCategory = async (key) => {
    if (busy || !userId || !row) return;
    setBusy(true);
    setError('');
    const { categories, error: err } = await setCalendarCategory(userId, key, !cats[key], row.categories || {});
    if (err) setError("Couldn't save that. Please try again.");
    else setRow(r => ({ ...r, categories }));
    setBusy(false);
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(calendarFeedUrl(row.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the address is on screen to copy by hand */ }
  };

  return (
    <div style={{ paddingTop: 68, paddingBottom: 96 }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px' }}>

        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={pageTitle}>CALENDAR</div>
        </div>

        {!userId ? (
          <div className={s.panel}>
            <div className={s.row}>
              <div className={s.rowText}>
                <div className={s.label}>SIGN IN TO SYNC</div>
                <div className={s.desc}>
                  Your gigs, set times and saved events can live in the calendar app you
                  already use.
                </div>
              </div>
            </div>
          </div>
        ) : loading ? null : unavailable ? (
          <div className={s.panel}>
            <div className={s.row}>
              <div className={s.rowText}>
                <div className={s.label}>NOT AVAILABLE YET</div>
                <div className={s.desc}>Calendar sync is on its way.</div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* ── the master switch, its own card like NOTIFY THIS DEVICE ── */}
            <div className={s.panel}>
              <div className={s.row}>
                <div className={s.rowText}>
                  <div className={s.label}>SYNC WITH YOUR CALENDAR</div>
                  <div className={s.desc}>
                    Your confirmed gigs, set times and saved events, kept up to date in the
                    calendar app you already use.
                  </div>
                </div>
                <Switch on={enabled} onFlip={flipMaster} disabled={busy} label="Sync YesPleez with your calendar" />
              </div>
            </div>

            {enabled && row?.token && (
              <>
                {/* ── the subscription address ─────────────────────────── */}
                <div className={s.panel}>
                  <div className={s.row} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                    <div className={s.rowText}>
                      <div className={s.label}>YOUR CALENDAR ADDRESS</div>
                      <div className={s.desc}>
                        Paste this into Google Calendar (Other calendars, From URL), Apple
                        Calendar (File, New Calendar Subscription) or Outlook (Add calendar,
                        Subscribe from web). Your calendar app checks it on its own schedule,
                        so changes can take a while to show up.
                      </div>
                    </div>
                    <div style={{
                      fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: 'var(--text)',
                      wordBreak: 'break-all', background: 'var(--card2)',
                      border: '1px solid var(--border)', borderRadius: 10, padding: '9px 11px',
                    }}>
                      {calendarFeedUrl(row.token)}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" onClick={copyUrl} style={pill}>
                        {copied ? 'COPIED' : 'COPY ADDRESS'}
                      </button>
                      <a href={calendarWebcalUrl(row.token)} style={pill}>OPEN IN CALENDAR APP</a>
                    </div>
                  </div>
                </div>

                {/**
                  * ⭐⭐ THE ROLE CHIPS. ⛔ NOT filters over one shared bucket —
                  * each role carries its own independent configuration, and
                  * switching chips changes WHICH configuration you are
                  * editing. ⚠ Only roles the account actually holds appear;
                  * the chip row is hidden entirely when there is one role,
                  * because a single chip explains nothing.
                  */}
                {roles.length > 1 && (
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', margin: '18px 0 10px' }}>
                    {[...roles, { key: ALL_ROLE, label: 'ALL' }].map(r => {
                      const on = role === r.key;
                      return (
                        <button
                          key={r.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setRole(r.key)}
                          style={{
                            ...pill,
                            color: on ? 'var(--neon2)' : 'var(--muted)',
                            borderColor: on ? 'var(--neon2)' : 'var(--border)',
                            background: on ? 'rgba(0,229,255,.14)' : 'none',
                          }}
                        >{r.label}</button>
                      );
                    })}
                  </div>
                )}

                {/* ── what lands in it, grouped by the four questions ───── */}
                <div className={s.panel}>
                  {shownRoles.map(r => {
                    const cs = categoriesForRole(r.key);
                    if (!cs.length) return null;
                    return (
                      <Fragment key={r.key}>
                        {/* ⚠ The role only names itself in the combined view;
                            with one role selected the chip above already
                            said it, and repeating it is noise. */}
                        {role === ALL_ROLE && roles.length > 1 && (
                          <div className={s.row} style={{ paddingBottom: 4 }}>
                            <div className={s.rowText}>
                              <div className={s.label} style={{ color: 'var(--neon2)' }}>{r.label}</div>
                            </div>
                          </div>
                        )}
                        {cs.map(c => (
                          <div key={c.key} className={s.row}>
                            <div className={s.rowText}>
                              {/* ⭐ THE QUESTION IS THE SUBHEAD, so the grammar
                                  is visible: role → what's on / when I'm
                                  needed / committed / waiting on me. */}
                              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 10, letterSpacing: 1.6, color: 'var(--muted)', marginBottom: 2 }}>
                                {QUESTIONS[c.question]}
                              </div>
                              <div className={s.label}>{c.label}</div>
                              <div className={s.desc}>{c.desc}</div>
                            </div>
                            <Switch
                              on={cats[c.key]}
                              onFlip={() => flipCategory(c.key)}
                              disabled={busy}
                              label={`${c.label} in your calendar`}
                            />
                          </div>
                        ))}
                      </Fragment>
                    );
                  })}
                </div>

                {/**
                  * ⭐ SAYS WHAT IS ABSENT AND WHY. A host looking for
                  * "applications closing" should learn that YesPleez has no
                  * such date, ⛔ not be left assuming the toggle is missing.
                  * ⚠ Per the data rule the category itself stays ABSENT —
                  * this is a sentence, ⛔ never a disabled switch.
                  */}
                {absent.length > 0 && (
                  <div className={s.footnote}>
                    {absent.map(a => (
                      <div key={`${a.role}-${a.question}`} style={{ marginBottom: 4 }}>
                        <strong>{QUESTIONS[a.question]}</strong> is not in your calendar for this role. {a.why}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {error && <div className={s.error}>{error}</div>}

            {/* States what turning sync off actually does — the calendar
                twin of the notification panel's own footnote. */}
            <div className={s.footnote}>
              {enabled
                ? 'Keep your calendar address private: anyone who has it can read this calendar. Turning sync off stops YesPleez publishing it, and your choices are kept.'
                : 'Turning sync off stops YesPleez publishing your calendar. Your choices are kept for when you turn it back on.'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
