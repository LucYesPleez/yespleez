import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { formatDisplayDate, today } from '../lib/dates';
import { indexByDate, buildMarkers, summariseDate, statusesPresent, dotColour } from '../lib/enquiryCalendar';
import AvailabilityCalendar from './AvailabilityCalendar';
import { CalendarIconBtn } from './DecisionButtons';

/* ⛔⛔ WAS `new Date().toISOString().split('T')[0]` — the UTC date, which east of
   Greenwich is YESTERDAY until mid-morning. ⚠ Every AU user before ~10am was
   offered a past day as today. See lib/dates.js. */
const TODAY = () => today();

/**
 * ⚠ PROFILE-KEYED. `profileId` is required; `userId` is written for RLS and
 * audit only and must never be read back by.
 *
 * This component was keyed on `userId` alone, and `artist_availability` serves
 * artist, band, standup AND host. One account's profiles therefore shared a
 * single set of dates: a comedian's calendar was their DJ act's, and a host
 * marking themselves free moved their DJ profile's availability. Venue
 * availability has always carried `profile_id`; this is the performer side
 * catching up.
 *
 * If you are tempted to restore a `user_id` fallback for "profiles that have
 * no dates yet" — don't. An empty calendar for a new profile is the correct
 * answer; the fallback is the bug.
 */
export default function AvailabilitySection({
  userId,
  profileId,
  /** Bump to re-read the dates — see the load effect. */
  reloadKey  = 0,
  table      = 'artist_availability',
  /**
   * ── ⚠ THE UPSERT'S CONFLICT TARGET, AND WHY IT IS A PROP ─────────────
   *
   * The two availability tables carry DIFFERENT unique constraints:
   *
   *   artist_availability  UNIQUE (profile_id, available_date)
   *   venue_availability   UNIQUE (user_id,    available_date)
   *
   * Postgres rejects an `ON CONFLICT` naming columns with no matching
   * constraint, so hardcoding the performer's target here would have made
   * every venue date-toggle throw the moment this component was reused.
   *
   * ⛔ NOT "fixed" by adding a profile-level index to venue_availability.
   * That is a migration, it changes what a duplicate MEANS for accounts with
   * more than one venue, and this task was a component swap. The venue keeps
   * the account-level constraint it has always had.
   */
  conflictTarget = 'profile_id,available_date',
  accent     = '#00E5FF',
  accentRgb  = '0,229,255',
  sectionId,
  /**
   * ── ⭐⭐ THE OWNER'S COMPLETE DATE STATE ─────────────────────────────
   *
   * The enquiries and applications already held by the screen embedding this
   * section. Optional: a surface with none passes nothing and this renders
   * exactly as it always has.
   *
   * ⚠ WHY THE EDITOR NEEDS THEM AT ALL. Without this, Available Dates said
   * "14 August: available" while silently withholding that two acts had
   * already applied for it — a truthful half-answer that made the owner
   * responsible for remembering to check Enquiries before touching a date.
   * The calendar now tells them, so a date can never be changed in ignorance
   * of what is already against it.
   *
   * ⛔ Never reaches the public calendar: ProfileScreen renders
   * AvailabilityCalendar directly and passes no enquiries, so there is
   * nothing to filter and no flag to get wrong.
   */
  enquiries = [],
}) {
  const [localAvail,   setLocalAvail]   = useState(null);
  const [showCal,      setShowCal]      = useState(false);
  const [viewAllHov,   setViewAllHov]   = useState(false);
  // The last date tapped, so the footer can say what is already on it. Held
  // separately from availability: tapping still toggles, and this only decides
  // what the summary underneath is talking about.
  const [touched,      setTouched]      = useState(null);
  /**
   * ⭐ THE PUBLISH SWITCH (ratified 2026-08-14: availability is optional
   * public information). null = not yet read — and the control renders
   * NOTHING until the read lands, so an account whose database predates the
   * S3 migration sees no switch rather than a broken one.
   *
   * ⚠ THE FLAG LIVES ON `profiles`, NOT ON THE DATE ROWS, because it is a
   * property of the PROFILE's public face. The owner keeps editing dates
   * exactly as before while private — that is the whole point: a complete
   * calendar, unpublished. ⚠ The boundary is S3's RLS, not this component;
   * this button only records the choice.
   */
  const [availPrivate, setAvailPrivate] = useState(null);
  useEffect(() => {
    if (!profileId) return undefined;
    let dead = false;
    supabase.from('profiles').select('availability_private').eq('id', profileId).maybeSingle()
      .then(({ data, error }) => {
        if (!dead && !error && data) setAvailPrivate(!!data.availability_private);
      });
    return () => { dead = true; };
  }, [profileId]);
  async function togglePrivate() {
    const next = !availPrivate;
    setAvailPrivate(next); // optimistic — the switch answers the finger
    const { error } = await supabase.from('profiles')
      .update({ availability_private: next }).eq('id', profileId);
    if (error) setAvailPrivate(!next); // the truth wins over the optimism
  }

  useEffect(() => {
    // Reset rather than keep the previous profile's dates on screen while the
    // next set loads — switching acts must not show the wrong calendar even
    // for a frame.
    setLocalAvail(null);
    if (!profileId) return;
    supabase.from(table).select('available_date')
      .eq('profile_id', profileId).gte('available_date', TODAY()).order('available_date').limit(60)
      .then(({ data }) => setLocalAvail((data || []).map(r => r.available_date)));
    /* ⚠ `reloadKey` — the dates can change from OUTSIDE this component now.
       Accepting an enquiry closes that night, and without this the organiser
       who just accepted keeps seeing the date offered on their own screen
       until they reload. ⛔ Not a refetch on every render: a bumped key means
       somebody ASKED, which is the same distinction the dashboard's lineup
       latch got wrong once already. */
  }, [profileId, table, reloadKey]);

  async function toggleDate(dateStr) {
    if (!profileId) return;
    const avail    = localAvail ?? [];
    const wasAvail = avail.includes(dateStr);
    setLocalAvail(wasAvail ? avail.filter(d => d !== dateStr) : [...avail, dateStr].sort());
    if (wasAvail) {
      await supabase.from(table).delete().eq('profile_id', profileId).eq('available_date', dateStr);
    } else {
      // user_id still written: RLS keys on it, and it records which account
      // acted. onConflict matches the new partial unique index.
      await supabase.from(table).upsert(
        { user_id: userId, available_date: dateStr, profile_id: profileId },
        { onConflict: conflictTarget },
      );
    }
  }

  const availability = localAvail ?? [];

  // ⭐ Built by the SAME projection the Enquiries calendar uses, so the two
  // entry points cannot disagree about what is on a date.
  const byDate     = useMemo(() => indexByDate(enquiries), [enquiries]);
  const markers    = useMemo(() => buildMarkers(enquiries), [enquiries]);
  const legend     = useMemo(() => statusesPresent(byDate), [byDate]);
  const hasActivity = Object.keys(byDate).length > 0;

  return (
    <div id={sectionId} style={{ marginTop: 40 }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 2.5, color: '#fff', margin: 0 }}>AVAILABLE DATES</p>
          {/* ⚠ SAME BUTTON ENQUIRIES PUTS BESIDE ITS OWN HEADING. Both open
              the identical calendar with the identical overlay — the icon
              matching everywhere it appears is what tells the owner that. */}
          <CalendarIconBtn onClick={() => setShowCal(true)} label="Open the availability calendar" />
          <span style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 0.3 }}>tap dates to add / remove</span>
        </div>
        <div style={{ flex: 1 }} />
        {/* ⚠ STATES THE CONSEQUENCE, NOT A SETTING NAME. "PUBLIC" / "PRIVATE"
            says what the world currently sees; a label like "publish dates"
            would need the reader to work out which way the toggle points.
            Amber when private — a deliberate standing choice worth noticing on
            every visit, not an alarm. */}
        {availPrivate !== null && (
          <button
            type="button"
            onClick={togglePrivate}
            title={availPrivate
              ? 'Your dates are hidden. Others see "availability not published" and can still enquire.'
              : 'Your available dates are visible on your public profile.'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
              padding: '3px 10px', borderRadius: 999, marginRight: 12,
              border: `1px solid ${availPrivate ? 'rgba(245,158,11,.5)' : 'var(--border)'}`,
              background: 'none', cursor: 'pointer',
              color: availPrivate ? '#F59E0B' : 'var(--muted)',
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 10, letterSpacing: 1.5, lineHeight: 1.6,
            }}
          >
            {availPrivate ? 'PRIVATE' : 'PUBLIC'}
          </button>
        )}
        <button
          onClick={() => setShowCal(true)}
          onMouseEnter={() => setViewAllHov(true)}
          onMouseLeave={() => setViewAllHov(false)}
          style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1, color: viewAllHov ? 'var(--text)' : 'var(--muted)', opacity: viewAllHov ? 1 : 0.5, background: 'none', border: 'none', cursor: 'pointer', padding: 0, transition: 'color .15s, opacity .15s' }}>
          VIEW ALL &gt;
        </button>
      </div>

      {/* Chips */}
      {availability.length === 0
        ? null
        : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {availability.slice(0, typeof window !== 'undefined' && window.innerWidth < 640 ? 8 : 12).map(d => (
              <DateChip key={d} label={formatDisplayDate(d)} accent={accent} accentRgb={accentRgb} onClick={() => setShowCal(true)} />
            ))}
          </div>
        )
      }

      {/* Calendar modal — shared AvailabilityCalendar (11C.2), edit mode:
          any future date is tappable to toggle it on/off. */}
      {showCal && (
        <AvailabilityCalendar
          onClose={() => setShowCal(false)}
          title="MY AVAILABILITY"
          subtitle="Tap dates to mark yourself available. These show on your profile so promoters can find you."
          accent={accent}
          accentRgb={accentRgb}
          availableDates={localAvail ?? []}
          mode="edit"
          markers={hasActivity ? markers : undefined}
          selectedDate={touched}
          onSelectDate={ds => { setTouched(ds); toggleDate(ds); }}
          footer={(() => {
            const fc = (localAvail ?? []).filter(d => d >= TODAY()).length;
            const onDay = touched ? (byDate[touched] || []) : [];
            const sum = summariseDate(onDay);
            return (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {fc ? `${fc} date${fc !== 1 ? 's' : ''} marked available` : 'No dates marked yet'}
                </div>
                {/* ⚠ WHAT IS ALREADY ON THE DATE YOU JUST TOUCHED. The dots
                    warn that something exists; this says what. It appears only
                    when there IS something — a permanent empty row would train
                    the eye to ignore the place the warning appears. */}
                {sum.total > 0 && (
                  <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: 1.5, color: 'var(--text)' }}>
                        {formatDisplayDate(touched)}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text)' }}>
                        {sum.total} {sum.total === 1 ? 'enquiry' : 'enquiries'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6 }}>
                      {sum.breakdown.map(({ status, count }) => (
                        <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--muted)' }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: dotColour(status), display: 'block' }} />
                          {count} {status}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {/* The key, listing only what is actually on screen. */}
                {hasActivity && legend.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
                    {legend.map(st => (
                      <span key={st} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.3, color: 'var(--muted)' }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: dotColour(st), display: 'block' }} />
                        {st.toUpperCase()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        />
      )}
    </div>
  );
}

function DateChip({ label, accent, accentRgb, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <span
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 1,
        color: hov ? accent : 'var(--muted)',
        background: hov ? `rgba(${accentRgb},.08)` : 'var(--card2)',
        border: `1px solid ${hov ? `rgba(${accentRgb},.4)` : 'var(--border)'}`,
        borderRadius: 8, padding: '5px 12px', cursor: 'pointer',
        transition: 'color .15s, border-color .15s, background .15s',
      }}
    >{label}</span>
  );
}
