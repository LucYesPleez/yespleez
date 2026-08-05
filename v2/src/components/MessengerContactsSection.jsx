import { useMemo } from 'react';
import PortraitCard from './PortraitCard';
import { useDragScroll } from '../hooks/useDragScroll';
import { useRailCardWidth, useIsDesktop } from '../hooks/useRailCardWidth';

/**
 * YOUR CONTACTS — the people you actually talk to, inside Messenger.
 *
 * One horizontal rail of every contact, and nothing else. No heading, no
 * ▦/☰ toggle, no View all, no search of its own (owner, 2026-08-05: "its not
 * really needed lbh").
 *
 * ⛔ WHAT WAS DELETED HERE, SO IT IS NOT REBUILT BY ACCIDENT:
 *
 *   the expanded GRID       a second way to read the same list
 *   the LIST view (☰)       ditto, plus a whole collapsed/faded variant
 *   batch pagination        IntersectionObserver, batch sizes, a sentinel row
 *   two search fields       identical copies, one per branch — and BOTH were
 *                           unreachable on a phone, where an effect forced the
 *                           list closed the moment phone+portrait was true
 *
 * The search did not die: it moved to MessengerSearch, at the top of Messages,
 * always visible, doing the same name-or-number routing for the whole screen
 * instead of for this one list. A search nobody can find is not a search.
 *
 * ⚠ THE RAIL ALREADY SHOWS EVERYONE. `contacts.map` renders every contact and
 * the rail scrolls, which is why "View all" could go without anything becoming
 * unreachable. Do not add a cap here and then reintroduce a control to defeat
 * it.
 *
 * ⚠⚠ COMPLETELY SEPARATE FROM FOLLOWS. Owner, 2026-07-26: *"friends in this
 * list is separate from artists they follow… purely contacts inside messenger
 * only"*. FollowingSection looks similar on purpose but answers a different
 * question, and the two must never be merged or fed from each other. Following
 * is taste; this is communication.
 *
 * ⚠ DERIVED, NOT STORED. There is no contacts table and there should not be
 * one: the list is whoever you have conversations with, which the app already
 * knows. A stored list would immediately disagree with the inbox.
 *
 * ⚠ ROWS COME FROM InboxScreen, ALREADY RESOLVED. Working out which
 * participant is "the other one" is genuinely subtle — a conversation can be
 * between two profiles the same human owns — and that logic already exists
 * there. Re-deriving it here is how the two would drift apart.
 *
 * ⚠ TAPPING OPENS THE CONVERSATION, NOT THE PROFILE. PortraitCard navigates
 * to /profile/:id by default; here that would be wrong. This list exists for
 * talking to people, so a tap continues the conversation.
 */
export default function MessengerContactsSection({ rows = [], onOpen, loading = false }) {
  const drag = useDragScroll();
  const railCardWidth = useRailCardWidth();
  const isDesktop = useIsDesktop();

  /**
   * One entry per person, most recently contacted first.
   *
   * `rows` arrives ordered by last_message_at, so first-seen IS most-recent
   * and the dedupe preserves it for free.
   *
   * ⚠ RECENCY ONLY, NOT FREQUENCY — and that is a known gap, not an oversight.
   * "Most often contacted" needs per-conversation message counts, which the
   * client does not have; counting conversations instead would be meaningless
   * because a pair almost always has exactly one. Doing it properly means an
   * RPC that aggregates messages. Until then this is honestly recency-ordered
   * rather than a blend that pretends to weigh something it cannot see.
   */
  const contacts = useMemo(() => {
    const seen = new Map();
    for (const c of rows) {
      const p = c?.others?.[0]?.profiles;
      if (!p?.id || seen.has(p.id)) continue;
      seen.set(p.id, { profile: p, conversationId: c.id });
    }
    return [...seen.values()];
  }, [rows]);

  if (!loading && contacts.length === 0) return null;

  /**
   * ⚠ `showType={false}` HERE, NOT IN PortraitCard. The type pill was once
   * removed from the card itself to satisfy "pills are taking up too much of
   * the card" — which was about THIS rail, and silently stripped them from
   * Following and every industry profile as well. Opting out at the call site
   * keeps the request local to the surface that made it.
   *
   * ⚠ The rail takes the FLUID width so 7.3 cards fit regardless of viewport,
   * and on phone drops to avatar-only — owner: "just show avatars". Once the
   * name and pill were both gone there was no reason to hold the desktop count.
   */
  const railCard = ({ profile, conversationId }) => (
    <PortraitCard
      key={profile.id}
      profile={profile}
      width={railCardWidth}
      height="auto"
      avatarOnly={!isDesktop}
      showType={false}
      onClick={() => onOpen?.(conversationId, profile)}
    />
  );

  return (
    <div style={{ marginBottom: 20 }}>
      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</p>
      ) : (
        <div
          ref={drag.ref}
          onMouseDown={drag.onMouseDown}
          onMouseMove={drag.onMouseMove}
          onMouseUp={drag.onMouseUp}
          onMouseLeave={drag.onMouseLeave}
          style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8,
            WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', cursor: 'grab',
            userSelect: 'none' }}
        >
          {contacts.map(railCard)}
        </div>
      )}
    </div>
  );
}
