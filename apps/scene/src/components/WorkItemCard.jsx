/**
 * THE EVENT WORKSPACE'S CARD — an operational work item, ⛔ not a poster tile.
 *
 * ⭐⭐ THE ACCEPTANCE TEST THIS IS BUILT AGAINST (owner, 2026-08-15). Not "every
 * state is represented" — a host looks at one card and immediately knows:
 *
 *     WHO is this · WHAT state are they in · WHAT happens next ·
 *     WHICH BUTTON does it.
 *
 * So the card has exactly three bands, in that order: identity, state, action.
 * Anything that does not serve one of those was removed rather than shrunk.
 *
 * ── ⛔ WHAT THIS DOES NOT DO ────────────────────────────────────────────────
 *
 * It knows nothing about the database and holds no state model of its own. The
 * two ladders stay exactly where they were — `applications.status` through
 * `normaliseStatus`, and the slot lifecycle through `memberState` — and this
 * file only chooses WORDS and COLOUR for a state it is handed. ⛔ Adding a
 * status here, or deriving one, would be a third vocabulary.
 *
 * ⚠ USED BY `EventHostView` ONLY. The dashboard stays triage and keeps
 * `ProfileCard` (owner: "do not make the dashboard a second full event
 * management workspace").
 */
import s from './WorkItemCard.module.css';
import { profileIdentity } from '../lib/profileTypes';
import { formatLocation } from '../lib/formatLocation';
import UnclaimedBadge from './UnclaimedBadge';

/**
 * ⭐ THE APPLICATION LADDER, AS THE HOST READS IT.
 *
 * ⚠ `onBill` is NOT an application status and is deliberately not treated as
 * one — it is read from `lineup_members`, and it is the reason ACCEPTED splits
 * into two rows here. An accepted application that is not on the bill still
 * has work outstanding; one that is has none, and offering ADD TO BILL there
 * would be offering to do something already done.
 *
 * ⛔ Colours come from STATUS_TAB_COLOR at the call site so the chip cannot
 * disagree with the tab above it. This function names the STATE, not the hue.
 */
export function applicationWorkState(bucket, onBill = false) {
  switch (bucket) {
    case 'new':         return { label: 'NEW APPLICATION', quiet: false };
    /* ⚠ "UNDECIDED", not "SEEN". `seen` is written by LOOKING — expanding a
       card sets it — so the word describes the host's eyes rather than the
       row's position. What the host needs to know is that it is still theirs
       to answer, which is also why PIPELINE holds new AND seen. */
    case 'seen':        return { label: 'UNDECIDED', quiet: false };
    case 'shortlisted': return { label: 'SHORTLISTED', quiet: false };
    case 'accepted':    return onBill
      ? { label: 'ACCEPTED · ON THE BILL', quiet: false }
      : { label: 'ACCEPTED · NOT ON BILL', quiet: false };
    case 'declined':    return { label: 'DECLINED', quiet: true };
    default:            return { label: String(bucket || '').toUpperCase(), quiet: true };
  }
}

/**
 * ⭐⭐ THE BILL AND THE SET TIME ARE TWO FACTS, SHOWN AS TWO LINES.
 *
 * Everyone on this tab is ON BILL — that is what being in `lineup_members`
 * means — so the bill line is constant and the SET TIME line is the one that
 * varies. Collapsing them into a single chip is what made the tab read as five
 * unrelated words (ON BILL / DRAFT / AWAITING / CONFIRMED / DECLINED) when it
 * is really one fact plus a progress state.
 *
 * ⚠ `DECLINED` HERE IS THE ARTIST DECLINING A SLOT — ⛔ not the host declining
 * an application. Two systems, one word; the copy says "ARTIST DECLINED" out
 * loud so the two can never be read as the same event.
 */
export function lineupWorkState(memberState) {
  switch (memberState) {
    /* ⭐ THE DOMINANT OPERATIONAL STATE (goal 9): 123 of 152 members are here.
       It is the only one flagged as needing action, which is what makes the
       tab scannable — the lit rows are the work. */
    case 'ON BILL':   return { setTime: 'NO SET TIME',       needsAction: true  };
    case 'DRAFT':     return { setTime: 'SET TIME NOT SENT', needsAction: false };
    case 'AWAITING':  return { setTime: 'AWAITING REPLY',    needsAction: false };
    case 'CONFIRMED': return { setTime: 'CONFIRMED',         needsAction: false };
    case 'DECLINED':  return { setTime: 'ARTIST DECLINED',   needsAction: false };
    default:          return { setTime: String(memberState || '—'), needsAction: false };
  }
}

/**
 * @param kind        'application' | 'lineup' — the visual separation (goal 5)
 * @param item        { name, type, avatar, avatar_thumb, location, state,
 *                      sound, genre_string, id, user_id }
 * @param stateLabel  the prominent state chip's words
 * @param stateColor  its colour, from the caller's own status map
 * @param quiet       settled states recede
 * @param subState    lineup only — the set-time line
 * @param needsAction lineup only — lights the set-time line
 * @param actions     the action area. ⚠ The caller composes it with
 *                    `DecisionBtn`/`DetailBtn` inside a `.yp-decision-row`, so
 *                    every surface in the app shares one control vocabulary.
 */
export default function WorkItemCard({
  kind = 'application', item, stateLabel, stateColor, quiet = false,
  subState = null, needsAction = false, actions = null,
}) {
  if (!item) return null;

  const pt   = profileIdentity(String(item.type || '').toLowerCase());
  const loc  = formatLocation(item);
  const img  = item.avatar_thumb || item.avatar || pt.defaultImage;
  /* Their own words first, the genre string as the fallback — the same
     resolution ProfileCard uses, kept identical so one act does not describe
     itself differently on two tabs. */
  const sound = item.sound || item.genre_string?.split(/[·,]/).slice(0, 3).map(g => g.trim()).join(' · ') || '';

  /* ROLE and PLACE on one line. `.filter(Boolean)` because a hand-typed act
     has no locality and an unknown type has no label — an empty separator
     floating after a name is the placeholder problem in miniature. */
  const metaLine = [pt.shortLabel, loc].filter(Boolean).join('  ·  ');

  return (
    <article
      className={`${s.card} ${kind === 'application' ? s.application : s.lineup}`}
      style={{ '--state': stateColor || 'var(--border)' }}
    >
      <div className={s.head}>
        {/* ⭐ The type ring and glow, exactly as ProfileCard draws them — the
            photography language kept, demoted from surface to thumbnail. */}
        {img && (
          <img className={s.avatar} src={img} alt=""
            style={{ borderColor: pt.muted, boxShadow: `0 0 6px rgba(${pt.mutedRgb},.15)` }} />
        )}

        <div className={s.who}>
          <div className={s.nameRow}>
            <h3 className={s.name}>{item.name || 'Unnamed act'}</h3>
            {/* Kept: it changes what a host can expect to happen when they
                act on this row. ⛔ The type pill did not, and is now text. */}
            <UnclaimedBadge profile={item} />
          </div>
          {metaLine && <div className={s.meta}>{metaLine}</div>}
          {sound && <div className={s.genres} style={{ color: pt.accent }}>{sound}</div>}
        </div>

        <div className={s.status}>
          <span className={`${s.state}${quiet ? ' ' + s.quiet : ''}`}>{stateLabel}</span>
          {subState && (
            <span className={`${s.subState}${needsAction ? ' ' + s.needsAction : ''}`}>{subState}</span>
          )}
        </div>
      </div>

      {actions && <div className={s.actions}>{actions}</div>}
    </article>
  );
}
