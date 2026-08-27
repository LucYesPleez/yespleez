/**
 * "IS THIS ALREADY AN EVENT?" — the Scene half of the check.
 *
 * ⭐⭐ ONE REAL EVENT REPRESENTS ONE CONTINUOUS EVENT (ratified 2026-08-27). A
 * Friday-to-Sunday festival is ONE event with three days inside it. This is the
 * last line of defence: the editor now makes a multi-day event easy to build, and
 * this notices when somebody is building the old way anyway.
 *
 * ⛔⛔ IT WARNS. IT NEVER BLOCKS. Two different gigs at one venue on one night are
 * completely normal. Every finding is a question put to the organiser, who knows
 * the answer; the app does not. There is no confirm step and nothing to dismiss,
 * because the notice is not in anyone's way.
 *
 * ⭐ THE RULES LIVE IN THE EDITOR PACKAGE (`findRelatedEvents`), the QUERY lives
 * here. That split is deliberate: ⛔ no database knowledge travels with the
 * shared package, exactly as with poster uploads and `rowsToDays`.
 */
import { useState, useEffect } from 'react';
import { findRelatedEvents, DUPLICATE_REASON } from '@yespleez/event-editor';
import { supabase } from '../lib/supabase';
import { ownedByFilter } from '../lib/eventOwnership';

/* How far either side of the candidate's start to look. The detector's own date
   rules are much tighter (overlapping, or one day apart); this only has to be
   wide enough that it never has to run a second query. */
const WINDOW_DAYS = 21;

function shiftIso(iso, days) {
  const d = new Date(iso + 'T12:00:00');   // ⛔ noon, never midnight: DST
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DuplicateEventWarning({ id, name, startDate, endDate, venue, venueProfileId, userId, hostProfileId }) {
  const [hits, setHits] = useState([]);

  useEffect(() => {
    /* ⚠ A name of at least two words AND a date. Querying on every keystroke of
       an empty form would ask the database a question with no answer in it. */
    if (!startDate || String(name || '').trim().split(/\s+/).length < 2 || !userId) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const from = shiftIso(startDate, -WINDOW_DAYS);
    const to = shiftIso(endDate && endDate > startDate ? endDate : startDate, WINDOW_DAYS);

    /* ⚠ THE ORGANISER'S OWN EVENTS ONLY. Somebody else's event at the same venue
       on the same night is not this organiser's duplicate, and surfacing it
       would leak what another host has in the diary. */
    supabase.from('events')
      .select('id, name, config')
      .or(ownedByFilter(userId, hostProfileId))
      .gte('config->>date', from)
      .lte('config->>date', to)
      .then(({ data }) => {
        if (cancelled) return;
        const existing = (data || []).map(e => ({
          id: e.id,
          name: e.name,
          venue: e.config?.venue || '',
          venueProfileId: e.config?.venueProfileId || null,
          startDate: e.config?.date || '',
          endDate: e.config?.endDate || '',
        }));
        setHits(findRelatedEvents({ id, name, venue, venueProfileId, startDate, endDate }, existing));
      });
    return () => { cancelled = true; };
  }, [id, name, startDate, endDate, venue, venueProfileId, userId, hostProfileId]);

  if (!hits.length) return null;

  return (
    <div style={{
      background: 'rgba(255,140,66,.12)', border: '1px solid rgba(255,140,66,.45)',
      borderRadius: 10, padding: '11px 13px', marginBottom: 14,
      fontSize: 12.5, lineHeight: 1.5, color: '#FF8C42',
    }}>
      {/* ⛔ NO EM DASHES IN USER-FACING COPY. */}
      <div style={{ fontWeight: 600, marginBottom: 5 }}>
        {hits.length === 1 ? 'You already have a similar event' : 'You already have similar events'}
      </div>
      <div style={{ marginBottom: 7, color: 'rgba(255,255,255,.72)' }}>
        {hits.some(h => h.reason === DUPLICATE_REASON.SAME_NAME)
          ? 'If this is another day of the same event, add it as a day inside that event rather than creating a new one. Set a last day above.'
          : 'If this is the same event, edit the existing one instead.'}
      </div>
      <ul style={{ margin: 0, paddingLeft: 16, color: 'rgba(255,255,255,.72)' }}>
        {hits.slice(0, 3).map(h => (
          <li key={h.id}>
            {h.name} <span style={{ opacity: .7 }}>({h.startDate}{h.endDate && h.endDate > h.startDate ? ` to ${h.endDate}` : ''})</span>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 7, color: 'rgba(255,255,255,.5)', fontSize: 11.5 }}>
        If it really is a separate event, carry on. Nothing is blocked.
      </div>
    </div>
  );
}
