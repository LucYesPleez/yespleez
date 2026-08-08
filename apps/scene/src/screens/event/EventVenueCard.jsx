// § 7a · Venue identity card
//
// Spec: docs/event-page-layout-spec.md § 7
//
// The venue's own card, lifted OUT of the Venue section (owner, 2026-08-01) so
// it stands as its own block rather than sitting above the address and map.
//
// ⚠ PORTRAIT, not the horizontal ProfileCard it used to be. On a phone this
// card sits BESIDE the host's card, and the pair is only legible if both are
// the same shape — two 124px portraits fit a 375px screen where two horizontal
// cards do not. That makes the format a layout requirement, not a preference.
//
// The venue still reads as a venue: PortraitCard resolves its accent, type
// badge and default image from `type: 'venue'`, exactly as Discover does.

import PortraitCard from '../../components/PortraitCard';
import { resolveVenue } from './venueDisplay';
import s from './EventSections.module.css';

export default function EventVenueCard({
  name, address, locality, state, mapUrl, withheld = false,
  profile = null,
  onOpenVenue = null,
  // ⚠ `bare` drops this component's OWN card chrome — padding, border,
  // background (owner, 2026-08-02). Since § 7 took the card inside itself, the
  // default wrapper drew a second bordered box inside the venue section's box,
  // and a box inside a box reads as two things when it is one.
  //
  // Not removed outright: the dev layout harness still renders this standalone
  // in the `venueCard` slot, where the chrome is the only thing giving it edges.
  bare = false,
}) {
  const v = resolveVenue({ name, address, locality, state, mapUrl, withheld });

  // R1 · absent. A withheld location still has no venue to name, so the card
  // yields entirely and the Venue section carries the notice on its own.
  if (!v || v.mode === 'withheld' || !v.name) return null;

  const identity = (
    <div className={s.venueIdentity}>
      <PortraitCard
        profile={{ type: 'venue', name: v.name, location: locality, state, ...(profile || {}) }}
        width="var(--yp-ep-card-w, 124px)"
        height="auto"
        onClick={onOpenVenue || undefined}
      />
    </div>
  );

  return bare ? identity : <section className={s.card}>{identity}</section>;
}
