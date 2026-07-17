import { formatLocation } from '../lib/formatLocation';
import { PROFILE_TYPES } from '../lib/profileTypes';
import DateBox from './DateBox';

const ACCENT = PROFILE_TYPES.venue.accent;   // a venue is pitching you
const RGB    = PROFILE_TYPES.venue.rgb;

const UNREAD     = ['new', 'pending'];
const UNDECIDED  = ['new', 'pending', 'seen', 'viewed'];
const CONSIDERED = ['shortlisted', 'interested', 'tentative'];

/**
 * Level 1 — the Opportunity Card. Triage, not detail.
 *
 * Deliberately ~20% of the Booking Invitation: only what's needed to decide
 * "can I kill this now, or is it worth opening?" Everything that builds the
 * confidence to say YES lives in Level 2 — this surface carries the
 * elimination criteria (date/clash, location, fit) plus one value hook.
 *
 * Actions are stage-scoped: a card only ever offers the moves that are live
 * where it currently sits, so the artist faces one decision, not five.
 * Accept is deliberately absent — you can't meaningfully accept an offer whose
 * terms this surface doesn't show. That lives in Level 2.
 *
 * Props:
 *   offer        – venue_enquiries row + { venueProfile, venue_name }
 *   availability – { status: 'free'|'clash'|'unknown', clashWith?: string }
 *   onOpen / onConsider / onDecline
 */
export default function OpportunityCard({ offer, availability, onOpen, onConsider, onDecline }) {
  const vp        = offer.venueProfile || {};
  const venueName = offer.venue_name || vp.name || 'A venue';
  const thumb     = vp.avatar_thumb || vp.avatar || PROFILE_TYPES.venue.defaultImage;
  const loc       = formatLocation(vp);
  const dateRaw   = offer.proposed_date || offer.date_requested || null;
  const status    = (offer.status || 'new').toLowerCase();
  const fee       = (offer.proposed_fee || '').trim();
  const extras    = Array.isArray(offer.extras) ? offer.extras : [];

  const isUnread    = UNREAD.includes(status);
  const isUndecided = UNDECIDED.includes(status);
  const isDeclined  = ['declined', 'rejected', 'cancelled'].includes(status);

  // The one value hook — the deal, compressed. Not the full breakdown (that's
  // Level 2); just enough to know whether it's worth a look.
  const dealLine = [fee, extras.length ? `+ ${extras.join(' + ').toLowerCase()}` : '']
    .filter(Boolean).join(' ');

  const stop = fn => e => { e.stopPropagation(); fn?.(offer); };

  return (
    <div
      onClick={() => onOpen?.(offer)}
      style={{
        padding: 14, marginBottom: 8, cursor: 'pointer',
        background: 'var(--card)', border: `1px solid rgba(${RGB},${isUndecided ? '.25' : '.14'})`,
        borderRadius: 14, transition: 'border-color .15s, transform .15s',
        opacity: isDeclined ? .55 : 1,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = `rgba(${RGB},.55)`; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = `rgba(${RGB},${isUndecided ? '.25' : '.14'})`; e.currentTarget.style.transform = ''; }}
    >
      <div style={{ display: 'flex', gap: 12 }}>
        <img src={thumb} alt={venueName} style={{ width: 52, height: 52, borderRadius: 10, objectFit: 'cover', border: `1px solid rgba(${RGB},.4)`, flexShrink: 0 }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Fit signal — the event, the fastest read of "is this my scene" */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Read is metadata: a dot, never a bucket */}
            {isUnread && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FFD700', flexShrink: 0 }} />}
            <span style={{ fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: .5, color: '#fff', lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {offer.event_name || 'Booking invitation'}
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {venueName}{loc ? ` · ${loc}` : ''}
          </div>

          {/* The single value hook */}
          {dealLine && (
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: .5, color: '#00E5A0', marginTop: 6 }}>{dealLine}</div>
          )}

          {/* The gate — the thing no email can tell you */}
          {availability && availability.status !== 'unknown' && (
            <div style={{ fontSize: 11, marginTop: 5, color: availability.status === 'clash' ? '#FFB830' : 'rgba(0,229,160,.9)' }}>
              {availability.status === 'clash'
                ? `⚠ Same night as ${availability.clashWith || 'another gig'}`
                : "✓ You're free that night"}
            </div>
          )}

          {/* Legitimacy signal — that a human wrote to you, not the message itself */}
          {offer.message && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              💬 {venueName} wrote to you
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
          {isUnread && (
            <span style={{ fontFamily: "'Bebas Neue'", fontSize: 9, letterSpacing: 1.5, color: '#FFD700', border: '1px solid #FFD700', borderRadius: 4, padding: '2px 6px' }}>NEW</span>
          )}
          {isDeclined && (
            <span style={{ fontFamily: "'Bebas Neue'", fontSize: 9, letterSpacing: 1.5, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>DECLINED</span>
          )}
          {dateRaw && <DateBox date={dateRaw} size="sm" />}
        </div>
      </div>

      {/* Stage-scoped verbs — only the moves that are live right now */}
      {(isUndecided || CONSIDERED.includes(status)) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,.06)' }}>
          {isUndecided && (
            <button onClick={stop(onConsider)}
              style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, padding: '6px 14px', borderRadius: 8, cursor: 'pointer', background: 'rgba(0,180,216,.1)', border: '1px solid rgba(0,180,216,.4)', color: '#00B4D8' }}
            >CONSIDER</button>
          )}
          <button onClick={stop(onDecline)}
            style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, padding: '6px 14px', borderRadius: 8, cursor: 'pointer', background: 'none', border: '1px solid rgba(255,80,80,.25)', color: 'rgba(255,120,120,.75)' }}
          >DECLINE</button>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, color: ACCENT, marginLeft: 'auto' }}>VIEW OFFER →</span>
        </div>
      )}
    </div>
  );
}
