// § 10 · Presented By
//
// Spec: docs/event-page-layout-spec.md § 10
//
// The page's primary trust signal, particularly for imported or unclaimed
// events where the reader is deciding whether the event is real at all — which
// is why it carries slightly more weight here than in the reference concept,
// where it read as a footer element.
//
// Degradation: owner profile → the venue as presenting entity → hide. A missing
// logo is a monogram, never a placeholder person; a missing bio drops its line
// and keeps the card.

import PortraitCard from '../../components/PortraitCard';
import s from './EventSections.module.css';

export default function EventPresentedBy({
  presenter = null,
  venue = null,
  onViewProfile = null,
  unclaimedNotice = null,
}) {
  // The owner presents where one is known; otherwise the linked venue does.
  // Venue linkage is far more complete than owner linkage in this data, so the
  // fallback does real work rather than being theoretical.
  const p = presenter?.name ? { ...presenter, type: presenter.type || 'host' }
    : venue?.name ? { name: venue.name, type: 'venue', bio: venue.bio, profile: venue.profile }
    : null;

  if (!p) return null;   // R1 · absent

  return (
    <section className={s.card}>
      <div className={s.headRow}><h2 className={s.heading}>PRESENTED BY</h2></div>

      {/* PORTRAIT, not the horizontal card — the same component the Lineup
          uses, so the people behind the event are presented the way the people
          playing it are.
          ⚠ The TYPE is `host`: the default image file is named
          `defaultpromoter`, which is a known mismatch in profileTypes, and the
          type string is what PortraitCard resolves on. A venue presenting
          instead keeps its own `venue` identity rather than being dressed as a
          promoter. */}
      <div className={s.presenterPortrait}>
        <PortraitCard
          profile={{ type: p.type || 'host', name: p.name, ...(p.profile || {}) }}
          width={124}
          height="auto"
          onClick={onViewProfile || undefined}
        />
        {/* Bio sits BESIDE the portrait, not under it — a 124px card in a
            257px column would otherwise leave half the width empty. */}
        {p.bio && <div className={s.sub}>{p.bio}</div>}
      </div>

      {/* Action-time disclosure for an unclaimed presenter, supplied by the
          caller so this component never has to know about claim state. */}
      {unclaimedNotice}

      {/* ⛔ No "VIEW PROFILE" row — the card opens the profile itself. */}
    </section>
  );
}
