// § 7 · Venue
//
// Spec: docs/event-page-layout-spec.md § 7
//
// Map size follows map PRECISION. A region-level pin in a large frame reads as
// an error rather than an intention, so the map only appears when there is
// something real to draw — and when a location is withheld, the notice leads
// and the map yields entirely, even if coordinates exist in the record.

import ProfileCard from '../../components/ProfileCard';
import { resolveVenue, directionsQuery } from './venueDisplay';
import { RouteIcon, ChevronIcon } from './eventIcons';
import s from './EventSections.module.css';

export default function EventVenue({
  name, address, locality, state, mapUrl, withheld = false,
  profile = null,          // the venue's own profiles row, when it has one
  onOpenVenue = null,
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

  return (
    <section className={s.card}>
      <div className={s.headRow}><h2 className={s.heading}>VENUE</h2></div>

      {/* The app's own venue card, so a venue reads the same here as it does
          in Discover, My Scene or a search result — right accent, right type
          badge, right default image, and it navigates to the venue's profile
          without this screen knowing the URL. */}
      {v.name && (
        <ProfileCard
          item={{ type: 'venue', name: v.name, location: locality, state, ...(profile || {}) }}
          onClick={onOpenVenue || undefined}
        />
      )}

      {v.address && <div className={s.sub}>{v.address}</div>}

      {v.mode === 'map' && (
        <img className={s.map} src={v.mapUrl} alt={`Map showing ${v.name || v.area}`} loading="lazy" />
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
