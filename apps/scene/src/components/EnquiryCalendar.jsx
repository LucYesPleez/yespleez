import { useState, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import AvailabilityCalendar from './AvailabilityCalendar';
import { normaliseStatus } from '../lib/enquiryUtils';
import { indexByDate, buildMarkers, summariseDate, statusesPresent, dotColour } from '../lib/enquiryCalendar';
import { formatDisplayDate } from '../lib/dates';

/**
 * THE AVAILABILITY CALENDAR, OPENED PRIVATELY.
 *
 * ⭐⭐ THIS IS NOT A CALENDAR. It is the availability calendar modal with an
 * overlay handed to it — same component, same modal chrome, same month
 * navigation, same grid, same availability table. Everything here is data
 * preparation and a footer.
 *
 * ⛔ AN EARLIER PASS RENDERED A PERMANENT CALENDAR INSIDE THE ENQUIRIES
 * SECTION. That was two calendars in the product however much code they
 * shared: one you opened from Available Dates and one that sat there. The
 * organiser opens ONE calendar and sometimes it knows more, because they are
 * signed in and looking at their own dashboard.
 *
 * ── ⚠ READ-ONLY, AND WHY IT READS AT ALL ─────────────────────────────
 * `AvailabilitySection` owns the availability EDITOR and fetches its own
 * dates. This reads the same table with the same profile key and never writes.
 * One source of truth read twice, not two stores. A date toggled in the editor
 * is not reflected until this reopens — which, now that it is a modal opened
 * on demand, is every time it is used.
 *
 * ── DATES ARE THE EVENT'S, NOT THE APPLICATION'S ─────────────────────
 * ⛔ A dot is the date being applied FOR, never the date the application
 * arrived. The list's SORT BY control answers the other question. A calendar
 * keyed on submission dates would cluster on the day someone opened the app,
 * which describes nothing about the diary.
 */

export default function EnquiryCalendar({
  profileId,
  table = 'artist_availability',
  enquiries = [],
  accent = '#00E5FF',
  accentRgb = '0,229,255',
  onClose,
}) {
  const [selected, setSelected] = useState(null);
  const [available, setAvailable] = useState([]);

  useEffect(() => {
    setAvailable([]);
    if (!profileId) return;
    // ⚠ NO `gte(today)`, unlike the editor. A diary has to look backwards —
    // "was I free the night that act played" is a question about the past, and
    // the editor's future-only window would answer it wrong rather than not.
    supabase.from(table).select('available_date').eq('profile_id', profileId).order('available_date')
      .then(({ data }) => setAvailable((data || []).map(r => r.available_date)));
  }, [profileId, table]);

  // ⭐ The SAME projection Available Dates uses — see lib/enquiryCalendar.
  const byDate  = useMemo(() => indexByDate(enquiries), [enquiries]);
  const markers = useMemo(() => buildMarkers(enquiries), [enquiries]);
  const legend  = useMemo(() => statusesPresent(byDate), [byDate]);

  const dayList = selected ? (byDate[selected] || []) : [];
  const isAvailable = selected ? available.includes(selected) : false;
  const { breakdown } = useMemo(() => summariseDate(dayList), [dayList]);

  const footer = (
    <div style={{ marginTop: 16 }}>
      {/* ── THE DAY ─────────────────────────────────────────────────────
          Replaces the key while a date is open: the reader has stopped
          scanning and is asking about one day, so the legend has nothing left
          to explain. */}
      {selected ? (
        <div style={{ borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: 1.5, color: 'var(--text)' }}>
              {formatDisplayDate(selected)}
            </span>
            {/* ⛔ TWO STATES, NOT THREE. `available_date` rows are additive — a
                date is present or absent — so there is no stored "unavailable".
                Saying it would assert a decision never recorded. */}
            <span style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.4, color: isAvailable ? accent : 'var(--muted)' }}>
              {isAvailable ? 'AVAILABLE' : 'NO AVAILABILITY SET'}
            </span>
            <button onClick={() => setSelected(null)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.3, cursor: 'pointer' }}>
              CLEAR
            </button>
          </div>

          {dayList.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>Nothing against this date.</p>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text)' }}>
                  {dayList.length} {dayList.length === 1 ? 'application' : 'applications'}
                </span>
                {breakdown.map(({ status, count }) => (
                  <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--muted)' }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: dotColour(status), display: 'block' }} />
                    {count} {status}
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dayList.map(e => (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 8, padding: '8px 10px' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColour(normaliseStatus(e)), flexShrink: 0, display: 'block' }} />
                    <span style={{ fontSize: 13, color: 'var(--text)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {e.name || e.profile?.name || '—'}
                    </span>
                    {e.event_name && (
                      <span style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{e.event_name}</span>
                    )}
                    <span style={{ marginLeft: 'auto', fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.3, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {normaliseStatus(e).toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        /* ── THE KEY ───────────────────────────────────────────────────
           ⚠ ONLY THE STATUSES ACTUALLY ON SCREEN. A fixed key listing all
           eight would explain colours the reader cannot see and imply
           activity that is not there. */
        legend.length > 0 && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: 12, display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
            {legend.map(s => (
              <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.3, color: 'var(--muted)' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: dotColour(s), display: 'block' }} />
                {s.toUpperCase()}
              </span>
            ))}
          </div>
        )
      )}
    </div>
  );

  return (
    <AvailabilityCalendar
      onClose={onClose}
      title="ENQUIRY CALENDAR"
      subtitle="Your availability, with what has been asked of each date."
      accent={accent}
      accentRgb={accentRgb}
      availableDates={available}
      markers={markers}
      selectedDate={selected}
      onSelectDate={ds => setSelected(cur => (cur === ds ? null : ds))}
      footer={footer}
    />
  );
}
