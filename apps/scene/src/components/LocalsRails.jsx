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
import { postcodeCoords } from '../lib/geo';
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
  const radiusKm = profilePostcode ? 50 : null;
  const artistsDrag   = useDragScroll('locals-artists');
  const venuesDrag    = useDragScroll('locals-venues');
  const promotersDrag = useDragScroll('locals-promoters');
  const drags = { artists: artistsDrag, venues: venuesDrag, promoters: promotersDrag };

  /* ⚠ The pool is acts attached to any UPCOMING event — the component's own
     list above, ⛔ never the host screen's filtered one. */
  const localActs = useLocalActs(events);
  const groups = useMemo(() => LOCAL_GROUPS.map(g => ({
    ...g,
    locals: buildLocals({
      profiles: localActs.filter(pr => g.types.includes(String(pr.type || '').toLowerCase())),
      originCoords,
      radiusKm,
      isoDate: todayIso,
      withinRadius,
    }),
  })), [localActs, originCoords, radiusKm, todayIso]);

  if (!groups.some(g => g.locals.items.length > 0)) return null;

  return (
    <div className={s.sectionBlock}>
      <div className={s.sectionRow}>
        <span data-tour="locals-section" className={s.sectionTitle}>LOCALS</span>
        <div className={s.gradientLine} />
      </div>
      {groups.map(g => g.locals.items.length > 0 && (
        <div key={g.key} style={{ marginTop: 14 }}>
          <div className={s.sectionRow} style={{ marginBottom: 6 }}>
            <span className={s.sectionSub}>{g.title}</span>
            <div className={s.gradientLine} />
          </div>
          {/* ⚠ THE REACH IS DECLARED, PER RAIL. When there are not enough near
              you the rail borrows from further afield rather than running
              nearly empty — owner, 2026-08-03: "it has to say that". Without
              this the section showed a profile in Cairns under a heading that
              says LOCALS. Each rail reaches on its own, so the line is per
              rail too. */}
          {g.locals.expanded && (
            <p className={s.reach}>
              {g.locals.localCount === 0
                ? 'None nearby yet, so these are from further afield.'
                : `Only ${g.locals.localCount} nearby, so the rest are from further afield.`}
            </p>
          )}
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
