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
 * ⛔ Preferences here are CALENDAR preferences — a different question from
 * notification preferences, and never conflated with them.
 */

import { useEffect, useState } from 'react';
import { useSession } from '../App';
import { CALENDAR_CATEGORIES, mergeCategories } from '../lib/calendarFeed';
import {
  fetchCalendarPrefs, enableCalendarSync, disableCalendarSync,
  setCalendarCategory, calendarFeedUrl, calendarWebcalUrl,
} from '../lib/calendarPrefs';

const heading = { fontFamily: "'Bebas Neue', sans-serif", fontWeight: 400, letterSpacing: 1 };

function Toggle({ on, onFlip, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      aria-label={label}
      disabled={disabled}
      onClick={onFlip}
      style={{
        width: 44, height: 24, borderRadius: 12, flexShrink: 0, cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${on ? 'var(--neon2)' : 'var(--border)'}`,
        background: on ? 'rgba(0,229,255,.18)' : 'rgba(255,255,255,.05)',
        position: 'relative', transition: 'background .15s, border-color .15s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 22 : 2, width: 18, height: 18,
        borderRadius: '50%', background: on ? 'var(--neon2)' : 'rgba(255,255,255,.4)',
        transition: 'left .15s, background .15s',
      }} />
    </button>
  );
}

export default function CalendarScreen() {
  const { session } = useSession();
  const userId = session?.user?.id || null;

  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let dead = false;
    (async () => {
      const { row: r, error } = await fetchCalendarPrefs(userId);
      if (dead) return;
      /* ⚠ The table ships by migration. Until it is applied the select
         errors — say "not available yet" rather than rendering a switch
         that cannot save. A dead control is worse than an absent one. */
      if (error) setUnavailable(true);
      else setRow(r);
      setLoading(false);
    })();
    return () => { dead = true; };
  }, [userId]);

  const enabled = !!row?.enabled;
  const cats = mergeCategories(row?.categories);

  const flipMaster = async () => {
    if (busy || !userId) return;
    setBusy(true);
    if (enabled) {
      const { error } = await disableCalendarSync(userId);
      if (!error) setRow(r => ({ ...r, enabled: false }));
    } else {
      const { row: r, error } = await enableCalendarSync(userId);
      if (!error) setRow(r);
    }
    setBusy(false);
  };

  const flipCategory = async (key) => {
    if (busy || !userId || !row) return;
    setBusy(true);
    const { categories, error } = await setCalendarCategory(userId, key, !cats[key], row.categories || {});
    if (!error) setRow(r => ({ ...r, categories }));
    setBusy(false);
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(calendarFeedUrl(row.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the URL is still on screen to copy by hand */ }
  };

  const groups = [...new Set(CALENDAR_CATEGORIES.map(c => c.group))];

  return (
    <div style={{ padding: '68px 16px 96px', maxWidth: 680, margin: '0 auto', boxSizing: 'border-box' }}>
      <header style={{ marginBottom: 20 }}>
        <div style={{ ...heading, fontSize: 13, letterSpacing: 3, color: 'var(--muted)', marginBottom: 4 }}>YOUR ACCOUNT</div>
        <h1 style={{ ...heading, fontSize: 34, lineHeight: 1.02, margin: 0 }}>CALENDAR</h1>
      </header>

      {!userId ? (
        <p style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.65 }}>
          Sign in to sync your YesPleez gigs and events with your calendar.
        </p>
      ) : loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>Loading…</p>
      ) : unavailable ? (
        <p style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.65 }}>
          Calendar sync is not available yet. It is on its way.
        </p>
      ) : (
        <>
          {/* ── master switch ──────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--border)', borderRadius: 14, padding: '16px 16px', background: 'rgba(255,255,255,.03)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...heading, fontSize: 16, letterSpacing: 1.4 }}>SYNC YESPLEEZ WITH YOUR CALENDAR</div>
              <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>
                Your confirmed gigs, set times and saved events, kept up to date in the calendar app you already use.
              </div>
            </div>
            <Toggle on={enabled} onFlip={flipMaster} disabled={busy} label="Sync YesPleez with your calendar" />
          </div>

          {enabled && row?.token && (
            <>
              {/* ── the subscription itself ──────────────────────────── */}
              <section style={{ marginTop: 18, border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', background: 'rgba(255,255,255,.03)' }}>
                <div style={{ ...heading, fontSize: 13, letterSpacing: 2, color: 'var(--muted)', marginBottom: 8 }}>YOUR CALENDAR ADDRESS</div>
                <div style={{ fontSize: 12, color: 'var(--text)', wordBreak: 'break-all', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                  {calendarFeedUrl(row.token)}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button type="button" onClick={copyUrl}
                    style={{ ...heading, fontSize: 12, letterSpacing: 1.6, padding: '9px 16px', borderRadius: 9, cursor: 'pointer', color: '#fff', border: '1.5px solid transparent', background: 'linear-gradient(var(--card2),var(--card2)) padding-box, linear-gradient(135deg,#00E5FF,#BF5FFF) border-box' }}>
                    {copied ? 'COPIED' : 'COPY ADDRESS'}
                  </button>
                  <a href={calendarWebcalUrl(row.token)}
                    style={{ ...heading, fontSize: 12, letterSpacing: 1.6, padding: '9px 16px', borderRadius: 9, color: 'var(--text)', border: '1px solid var(--border)', background: 'rgba(255,255,255,.05)', textDecoration: 'none' }}>
                    OPEN IN CALENDAR APP
                  </a>
                </div>
                <p style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.6, margin: '10px 0 0' }}>
                  Paste the address into Google Calendar (Other calendars, From URL), Apple Calendar
                  (File, New Calendar Subscription) or Outlook (Add calendar, Subscribe from web).
                  Your calendar app checks it on its own schedule, so changes can take a while to
                  show up. Keep the address private: anyone who has it can read this calendar.
                </p>
              </section>

              {/* ── what to add ──────────────────────────────────────── */}
              <section style={{ marginTop: 18 }}>
                <div style={{ ...heading, fontSize: 13, letterSpacing: 2, color: 'var(--muted)', marginBottom: 6 }}>WHAT TO ADD</div>
                {groups.map(group => (
                  <div key={group} style={{ marginBottom: 12 }}>
                    <div style={{ ...heading, fontSize: 12, letterSpacing: 2, color: 'var(--neon2)', margin: '10px 0 4px' }}>{group}</div>
                    {CALENDAR_CATEGORIES.filter(c => c.group === group).map(c => (
                      <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 2px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                        <span style={{ flex: 1, fontSize: 13.5 }}>{c.label}</span>
                        <Toggle on={cats[c.key]} onFlip={() => flipCategory(c.key)} disabled={busy} label={c.label} />
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            </>
          )}

          {!enabled && (
            <p style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.6, marginTop: 14 }}>
              Turning sync off stops YesPleez publishing your calendar. Your choices below are kept
              for when you turn it back on.
            </p>
          )}
        </>
      )}
    </div>
  );
}
