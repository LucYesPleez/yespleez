import { formatDisplayDate } from '../lib/dates';
import { askCategoryLabel } from '@yespleez/ask-categories';

/**
 * One enquiry YOU sent to a venue.
 *
 * ⚠ EXTRACTED FROM ArtistDashboard, UNCHANGED. It moved here when HostDashboard
 * grew the same list — a promoter asking a venue about a night is the same
 * record, the same statuses and the same question as a DJ asking about one, and
 * a second copy of this card is two cards free to drift apart.
 *
 * ⛔ NOT AN EVENT CARD. An availability enquiry has no event: no name, no
 * lineup, no poster, no time — only a venue, a date, a note and a status. An
 * EventCard filled with blanks reads as broken, and the Rendering Contract is
 * explicit that absent ≠ broken. So this renders exactly what exists.
 *
 * `accent` is the ASKER's identity colour, passed in by the dashboard —
 * cyan on a DJ's, magenta on a host's. ⛔ Never hardcoded here: this component
 * knows nothing about who is asking, and that is what lets it be shared.
 */
export default function OutgoingEnquiryRow({ enq, badge, badgeColor, accent }) {
  const sentOn = enq.created_at ? formatDisplayDate(enq.created_at.slice(0, 10)) : '';
  const forDate = enq.date_requested ? formatDisplayDate(enq.date_requested) : null;
  const venueName = enq.venue?.name || 'A venue';
  /**
   * P12 — what this ask was FOR. ⛔ Null renders nothing: a historical row, an
   * asker with no applicable category, or a key the registry no longer knows
   * all mean "no chip", never a placeholder and never the raw key.
   *
   * ⚠ A HOST'S ENQUIRIES ARE ALWAYS CHIPLESS, and correctly so. An Ask Category
   * describes the requested SUPPLY, and a promoter asking a venue for a room is
   * not asking for music, comedy or workshops. `ask_category` is stored NULL at
   * creation for them — ⛔ do not invent a category here to fill the space.
   */
  const askLabel = askCategoryLabel(enq.ask_category);

  return (
    <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: .5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {venueName}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* ⭐ The chip says what was asked FOR. The pipeline badge beside it
              says where it is up to. Two dimensions, never collapsed — the chip
              must never read "Enquiry" or "Application". */}
          {askLabel && (
            <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1,
                           padding: '2px 8px', borderRadius: 20, color: accent,
                           border: `1px solid ${accent}`, opacity: .85 }}>
              {askLabel.toUpperCase()}
            </span>
          )}
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, color: badgeColor }}>
            {badge}
          </span>
        </div>
      </div>
      {/* The date asked about is the point of the enquiry — never buried. */}
      {forDate && (
        <div style={{ fontSize: 13, color: accent, marginTop: 3 }}>Availability · {forDate}</div>
      )}
      {enq.note && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {enq.note}
        </div>
      )}
      {sentOn && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 6 }}>Sent {sentOn}</div>}
    </div>
  );
}
