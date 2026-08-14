import { useEffect, useState } from 'react';
import { listMyVenueSubmissions, STATUS_LABELS } from '../lib/venueSubmissions';

/**
 * MY VENUE SUBMISSIONS — the organiser's side of venue moderation.
 *
 * ⭐⭐ THE REASON THIS EXISTS: a decision the submitter cannot see is not a
 * decision, it is a disappearance. Studio can confirm a place into the
 * catalogue or decline it, and before this the organiser had no way to learn
 * which had happened. They asked, and then nothing.
 *
 * ⛔ RENDERS NOTHING WHEN THERE ARE NO SUBMISSIONS. Most organisers pick an
 * existing venue and never ask for one, and an empty "no submissions" panel on
 * every host dashboard would be a permanent hole for a feature they have not
 * used. Absent is not the same as empty (rendering contract).
 *
 * ⚠ THE STATUS SAYS NOTHING ABOUT THE EVENT, and the copy has to make that
 * plain. A declined submission leaves the night completely intact: it keeps the
 * location the organiser typed, and the only thing refused was catalogue
 * membership. Read as "your event was rejected", this panel would frighten
 * people out of ever submitting.
 */

const TONE = {
  pending:   { fg: 'var(--muted)', bg: 'rgba(255,255,255,.06)', bd: 'rgba(255,255,255,.14)' },
  confirmed: { fg: '#7FE3C0',      bg: 'rgba(0,229,255,.10)',   bd: 'rgba(0,229,255,.35)' },
  declined:  { fg: '#FF8FA8',      bg: 'rgba(255,45,120,.10)',  bd: 'rgba(255,45,120,.30)' },
};

/* One line per state, in the organiser's terms. ⛔ Never leave `declined`
   without the reassurance: the event is the thing they care about. */
const EXPLAIN = {
  pending:   'We are checking whether this place can join the venue directory.',
  confirmed: 'This place is now a YesPleez venue and your event links to it.',
  declined:  'Not added to the venue directory. Your event is unchanged and still uses the location you entered.',
};

function StatusPill({ status }) {
  const t = TONE[status] || TONE.pending;
  return (
    <span style={{
      fontFamily: "'DM Sans'", fontWeight: 700, fontSize: 10, letterSpacing: .4,
      color: t.fg, background: t.bg, border: `1px solid ${t.bd}`,
      borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap',
    }}>
      {(STATUS_LABELS[status] || status).toUpperCase()}
    </span>
  );
}

export default function MyVenueSubmissions() {
  const [rows, setRows]       = useState(null);   // null = still loading

  useEffect(() => {
    let alive = true;
    listMyVenueSubmissions().then(r => { if (alive) setRows(r.rows); });
    return () => { alive = false; };
  }, []);

  // ⛔ Nothing at all while loading, and nothing when empty. A skeleton here
  // would flash a panel most organisers should never see.
  if (!rows || rows.length === 0) return null;

  return (
    <div id="section-venue-submissions" style={{ marginTop: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {/* ⚠ Bebas Neue has ONE weight. No bold, or it faux-bolds and stops
            matching every other heading on this screen. */}
        <span style={{ fontFamily: "'Bebas Neue'", fontWeight: 400, fontSize: 13, letterSpacing: 2.5, color: '#fff' }}>
          MY VENUE SUBMISSIONS
        </span>
        <span style={{
          fontFamily: "'DM Sans'", fontWeight: 700, fontSize: 11, color: 'var(--muted)',
          background: 'var(--card2)', borderRadius: 8, padding: '1px 7px',
        }}>{rows.length}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => (
          <div key={r.id} style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '11px 13px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: "'DM Sans'", fontWeight: 700, fontSize: 14, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.name}
              </span>
              <StatusPill status={r.status} />
            </div>

            {/* Locality only when it was given. ⛔ No placeholder dash: an
                unknown town is absent, not empty. */}
            {(r.suburb || r.state) && (
              <div style={{ fontFamily: "'DM Sans'", fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                {[r.suburb, r.state].filter(Boolean).join(', ')}
              </div>
            )}

            <div style={{ fontFamily: "'DM Sans'", fontSize: 11.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.45 }}>
              {EXPLAIN[r.status] || ''}
            </div>

            {/* The reviewer's reason, when there is one. A decline without its
                stated reason is the silent outcome this panel exists to end. */}
            {r.status === 'declined' && r.decision_note && (
              <div style={{
                fontFamily: "'DM Sans'", fontSize: 11.5, color: 'var(--text)',
                marginTop: 7, paddingTop: 7, borderTop: '1px solid var(--border)', lineHeight: 1.45,
              }}>
                {r.decision_note}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
