// § 7 · Venue
//
// Spec: docs/event-page-layout-spec.md § 7
//
// Map size follows map PRECISION. A region-level pin in a large frame reads as
// an error rather than an intention, so the map only appears when there is
// something real to draw — and when a location is withheld, the notice leads
// and the map yields entirely, even if coordinates exist in the record.

import { resolveVenue, directionsQuery } from './venueDisplay';
import { RouteIcon, ChevronIcon } from './eventIcons';
import s from './EventSections.module.css';

export default function EventVenue({
  name, address, locality, state, mapUrl, withheld = false,
  // ⛔ No `profile` / `onOpenVenue` here any more — the venue's card moved to
  // EventVenueCard and took the profile row and the click target with it.
  // Callers still spread both in harmlessly; this section simply ignores them.
}) {
  const v = resolveVenue({ name, address, locality, state, mapUrl, withheld });
  if (!v) return null;   // R1 · absent

  if (v.mode === 'withheld') {
    return (
      <section className={s.card}>
        <div className={s.headRow}>
          <h2 className={s.heading}>VENUE</h2>
          <span className={s.stateChip}>SECRET LOCATION</span>
        </div>
        {v.area && <div className={s.sub}><span className={s.strong}>{v.area}</span></div>}
        <div className={s.withheldBox}>
          <div className={s.withheldTitle}>LOCATION REVEALED CLOSER TO THE DATE</div>
        </div>
      </section>
    );
  }

  const query = directionsQuery(v);

  // ⚠ The address is TWO LINES, not one comma-joined string (owner,
  // 2026-08-01): street, then locality and state beneath it — the way an
  // address is written on an envelope. Each line renders only if the record
  // holds it, so a venue with no locality shows its street alone rather than
  // an empty second line.

  return (
    <section className={s.card}>
      {/* The venue's NAME sits beside the label (owner, 2026-08-01). The card
          that used to name this section moved out to its own block, which left
          the map window headed by a bare "VENUE" and no indication of which
          venue — the address alone does not name a place. */}
      <div className={s.headRow}><h2 className={s.heading}>VENUE</h2></div>

      {/* The name sits UNDER the label (owner, 2026-08-01), on its own line —
          not beside it. A name long enough to wrap beside the label used to
          push the whole head row onto two lines; on its own line it simply
          takes the width it needs. */}
      {v.name && <div className={s.venueTitle}>{v.name}</div>}

      {/* ⛔ The venue's own card is NOT here any more (owner, 2026-08-01). It
          renders as its own block — EventVenueCard, the `venueCard` slot — so
          it can sit below this section on desktop and beside the host's card
          on a phone. This section keeps the address, the map and the way out.
          Putting a second venue card back here would rebuild the duplicate
          click target the spec deleted. */}
      {/* ONE block, not two siblings. As separate children of the card they
          were separated by its 12px flex row gap ON TOP of a 1.5 line-height,
          which read as two unrelated lines rather than one address. Inside a
          single block the gap applies once, around the address as a whole. */}
      {(v.address || v.area) && (
        <div className={`${s.sub} ${s.venueAddress}`}>
          {v.address && <div>{v.address}</div>}
          {v.area && <div>{v.area}</div>}
        </div>
      )}

      {/* Rules top and bottom (owner, 2026-08-01) — they separate the address
          from the map and the map from the way out, so the three parts read as
          three steps rather than one stack. Rendered WITH the map: a pair of
          lines around nothing is a visual hole (R5). */}
      {v.mode === 'map' && (
        <>
          <div className={s.rule} />
          <img className={s.map} src={v.mapUrl} alt={`Map showing ${v.name || v.area}`} loading="lazy" />
          <div className={s.rule} />
        </>
      )}

      {/* No query, no button. A directions link that opens a map of the wrong
          town is worse than no link at all. */}
      {query && (
        <a className={s.linkRow}
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`}
          target="_blank" rel="noopener noreferrer">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <RouteIcon size={15} /> GET DIRECTIONS
          </span>
          <ChevronIcon />
        </a>
      )}

      {/* ⛔ No "VIEW VENUE" row. The card above IS the way in — a second
          control doing the same thing is the duplicate-click-target problem
          that got the arrow deleted from FeaturedEventCard. */}
    </section>
  );
}
