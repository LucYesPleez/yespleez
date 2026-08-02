// The Event Page layout shell. Structure only — it places sections and knows
// nothing about their contents.
//
// Spec: docs/event-page-layout-spec.md
//
// ── The one idea this file exists to express ─────────────────────────
// There is ONE canonical section order. The desktop two-column layout is a
// PROJECTION of it, never a separate arrangement. That is only enforceable if
// the DOM is always in canonical order, so the shell is built from three
// BANDS, and each band's DOM runs [primary column][secondary column]:
//
//   ┌──────────────── 1 Hero Cover · FULL WIDTH ────────────────┐
//   │ 2 Identity  3 Decision       │ 6 Venue                    │
//   │ 4 Description  5 Quick Acts  │ 7 Presented By             │
//   ├───────────────── 8 Lineup · FULL WIDTH ───────────────────┤
//   ├───────────── 9 Event Details · FULL WIDTH ────────────────┤
//   ├─────────────── 10 Gallery · FULL WIDTH ───────────────────┤
//   ├──────────── 11 Related Events · FULL WIDTH ───────────────┤
//   └───────── 12 Information Sources · FULL WIDTH ─────────────┘
//
// ONE two-column band, everything else full width — the owner's layout,
// 2026-08-01. Left is the event itself, right is where it is and who is behind
// it; past that the page runs edge to edge of its column.
//
// The Lineup went full width in the same change, which is what lets a portrait
// rail show a real bill instead of three and a half faces in a 42% column.
//
// ⚠ Mobile consequence: Venue and Presented By now stack ABOVE the Lineup,
// because the right column follows the left one when the band collapses. The
// bill is a stronger decision driver than either, so this is worth a look on a
// phone before it is called finished.
//
// Read that top-to-bottom, left-to-right within each band, and you get
// 1..11 — the canonical order, exactly. So mobile needs no reordering at all:
// the bands stack, the columns inside them stack, and the result is canonical.
//
// The bands are also the three SPACING GROUPS from the spec. The grouping
// rhythm and the desktop grid turned out to be the same structure, which is
// why the gap between bands is larger than the gap within them.
//
// It also gives the two alignment points for free — Identity tops out level
// with Hero, Venue level with Lineup — because they are the first row of
// their band. Nothing has to be measured or matched.

import { Fragment } from 'react';
import s from './EventPageLayout.module.css';

// R5 · never leave visual holes. A band whose columns are given as [key, node]
// pairs can see which of them actually rendered, so:
//   · both columns present → the two-column projection
//   · one column empty     → the surviving column takes the full width
//   · both empty           → the band does not render, and its group gap
//                            goes with it
// Without this, a hidden Hero would leave the summary at 42% beside 58% of
// nothing — the exact hole R5 exists to forbid.
function Band({ primary = [], secondary = [], matched = false, className = '' }) {
  const render = pairs => pairs
    .filter(([, node]) => node)
    .map(([key, node]) => <Fragment key={key}>{node}</Fragment>);

  const p = render(primary);
  const q = render(secondary);

  if (!p.length && !q.length) return null;

  const single = !p.length || !q.length;

  return (
    <div className={s.band + (single ? ' ' + s.bandSingle : '') + (matched ? ' ' + s.bandMatched : '') + (className ? ' ' + className : '')}>
      {!!p.length && <div className={s.primary}>{p}</div>}
      {!!q.length && <div className={s.secondary}>{q}</div>}
    </div>
  );
}

export default function EventPageLayout({
  // Full width — the banner
  hero,
  // The two-column band. Left: the event. Right: where and who.
  identity,
  decision,
  description,
  quickActions,
  venue,
  venueCard,
  presentedBy,
  // Full width, in order, below the band
  lineup,
  setTimes,
  eventDetails,
  gallery,
  relatedEvents,
  informationSources,
  // Fixed, outside the flow. Mobile only — on desktop the Decision block goes
  // sticky within its own column instead, so this does not render at all.
  stickyBar,
}) {
  return (
    <div className={s.page + (stickyBar ? ' ' + s.hasStickyBar : '')}>
      {/* The Hero runs the FULL content width and owns no column — it is the
          page's banner, not a cell. */}
      {hero && <div className={`${s.fullBand} ${s.oHero}`}>{hero}</div>}

      {/* The ONLY two-column band. Left is the event itself; right is where it
          is and who is behind it. Everything after this runs full width. */}
      {/* The ONLY two-column band: the event itself beside the bill.
          Height-matched on desktop — see .bandMatched in the stylesheet — so
          the Lineup fills exactly the space the event info occupies and sizes
          its cards to it. */}
      <Band
        matched
        className={s.oBand}
        primary={[
          ['identity', identity],
          ['decision', decision],
          ['description', description],
          ['quickActions', quickActions],
        ]}
        secondary={[['lineup', lineup]]}
      />

      {/* SET TIMES — full width, directly under the Lineup band.
          Its own section rather than a row inside the Lineup, because it has
          real withheld semantics of its own (`showTimesPublicly`): an
          organiser can have a full bill announced and the running order still
          under wraps. Two live events publish set times; before this slot
          existed the new page would have silently dropped them. */}
      {setTimes && <div className={`${s.fullBand} ${s.oSetTimes}`}>{setTimes}</div>}

      {/* Second two-column band on desktop: Event Details left, Venue and
          Presented By stacked right.

          On phone this band DISSOLVES (display: contents, in the stylesheet)
          so its three sections become siblings of everything else and keep
          their own phone order — Venue, Details, Presented By. That order was
          settled separately and must not change just because desktop grouped
          them into columns, which is why each one carries its own `o*` class
          rather than inheriting a position from the column it sits in. */}
      {/* ── The venue card and the host card ───────────────────────────
          HALF THE WIDTH EACH, at both breakpoints (owner, 2026-08-01). Two
          equal tracks, so neither the venue nor the presenter is framed as the
          more important of the two. */}
      <div className={s.venueBand}>
        {venueCard   && <div className={s.oVenueCard}>{venueCard}</div>}
        {presentedBy && <div className={s.oPresented}>{presentedBy}</div>}
      </div>

      {/* The map runs FULL WIDTH and sits ABOVE Event Details (owner,
          2026-08-01) — a wide map is the point of a map, and the reader places
          the event before reading its particulars. */}
      {venue && <div className={`${s.fullBand} ${s.oVenue}`}>{venue}</div>}

      {/* Event Details runs full width and splits its own rows into two
          columns internally (see EventDetails.module rules). */}
      {eventDetails && <div className={`${s.fullBand} ${s.oDetails}`}>{eventDetails}</div>}

      {gallery            && <div className={`${s.fullBand} ${s.oGallery}`}>{gallery}</div>}
      {relatedEvents      && <div className={`${s.fullBand} ${s.oRelated}`}>{relatedEvents}</div>}
      {informationSources && <div className={`${s.fullBand} ${s.oSources}`}>{informationSources}</div>}

      {stickyBar && <div className={s.stickyBar}>{stickyBar}</div>}
    </div>
  );
}

// Step 1 scaffolding. Each section replaces its Slot as it is built; when the
// last one goes, this and the .slot* rules in the stylesheet go with it.
export function Slot({ order, name, note, minHeight }) {
  return (
    <div className={s.slot} style={minHeight ? { minHeight } : undefined}>
      <span className={s.slotOrder}>{order}</span>
      <span className={s.slotName}>{name}</span>
      {note && <span className={s.slotNote}>{note}</span>}
    </div>
  );
}
