// § 10 · Presented By
//
// Spec: docs/event-page-layout-spec.md § 10
//
// The page's primary trust signal, particularly for imported or unclaimed
// events where the reader is deciding whether the event is real at all — which
// is why it carries slightly more weight here than in the reference concept,
// where it read as a footer element.
//
// Degradation: owner profile → hide. A missing logo is a monogram, never a
// placeholder person; a missing bio drops its line and keeps the card.
//
// ⚠ THE VENUE FALLBACK WAS REMOVED (owner, Neverland '26, 2026-08-02).
// This section used to present the VENUE when no owner profile was linked,
// which was right when it was the only portrait card on the page. § 9's venue
// card is now its own block, so on any event with `owner_profile_id = NULL` —
// still the common case — the fallback rendered the SAME venue portrait twice,
// side by side, one of them labelled as the presenter.
//
// One entity, one card. An event with no known organiser now says nothing here
// rather than crediting the venue for someone else's night, which is also the
// more honest answer: the venue hosting a room is not the same claim as the
// promoter presenting the night.

import ProfileCard from '../../components/ProfileCard';
import s from './EventSections.module.css';

export default function EventPresentedBy({
  presenter = null,
  coHosts = [],
  onViewProfile = null,
  onViewCoHost = null,
  unclaimedNotice = null,
}) {
  // A real presenter, or nothing. See the header on why the venue no longer
  // stands in — it duplicated § 9's card.
  const p = presenter?.name ? { ...presenter, type: presenter.type || 'host' } : null;

  /**
   * ⭐ CO-HOSTS AT EQUAL SIZE (owner, 2026-08-04). Same card, same width, same
   * bio window — a night presented by two promoters looks like a night
   * presented by two promoters. Only the MAIN host can edit, and that
   * difference is enforced in `event_hosts`'s policies rather than expressed
   * by making anyone's card smaller.
   *
   * Deduping already happened in the view model, so this list is safe to render
   * as-is; guarding again here would just be a second place to keep in sync.
   */
  const billed = (coHosts || []).filter(c => c?.name);

  // R1 · absent. ⚠ A co-host with no main host still bills: the owner may be
  // unknown (17 events carry no owner at all) while the co-host is a fact
  // somebody recorded. Returning null on `!p` alone would silently drop them.
  if (!p && !billed.length) return null;

  return (
    <section className={s.card}>
      {/* ⚠ The heading is HIDDEN on desktop (owner, 2026-08-01) — the card
          carries its own HOST/VENUE badge there, so the label was saying twice
          what the badge already says. It stays on a phone, where the card sits
          in a narrow column and the section needs naming. Hidden, not removed:
          it remains in the DOM as the section's accessible name. */}
      <div className={`${s.headRow} ${s.presenterHead}`}>
        <h2 className={s.heading}>PRESENTED BY</h2>
      </div>

      {/* ⚠ LANDSCAPE, not the portrait (owner, 2026-08-03) — ProfileCard, the
          same row card the dashboards and Messenger contact list use. Presented
          By no longer shares a row with the venue card (that pairing ended
          2026-08-02, see the header note), so there is no longer a fixed
          124px column forcing a vertical shape; a full-width row reads as more
          substantial for the page's primary trust signal.
          ⚠ The TYPE is `host`: the default image file is named
          `defaultpromoter`, a known mismatch in profileTypes, and the type
          string is what ProfileCard resolves on. A venue presenting instead
          keeps its own `venue` identity rather than being dressed as a
          promoter. */}
      {/* ⚠ THE BIO IS NOW INSIDE THE CARD (owner, 2026-08-04), not a sibling
          paragraph under it. ProfileCard renders `item.bio` as a window in
          `cover` mode — see the note there. `p.bio` is spread in as part of
          `p.profile`, and is passed explicitly as well because the view model
          reads it through its own `bio` field: an owner row missing the
          spread would otherwise silently lose its bio with nothing to show
          for it.
          Why it moved: a card plus a loose paragraph is two things where the
          reader sees one presenter, and it is what made a second host look
          expensive. One self-contained block repeats cleanly; a block and a
          trailing paragraph do not. */}
      {p && (
        <ProfileCard
          item={{ type: p.type || 'host', name: p.name, ...(p.profile || {}), bio: p.bio || p.profile?.bio || null }}
          onClick={onViewProfile || undefined}
          cover
        />
      )}

      {/* Stacked, not a row: each card is full width and carries its own bio
          window, so side-by-side would halve both and cost the bio the space
          that made it worth moving inside the card. The section's own 12px
          flex gap separates them. */}
      {billed.map(c => (
        <ProfileCard
          key={c.profile?.id || c.name}
          item={{ type: c.type || 'host', name: c.name, ...(c.profile || {}), bio: c.bio || c.profile?.bio || null }}
          onClick={onViewCoHost ? () => onViewCoHost(c) : undefined}
          cover
        />
      ))}

      {/* Action-time disclosure for an unclaimed presenter, supplied by the
          caller so this component never has to know about claim state. */}
      {unclaimedNotice}

      {/* ⛔ No "VIEW PROFILE" row — the card opens the profile itself. */}
    </section>
  );
}
