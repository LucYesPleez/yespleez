// LOCALS — the people and places with something coming up.
//
// ⭐ THIRD HOME, ONE COMPONENT. My Scene → What's On → Discover (owner,
// 2026-08-21: "remove the locals section from What's On and put it on the
// Discover page under the recently added events"). The section has now moved
// twice, which is exactly why it is a component: the next move is an import,
// ⛔ not another copy-paste of three rails and their reach lines.
//
// ⭐ Its noun is a PERSON, but the question is "who is playing around here" —
// and ⛔ it is NOT a directory: an act with nothing booked does not appear
// (useLocalActs enforces it). Discover's search remains the directory.
//
// ⛔ NO SUBHEADING under the title. "With something on" describes the FILTER,
// and the filter is our business, not the reader's — owner, 2026-08-21:
// "that's just for me and the algorithm".
//
// THREE RAILS, because "who is playing", "which rooms have something on" and
// "who is putting nights on" are three questions. Each hides independently
// when empty; the whole section renders nothing when all three are.

import { useMemo } from 'react';
import { useEvents } from '../lib/useEvents';
import { useProfileLocation } from '../lib/useProfileLocation';
import { useSession } from '../App';
import { postcodeCoords, profileCoords } from '../lib/geo';
import { useLocalActs } from '../lib/useLocalActs';
import { buildLocals } from '../lib/locals';
import { withinRadius } from '../lib/geo';
import { today } from '../lib/dates';
import { useDragScroll } from '../hooks/useDragScroll';
import PortraitCard from './PortraitCard';
import FollowHeartBtn from './FollowHeartBtn';
import s from './LocalsRails.module.css';

/**
 * ⭐ Split by what someone actually IS. One mixed rail made you scan past four
 * DJs to find whether any VENUE has anything on. Labels follow
 * lib/profileTypes.js: 'host' is captioned HOST / PROMOTER there, so PROMOTERS
 * is the app's own word; the three performing types collapse into ARTISTS
 * because the DJ/band/comic distinction is already on each card.
 */
const LOCAL_GROUPS = [
  { key: 'artists',   title: 'ARTISTS',   types: ['artist', 'band', 'standup'] },
  { key: 'venues',    title: 'VENUES',    types: ['venue'] },
  { key: 'promoters', title: 'PROMOTERS', types: ['host'] },
];

/**
 * ⭐⭐ SELF-SUFFICIENT, and that is the fix (owner, 2026-08-21: 'I want the
 * locals section from where it was and how it was to show exactly the same
 * in Discover'). The first mount on Discover fed it DISCOVER's data — the
 * recently-added event list and the search filters' radius — so different
 * people appeared and the section was not the one the owner ratified.
 *
 * It now carries What's On's own recipe with it: ⭐ ALL upcoming events
 * (useEvents from today), ⭐ origin seeded from the PROFILE's postcode,
 * ⭐ 50km default radius — the ladder in lib/locals.js does the rest. Mount
 * it anywhere and it is the same section. ⛔ Do not reintroduce props for the
 * pool or the radius; a host screen's filters are that screen's business.
 */
export default function LocalsRails() {
  const todayIso = today();
  const { session } = useSession() || {};
  const { events } = useEvents(todayIso, null);
  const profilePostcode = useProfileLocation(session?.user?.id);
  const originCoords = useMemo(() => postcodeCoords(profilePostcode), [profilePostcode]);
  /* ⭐ FIXED 50km, ⛔ NO CONTROLS (owner, 2026-08-21: the radius select and
     SHOW ALL were added on request and removed on sight the same day —
     "show all can also go, and the radius". The section curates; it does not
     ask the reader to operate it). The strict-locals rule keeps its teeth:
     the radius still applies, there is just nothing to fiddle. */
  const radiusKm = profilePostcode ? 50 : null;
  const artistsDrag   = useDragScroll('locals-artists');
  const venuesDrag    = useDragScroll('locals-venues');
  const promotersDrag = useDragScroll('locals-promoters');
  const drags = { artists: artistsDrag, venues: venuesDrag, promoters: promotersDrag };

  /* ⚠ The pool is acts attached to any UPCOMING event — the component's own
     list above, ⛔ never the host screen's filtered one. */
  const localActs = useLocalActs(events);
  const groups = useMemo(() => LOCAL_GROUPS.map(g => {
    const locals = buildLocals({
      profiles: localActs.filter(pr => g.types.includes(String(pr.type || '').toLowerCase())),
      originCoords,
      radiusKm,
      isoDate: todayIso,
      withinRadius,
    });
    /**
     * ⭐⭐ STRICT LOCALS ON THIS SURFACE (owner, 2026-08-21: "so only locals
     * are actually showing up there — I can currently see Sydney"). The
     * ladder's borrowed rung is DROPPED rather than disclosed: `farIds` marks
     * exactly the cards borrowed from beyond the radius, so they are filtered
     * out and the reach line never renders. ⚠ This supersedes the 2026-08-03
     * "it may reach further but it must say so" ruling FOR THIS SECTION ONLY —
     * the ladder itself is unchanged for any surface that still wants reach.
     *
     * ⭐⭐ AND THE UNPLACEABLE GO TOO (owner, 2026-08-21, second ruling: "if it
     * doesn't say they're from Bellingen they shouldn't be there"). A profile
     * with no location cannot prove it is local, and on a section titled
     * LOCALS the owner wants proof — Cash Savage wore no town for exactly
     * this reason. ⚠ Supersedes unknown ≠ far ON THIS SURFACE ONLY, and only
     * while an origin exists: signed out there is no radius and no locality
     * claim, so the whole-state view stays as What's On always showed it.
     *
     * ⭐ IMAGES LEAD (owner, same message: "profiles with images being used
     * mostly"): a stable partition, not a re-sort — cards with a photo keep
     * their ladder-and-rotation order at the front, the photoless keep theirs
     * behind. Determinism survives: same day, same faces, same order.
     */
    const strict = locals.items.filter(p => {
      if (locals.farIds.has(p.id ?? p.user_id)) return false;
      if (originCoords && radiusKm) {
        const c = profileCoords(p);
        if (!c || !withinRadius(originCoords, c, radiusKm)) return false;
        /* ⚠⚠ THE CARD MUST SAY THE TOWN, coords are not enough. Cash Savage —
           a Melbourne band — carried postcode 2454 because the importer
           stamps acts with the GIG's postcode, so they passed the geo test
           while wearing no town at all. The owner's rule is about what the
           reader can SEE ("if it doesn't say they're from Bellingen…"), so a
           profile with no displayed location does not belong here, however
           local its data claims to be. */
        if (!String(p.location || p.suburb || '').trim()) return false;
      }
      return true;
    });
    const withImg = strict.filter(p => p.avatar_thumb || p.avatar);
    const without = strict.filter(p => !(p.avatar_thumb || p.avatar));
    return { ...g, locals: { ...locals, items: [...withImg, ...without], expanded: false } };
  }), [localActs, originCoords, radiusKm, todayIso]);

  if (!groups.some(g => g.locals.items.length > 0)) return null;

  return (
    <div className={s.sectionBlock}>
      {/* ⛔ NO LINE beside LOCALS, ⛔ NO RADIUS SELECT, ⛔ NO SHOW ALL (owner,
          2026-08-21). All three were added on request and removed the same
          evening — the radius and the toggle lasted one look. The title
          stands alone: this section CURATES, it does not ask the reader to
          operate it. The sub-heading rows keep their lines. */}
      <div className={s.headerRow}>
        <span data-tour="locals-section" className={s.sectionTitle}>LOCALS</span>
      </div>
      {groups.map(g => g.locals.items.length > 0 && (
        <div key={g.key} style={{ marginTop: 14 }}>
          <div className={s.sectionRow} style={{ marginBottom: 6 }}>
            <span className={s.sectionSub}>{g.title}</span>
            <div className={s.gradientLine} />
          </div>
          {/* ⛔ The reach line is GONE with the borrowed rung it described —
              strict locals never show a card from beyond the radius, so there
              is nothing to disclose. See the strict-locals note above. */}
          <div className={s.rail} ref={drags[g.key].ref}
            onMouseDown={drags[g.key].onMouseDown} onMouseMove={drags[g.key].onMouseMove}
            onMouseUp={drags[g.key].onMouseUp} onMouseLeave={drags[g.key].onMouseLeave}>
            {g.locals.items.map(pr => (
              <PortraitCard key={pr.id ?? pr.user_id} profile={pr}
                followAction={<FollowHeartBtn profile={pr} />} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
