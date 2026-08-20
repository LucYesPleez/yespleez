// § 6b · Lineup, compact — A BILL OF ONE OR TWO, BESIDE THE EVENT INFO
//
// ⭐⭐ WHY THIS EXISTS (owner, 2026-08-20). Below 1024px the layout's one
// two-column band stacks, so the Lineup dropped underneath the whole event
// summary. With a full bill that is right. With one or two acts it was
// grotesque: EventLineup's `railCardWidth` divides the row between however few
// cards there are, so ONE act became a full-width portrait — the largest
// object on the page — and two became a pair of half-page posters.
//
// ⭐⭐ THE CARDS ARE NOT THE PROBLEM; THEIR SIZE AND THEIR PLACE WERE. The bill
// moves up beside the date and the venue, and each card is fixed at half the
// row whether there are one or two of them. ⛔ A single act does NOT grow to
// fill the row — that is the exact thing this replaces.
//
// ⭐ THE APP'S OWN PortraitCard, ⛔ not a card invented here. It already draws
// lineups everywhere else, so a short bill looks like the rest of YesPleez.
//
// ⭐ THE CUT-OFF IS TWO, and it is a judgement about READING, not a magic
// number: three or more names want the eye to compare them, which is what the
// rail below is for, with its overflow peek and its arrow. This has no
// overflow story at all — every act renders — so it must never take a count
// that could need one. ⛔ Change this and EventLineup's rail together.
//
// ⚠ NARROW WIDTHS ONLY — hidden at 1024px and up by the stylesheet, because
// from there the real Lineup column is already exactly what the owner asked
// for: the bill to the right of the title and info, height-matched to it, two
// cards across. ⛔ Do NOT gate this in JavaScript. A measured breakpoint drifts
// from the CSS one, and this component's sibling had a `useIsPhone()` gate
// removed for that reason once already.
//
// ⛔ ABSENT AND WITHHELD ARE NOT THIS COMPONENT'S JOB. A bill nobody has
// announced is a statement (TO BE ANNOUNCED) and belongs to EventLineup, which
// owns the rendering contract for it. This renders only when there are one or
// two REAL acts to name. See [[project_rendering_contract]].

import PortraitCard from '../../components/PortraitCard';
import s from './EventLineupCompact.module.css';

/** The count at or below which the bill sits with the event info. */
export const COMPACT_MAX = 2;

/** ⭐ ONE ANSWER, asked by both this component and the page that hides the
    full Lineup beside it. Two independent `length <= 2` checks would be two
    rules, and the day they disagree the page renders the bill twice. */
export function isCompactLineup(artists = [], withheld = false) {
  return !withheld && artists.length > 0 && artists.length <= COMPACT_MAX;
}

/* ⛔⛔ HALF THE ROW, ALWAYS — ⛔ never divided by the number of acts.
   `EventLineup`'s rail sizes cards by count, which is right for a row meant to
   scroll and is what made a bill of one fill the page. Here the width is a
   constant: one act draws one half-width card with the row empty beside it,
   and that empty half is the point. Two draw the same card twice. */
const GAP_PX = 10;
const CARD_WIDTH = `calc((100% - ${GAP_PX}px) / 2)`;

/**
 * ⭐ `beside` — ONE act sits in a column NEXT TO the title and info rather than
 * under it (owner, 2026-08-20). Stacked, the identity read as two disconnected
 * chunks: title, date, venue, then a gap, then a card.
 *
 * ⛔ ONLY EVER FOR ONE ACT. Two cards in a column that narrow are a pair of
 * stamps; two acts keep the full-width row beneath the info, where they have
 * room to be read. The caller decides, and `EventPage` is the only caller.
 *
 * ⚠ In this mode the card fills its column (100%), ⛔ not the half-row width —
 * the column IS the half-row, so halving it again would make the act tiny.
 */
export default function EventLineupCompact({ artists = [], withheld = false, onOpenArtist = null, beside = false }) {
  if (!isCompactLineup(artists, withheld)) return null;
  const soloBeside = beside && artists.length === 1;

  return (
    <section className={`${s.compact} ${soloBeside ? s.besideCol : ''}`} aria-label="Lineup">
      <div className={s.label}>PLAYING</div>
      <div className={s.cards}>
        {artists.map(a => (
          <PortraitCard
            key={a.id ?? a.name}
            profile={{ type: 'artist', ...a }}
            width={soloBeside ? '100%' : CARD_WIDTH}
            height="auto"        /* 3:4 derived from the width — see PortraitCard */
            showType={false}     /* every card here is on the bill; the label adds nothing */
            /* ⛔ NOT CLICKABLE WITHOUT A DESTINATION. A hand-typed act carries
               no profile to open, and a card that highlights and does nothing
               is the dead affordance R3 forbids. It still RENDERS — the act is
               playing either way, and that is the fact this section states. */
            onClick={onOpenArtist && a.id ? () => onOpenArtist(a) : undefined}
          />
        ))}
      </div>
    </section>
  );
}
