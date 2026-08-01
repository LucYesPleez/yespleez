// § 6 · Lineup
//
// Spec: docs/event-page-layout-spec.md § 6
//
// ── A spec conflict, resolved here ───────────────────────────────────
// § 6 says the Lineup "may take the full content width", while the Explicitly
// Optimal list says "Venue paired beside Lineup on desktop". Both cannot hold:
// a full-width Lineup breaks Band B into two stacked rows and orphans the
// Venue below it.
//
// Resolved in favour of the pairing. "Who is playing" and "where is it" are
// scanned together, and that adjacency was called optimal deliberately. The
// width the full-bleed option was chasing is bought instead with card sizing:
// at 112px cards in a 657px primary column the rail shows five and a half
// artists, against the reference concept's four. The bill gets its extra
// visibility without costing the Venue its place.
//
// ── Emphasis ─────────────────────────────────────────────────────────
// This is second only to identity in deciding attendance, so it carries more
// weight than Event Details below it — and carries nothing decorative. The
// reference concept put a star badge on every artist with no defined meaning;
// badges that mean nothing are noise in the one section that must be scannable
// at a glance.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useDragScroll } from '../../hooks/useDragScroll';
import PortraitCard from '../../components/PortraitCard';
import { resolveLineup, sortLineup, BILL, AZ } from './lineupDisplay';
import s from './EventLineup.module.css';

function SortIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h11M4 12h8M4 17h5" /><path d="M18 9l3-3 3 3" transform="translate(-3 3)" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// PORTRAIT cards, and the app's own PortraitCard rather than a bespoke one —
// it already renders event lineups elsewhere, so the bill looks like the rest
// of YesPleez instead of like a component invented for this page.
//
// ── Sizing by COUNT, not by pixels ───────────────────────────────────
// `calc((100% - gaps) / N)` holds the same number of visible cards at ANY
// container width — the idiom useRailCardWidth already established for the
// app's other rails. The ".3" is deliberate: a part-card peeks past the edge,
// which is what tells the reader the rail scrolls.
//
// This governs the MOBILE rail only. On desktop the section becomes a grid and
// the stylesheet overrides the width, so changing this number does not touch
// the two-column layout.
//
// 3.3 (owner, 2026-08-01): three cards and part of a fourth. The history is
// 5.5 → 4.3 → 3.3, each step trading reach for legibility — 5.5 gave 57px
// cards and 4.3 gave 72px, both small for a face. 3.3 lands near 95px on a
// 375px phone, the first size at which an avatar reads as a person.
const VISIBLE_CARDS = 3.3;
const GAP_PX = 10;   // must match the rail's own `gap` in the stylesheet
const CARD_WIDTH = `calc((100% - ${(VISIBLE_CARDS - 1) * GAP_PX}px) / ${VISIBLE_CARDS})`;

function ArtistCard({ artist, onOpen, avatarOnly }) {
  return (
    <PortraitCard
      profile={{ type: 'artist', ...artist }}
      width={CARD_WIDTH}
      height="auto"            /* 3:4 derived from the width — see PortraitCard */
      showType={false}         /* every card here is on the bill; the label adds nothing */
      avatarOnly={avatarOnly}  /* a name is unreadable at phone width — the app
                                  drops the text rather than growing the card */
      onClick={onOpen ? () => onOpen(artist) : undefined}
    />
  );
}

export default function EventLineup({
  artists = [],
  withheld = false,
  onOpenArtist = null,
  onViewAll = null,
}) {
  const [order, setOrder] = useState(BILL);
  const [overflowing, setOverflowing] = useState(false);
  const [moreBelow, setMoreBelow] = useState(false);
  const railRef = useRef(null);
  const wrapRef = useRef(null);
  const drag = useDragScroll('event-lineup');
  // ⛔ NOT avatar-only any more (owner, 2026-08-01). Names and towns show at
  // every width. The old `useIsPhone()` gate was decided when phone cards were
  // 57–72px, where a name genuinely was unreadable; at VISIBLE_CARDS = 3.3 the
  // card is ~97px and carries both lines. A bill that will not tell you who is
  // playing is not a bill.
  const avatarOnly = false;

  const resolved = resolveLineup({ artists, withheld });

  // Overflow is a measurement, not a count. Whether the bill fits depends on
  // the column, which depends on the viewport — so the arrow, the fade and the
  // full-lineup entry are all driven by what actually happened in the layout.
  //
  // ⚠ BOTH AXES. As a rail it overflows horizontally; as the desktop grid it
  // overflows DOWNWARD inside a clipped wrapper. Checking only the rail's width
  // meant "view full lineup" silently vanished in grid mode with 26 of 30
  // artists hidden behind the clip.
  const measure = useCallback(() => {
    const rail = railRef.current;
    if (!rail) { setOverflowing(false); setMoreBelow(false); return; }
    const wide = rail.scrollWidth - rail.clientWidth > 4;
    const tall = rail.scrollHeight - rail.clientHeight > 4;
    setOverflowing(wide || tall);
    // Whether the fade should show: there is more below AND we are not already
    // at the end of it. A fade pinned at the bottom of a fully-scrolled list
    // would be dimming the last artists for nothing.
    setMoreBelow(tall && rail.scrollTop + rail.clientHeight < rail.scrollHeight - 4);
  }, []);

  useEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    [railRef.current, wrapRef.current].filter(Boolean).forEach(el => ro.observe(el));
    return () => ro.disconnect();
  }, [measure, resolved?.mode, resolved?.artists?.length]);

  // R1 · absent — the section does not render, and Band B gives its width back.
  if (!resolved) return null;

  // R1 · withheld — announced, never hidden.
  if (resolved.mode === 'withheld') {
    return (
      <section className={s.lineup}>
        <div className={s.head}><h2 className={s.heading}>LINEUP</h2></div>
        <div className={s.withheld}>
          <div className={s.withheldTitle}>TO BE ANNOUNCED</div>
          <div className={s.withheldNote}>The organiser hasn’t revealed the bill yet.</div>
        </div>
      </section>
    );
  }

  const { artists: list, mode, sortable } = resolved;
  const shown = sortLineup(list, order);

  // A single card is a single card. No rail, no arrow, no sort, no "view all" —
  // every one of those would be a control acting on nothing.
  if (mode === 'single') {
    return (
      <section className={s.lineup}>
        <div className={s.head}><h2 className={s.heading}>LINEUP</h2></div>
        <div className={s.rail}><ArtistCard artist={shown[0]} onOpen={onOpenArtist} avatarOnly={avatarOnly} /></div>
      </section>
    );
  }

  function page(dir) {
    const el = railRef.current;
    if (el) el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: 'smooth' });
  }

  return (
    <section className={s.lineup}>
      <div className={s.head}>
        <h2 className={s.heading}>LINEUP</h2>
        <span className={s.count}>{list.length}</span>
        {sortable && (
          <button
            className={s.sort + (order === AZ ? ' ' + s.sortOn : '')}
            onClick={() => setOrder(o => (o === AZ ? BILL : AZ))}
            aria-pressed={order === AZ}
          >
            <SortIcon />
            {order === AZ ? 'A–Z' : 'BILL'}
          </button>
        )}
      </div>

      <div className={s.railWrap + (moreBelow ? " " + s.moreBelow : "")} ref={wrapRef}>
        <div
          className={s.rail}
          ref={el => { railRef.current = el; drag.ref.current = el; }}
          onMouseDown={drag.onMouseDown}
          onMouseUp={drag.onMouseUp}
          onMouseMove={drag.onMouseMove}
          onMouseLeave={drag.onMouseLeave}
          onScroll={measure}
        >
          {shown.map(a => <ArtistCard key={a.id ?? a.name} artist={a} onOpen={onOpenArtist} avatarOnly={avatarOnly} />)}
        </div>

        {overflowing && <>
          <div className={s.fade} />
          <button className={s.arrow} onClick={() => page(1)} aria-label="Scroll lineup">
            <ChevronIcon />
          </button>
        </>}
      </div>

      {overflowing && onViewAll && (
        <button className={s.viewAll} onClick={onViewAll}>
          VIEW FULL LINEUP
          <ChevronIcon />
        </button>
      )}
    </section>
  );
}
