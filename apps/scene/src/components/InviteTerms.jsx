import { formatDisplayDate } from '../lib/dates';

/**
 * ⭐⭐ WHAT IS ACTUALLY BEING OFFERED — the facts you need to answer an invite.
 *
 * ⛔⛔ THE BELL OFFERED "ACCEPT / DECLINE" AND NOTHING TO DECIDE ON (owner,
 * 2026-09-01: "it says you've been offered a slot, accept or decline, but how
 * am I supposed to know what the gig is"). The row read only "You've received
 * an invite to perform." — while the date and the fee were sitting unused in
 * the very same `data` blob.
 *
 * ⚠⚠ AND THE TWO SURFACES HAD DRIFTED. NotificationsScreen already rendered
 * this block; NotifPanel never did. They are twins, the file that computes
 * their destination says so in its header, and this is exactly the drift that
 * warning describes — one of them grew the fix and the other kept shipping the
 * decision without the facts. So it lives HERE now, once, and both render it.
 * ⛔ Do not inline a third copy.
 *
 * ⛔ ABSENT, NEVER EMPTY. An invite with neither date nor fee renders nothing
 * at all rather than a labelled box with blanks in it — a hole where a fact
 * should be reads as broken, and "not stated yet" is an ordinary state for an
 * invite to a night that has not been built (Rendering Contract R3/R4).
 */
export default function InviteTerms({ data }) {
  const date = data?.proposed_date || null;
  const fee  = data?.proposed_fee  || null;
  if (!date && !fee) return null;

  return (
    <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(255,255,255,.04)', borderRadius: 8, display: 'flex', gap: 20 }}>
      {date && (
        <div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', fontFamily: "'Bebas Neue',sans-serif", letterSpacing: 1 }}>DATE</div>
          {/* ⚠ FORMATTED, ⛔ not the raw column. It was printing `2026-09-11`
              at somebody trying to decide whether they are free that night. */}
          <div style={{ fontSize: 13, color: '#fff', fontFamily: "'DM Sans',sans-serif" }}>{formatDisplayDate(date)}</div>
        </div>
      )}
      {fee && (
        <div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', fontFamily: "'Bebas Neue',sans-serif", letterSpacing: 1 }}>FEE</div>
          <div style={{ fontSize: 13, color: '#fff', fontFamily: "'DM Sans',sans-serif" }}>{fee}</div>
        </div>
      )}
    </div>
  );
}
