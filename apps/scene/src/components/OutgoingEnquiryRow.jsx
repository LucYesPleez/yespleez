import { useState } from 'react';
import { formatDisplayDate } from '../lib/dates';
import { askCategoryLabel } from '@yespleez/ask-categories';
import { normaliseStatus } from '../lib/enquiryUtils';

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
export default function OutgoingEnquiryRow({ enq, badge, badgeColor, accent, onCancel, onClear }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
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

  /**
   * ⭐ CANCEL — THE SENDER'S ONE DECISION.
   *
   * The asker cannot accept or decline their own ask; withdrawing it is the
   * only move they hold. `EnquiryCard` has offered exactly this on the venue
   * and host surfaces (CANCEL ENQUIRY, which writes `declined`); this row is
   * the performer's equivalent and had none, so an enquiry sent for the wrong
   * date could only sit there.
   *
   * ⚠ ONLY WHILE IT IS STILL OPEN. `normaliseStatus` is the same bucketing
   * every tab uses, so this can never disagree with the tab the row sits in —
   * a settled row (accepted / declined / booked) has nothing left to cancel.
   */
  const bucket = normaliseStatus({ ...enq, direction: 'outgoing' });
  /* ⭐ `accepted` included (owner, 2026-09-01) — see the matching note in
     EnquiryCard. ⚠ THIS LIST AND THAT ONE MUST AGREE: they are two renderings
     of one decision, on two dashboards, and they have drifted before. */
  const canCancel = Boolean(onCancel) && ['awaiting', 'interested', 'accepted'].includes(bucket);

  /**
   * ⭐ CLEAR — only on a row that is FINISHED, and only ever a hide.
   *
   * ⛔ NOT on an open ask. Tidying away something you are still waiting on
   * would lose the thread with no way back, which is what CANCEL is for and
   * why the two never appear together.
   *
   * ⛔ NOT A DELETE. The venue's answer stays in the venue's history; this row
   * simply stops appearing here (owner: "hide it from me only").
   */
  const canClear = Boolean(onClear) && bucket === 'declined';

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
      {/* ⚠ THE SENT LINE CARRIES THE CANCEL CONTROL, so the card does not grow
          a row to hold it. A button on its own line made every awaiting row
          taller than every settled one, and a list you scroll is mostly rows
          you are not about to cancel. `marginTop: 6` and the 11px caption are
          unchanged — the control sits in space the row already occupied.
          ⚠ minHeight holds the line when there is no `sentOn`, so a row with
          no date does not close up around the button. */}
      {(sentOn || canCancel || canClear) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, minHeight: 20 }}>
          {sentOn && <span style={{ fontSize: 11, color: 'rgba(255,255,255,.35)' }}>Sent {sentOn}</span>}
          {/* ⚠ Quieter than CANCEL — grey, not red. Clearing destroys nothing,
              and dressing it in the same warning colour as a withdrawal would
              overstate it. */}
          {canClear && (
            <button type="button" onClick={() => onClear(enq.id)}
              style={{ marginLeft: 'auto', fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '3px 9px', borderRadius: 6, border: '1px solid rgba(255,255,255,.18)', background: 'transparent', color: 'rgba(255,255,255,.55)', cursor: 'pointer' }}>
              CLEAR
            </button>
          )}
          {canCancel && !confirming && (
            <button type="button" onClick={() => setConfirming(true)}
              style={{ marginLeft: 'auto', fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '3px 9px', borderRadius: 6, border: '1px solid rgba(255,51,51,.3)', background: 'rgba(255,51,51,.06)', color: 'rgba(255,80,80,.8)', cursor: 'pointer' }}>
              CANCEL ENQUIRY
            </button>
          )}
        </div>
      )}

      {/* ── ⭐ CANCEL — THE SENDER'S ONE DECISION ─────────────────────────
          The asker cannot accept or decline their own ask; withdrawing it is
          the only move they hold. `EnquiryCard` has offered exactly this on
          the venue and host surfaces (CANCEL ENQUIRY → writes `declined`);
          this row is the performer's equivalent and had none, so an enquiry
          sent to the wrong date could only sit there.

          ⚠ WRITES `declined`, THE SAME STATUS EnquiryCard WRITES. ⛔ Not a
          delete: the venue may already have read it, and erasing a
          conversation from one side is not the same as ending it. `declined`
          is also what both the OUTGOING sub-tabs and the venue's own view
          already understand, so no new status enters the vocabulary.

          ⚠ ONLY WHILE THERE IS SOMETHING TO WITHDRAW. `normaliseStatus` is the
          same bucketing every tab uses, so this button can never disagree with
          the tab the row is sitting in. `declined` is the one settled state
          with nothing left to cancel — CLEAR is that row's control.

          ⭐ `accepted` IS CANCELLABLE (owner, 2026-09-01). Plans fall through,
          and an act with no way to say so simply goes silent on the venue.

          ⚠ TWO STEPS, matching ApplicationRow's delete directly above it in
          the same list. Cancelling cannot be undone, and on an ACCEPTED ask it
          now tells the venue their spot is open again — so a single tap next
          to the card you were reading is too cheap. */}
      {/* ⚠ ONLY THE CONFIRM STEP COSTS HEIGHT, and only on the one row you are
          acting on. That is the trade: the resting state adds nothing, and the
          moment you are deciding is the moment a row may grow. */}
      {canCancel && confirming && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,45,45,.08)', border: '1px solid rgba(255,45,45,.3)', borderRadius: 10, padding: '8px 10px', marginTop: 8 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginRight: 'auto' }}>Cancel this enquiry?</span>
          <button type="button" onClick={() => setConfirming(false)} disabled={busy}
            style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '3px 9px', borderRadius: 6, border: '1px solid rgba(255,255,255,.2)', background: 'transparent', color: 'rgba(255,255,255,.7)', cursor: 'pointer' }}>
            KEEP IT
          </button>
          <button type="button" disabled={busy}
            /* ⚠ THE ROW, ⛔ not `enq.id`. Cancelling an accepted ask notifies
               the venue, and the delivery identity plus the status being
               cancelled live on the row — an id alone cannot address anyone. */
            onClick={async () => { setBusy(true); await onCancel(enq); setBusy(false); setConfirming(false); }}
            style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1, padding: '3px 9px', borderRadius: 6, border: '1px solid rgba(255,51,51,.5)', background: 'rgba(255,51,51,.15)', color: '#fff', cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'CANCELLING…' : 'YES, CANCEL'}
          </button>
        </div>
      )}
    </div>
  );
}
