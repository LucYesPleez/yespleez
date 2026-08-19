// § 6b · Lineup, compact — A BILL OF ONE OR TWO, BESIDE THE EVENT INFO
//
// ⭐⭐ WHY THIS EXISTS (owner, 2026-08-20). Below 1024px the layout's one
// two-column band stacks, so the Lineup drops underneath the whole event
// summary. With a full bill that is right. With ONE act it made a single
// portrait card the largest object on the page — a section heading, a count
// and a rail's worth of space spent on one name.
//
// ⛔ IT IS NOT A SMALLER VERSION OF THE RAIL. Cards say "here is a list, scan
// it"; at one or two acts there is no list to scan, so this says the thing
// directly instead: who is playing, as one more fact about the event, sitting
// with the date and the venue where a reader is already looking.
//
// ⭐ THE CUT-OFF IS TWO, and it is a judgement about READING, not a magic
// number: three or more names want the eye to compare them, which is what the
// cards are for. Two rows still read as facts. Change [[EventLineup]]'s rail
// and this together or the page will say different things at different counts.
//
// ⚠ NARROW WIDTHS ONLY — hidden at 1024px and up by the stylesheet, because
// from there the real Lineup column is already exactly what the owner asked
// for: the bill sitting to the right of the title and info, height-matched to
// it. ⛔ Do NOT gate this in JavaScript. A measured breakpoint drifts from the
// CSS one, and this component's sibling had a `useIsPhone()` gate removed for
// that reason once already.
//
// ⛔ ABSENT AND WITHHELD ARE NOT THIS COMPONENT'S JOB. A bill nobody has
// announced is a statement (TO BE ANNOUNCED) and belongs to EventLineup, which
// owns the rendering contract for it. This renders only when there are one or
// two REAL acts to name. See [[project_rendering_contract]].

import s from './EventLineupCompact.module.css';

/** The count at or below which the bill is stated rather than laid out. */
export const COMPACT_MAX = 2;

/** ⭐ ONE ANSWER, asked by both this component and the page that hides the
    full Lineup beside it. Two independent `length <= 2` checks would be two
    rules, and the day they disagree the page renders the bill twice. */
export function isCompactLineup(artists = [], withheld = false) {
  return !withheld && artists.length > 0 && artists.length <= COMPACT_MAX;
}

function ChevronIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export default function EventLineupCompact({ artists = [], withheld = false, onOpenArtist = null }) {
  if (!isCompactLineup(artists, withheld)) return null;

  return (
    <section className={s.compact} aria-label="Lineup">
      {/* ⚠ ONE LABEL ABOVE THE GROUP, ⛔ not one inside each row. At two acts a
          repeated "PLAYING" reads as two separate announcements rather than
          one bill, and the word is doing the same job both times. */}
      <div className={s.label}>PLAYING</div>

      <div className={s.rows}>
        {artists.map(a => {
          /* ⛔ NOT CLICKABLE WITHOUT A DESTINATION. A hand-typed act carries no
             profile to open, and a row that highlights and does nothing is the
             dead affordance R3 forbids. It still RENDERS — the act is playing
             either way, and that is the fact this section states. */
          const openable = !!(onOpenArtist && a.id);
          const Row = openable ? 'button' : 'div';
          return (
            <Row
              key={a.id ?? a.name}
              type={openable ? 'button' : undefined}
              className={s.row + (openable ? ' ' + s.rowOpenable : '')}
              onClick={openable ? () => onOpenArtist(a) : undefined}
            >
              {/* ⚠ The initial, ⛔ never an empty frame. An imported act with no
                  photo is the common case, not the edge one — a blank square
                  reads as a failed image where a letter reads as a person. */}
              {a.avatar
                ? <img className={s.avatar} src={a.avatar} alt="" loading="lazy" />
                : <span className={s.avatar + ' ' + s.avatarFallback} aria-hidden="true">
                    {String(a.name || '?').trim().charAt(0).toUpperCase()}
                  </span>}

              <span className={s.text}>
                <span className={s.name}>{a.name}</span>
                {a.location && <span className={s.place}>{a.location}</span>}
              </span>

              {openable && <span className={s.chev}><ChevronIcon /></span>}
            </Row>
          );
        })}
      </div>
    </section>
  );
}
