import { useState, useMemo, useRef, useEffect } from 'react';
import PortraitCard from './PortraitCard';
import ProfileCard from './ProfileCard';
import { useDragScroll } from '../hooks/useDragScroll';
import { useRailCardWidth, useIsDesktop, useIsPhone } from '../hooks/useRailCardWidth';

/**
 * The collapsed LIST view shows a peek, not the whole thing.
 *
 * Row height is an ESTIMATE, not a measurement — ProfileCard's real height
 * varies with content (location/sound text can push it past the avatar's
 * 52px), and this component cannot know that in advance. 80px is the avatar
 * (52) plus its own top+bottom padding (14 each, from ProfileCard.module.css
 * `.content`). That is fine here specifically because a FADE, not a hard
 * edge, is doing the truncating — the exact pixel a row gets cut at is not
 * meant to be precise, only "about three and a bit".
 */
const ROW_HEIGHT_ESTIMATE = 80;
const ROW_GAP = 6;
const COLLAPSED_ROWS = 3.3;
const COLLAPSED_MAX_HEIGHT =
  Math.round(COLLAPSED_ROWS * ROW_HEIGHT_ESTIMATE + (COLLAPSED_ROWS - 1) * ROW_GAP);
const FADE_HEIGHT = 56;

/**
 * "View all" pagination for the LIST view. Owner: 6 rows at a time on
 * phone, 10 on desktop — desktop is 2 columns, so a "row" there is 2 items.
 */
const PHONE_BATCH_ROWS = 6;
const DESKTOP_BATCH_ROWS = 10;
const DESKTOP_COLUMNS = 2;

/**
 * YOUR CONTACTS — the people you actually talk to, inside Messenger.
 *
 * ⚠⚠ COMPLETELY SEPARATE FROM FOLLOWS. Owner, 2026-07-26: *"friends in this
 * list is separate from artists they follow… purely contacts inside messenger
 * only"*. FollowingSection looks almost identical on purpose — same toggle,
 * same drag-scroll, same View all — but it answers a different question, and
 * the two must never be merged or fed from each other. Following is taste;
 * this is communication.
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
  const [view, setView] = useState('portrait');
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const drag = useDragScroll();
  const railCardWidth = useRailCardWidth();
  // List view (☰), desktop only: two columns side by side. Owner: "cut the
  // cards in half and have 2 rows beside each other", then "only on desktop"
  // — a phone stays single-column, where a row is already tight for one.
  const isDesktop = useIsDesktop();
  const isPhone = useIsPhone();

  // How many LIST-view items are rendered while expanded. Starts at one
  // batch, grows as the sentinel below scrolls into view.
  const [visibleCount, setVisibleCount] = useState(
    isDesktop ? DESKTOP_BATCH_ROWS * DESKTOP_COLUMNS : PHONE_BATCH_ROWS,
  );
  const sentinelRef = useRef(null);

  // ⚠ PHONE + PORTRAIT NEVER EXPANDS. Owner, explicitly, after everything
  // else in this message: "phone portrait mode doesnt expand". The rail is
  // already the browsing surface there (see avatarOnly above) — a searchable
  // grid of avatar-only tiles underneath it would be a second, worse version
  // of the same list. Forced here rather than only hiding the control, so a
  // resize from desktop→phone while already expanded cannot leave the rail
  // stuck in a state its own UI no longer offers a way back out of.
  useEffect(() => {
    if (isPhone && view === 'portrait') setShowAll(false);
  }, [isPhone, view]);

  // A fresh batch size whenever the breakpoint crosses, or a new expansion
  // starts — otherwise resizing mid-scroll leaves stale phone/desktop maths
  // in a state that no longer matches the layout actually on screen.
  useEffect(() => {
    setVisibleCount(isDesktop ? DESKTOP_BATCH_ROWS * DESKTOP_COLUMNS : PHONE_BATCH_ROWS);
  }, [isDesktop, showAll]);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(({ profile: p }) =>
      ['name', 'location', 'sound', 'type'].some((k) => p?.[k]?.toLowerCase?.().includes(q)));
  }, [contacts, search]);

  // "as it scrolls" — loads the next batch when a sentinel row placed after
  // the current batch enters the viewport, rather than a fixed page/button.
  // Only active for the LIST view's own pagination; the portrait grid keeps
  // its existing render-everything behaviour (unchanged by this request).
  const hasMore = visibleCount < filtered.length;
  useEffect(() => {
    if (!showAll || view !== 'landscape' || !hasMore) return undefined;
    const el = sentinelRef.current;
    if (!el) return undefined;
    const batch = isDesktop ? DESKTOP_BATCH_ROWS * DESKTOP_COLUMNS : PHONE_BATCH_ROWS;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisibleCount((c) => c + batch);
      },
      { rootMargin: '400px' }, // starts loading before the sentinel is actually on screen
    );
    io.observe(el);
    return () => io.disconnect();
  }, [showAll, view, hasMore, isDesktop, filtered.length]);

  if (!loading && contacts.length === 0) return null;

  // The View-all GRID keeps a fixed 150x200 card — `minmax(150px,1fr)` below
  // is sized for it, and the 7.3-visible rule is specifically about the
  // horizontal RAIL, not a wrapping grid.
  const card = ({ profile, conversationId }) => (
    <PortraitCard
      key={profile.id}
      profile={profile}
      width={150}
      height={200}
      onClick={() => onOpen?.(conversationId, profile)}
    />
  );

  // The rail gets the fluid width so 7.3 fit regardless of viewport, and on
  // phone drops to avatar-only — owner: "just show avatars", once the name
  // and pill were both gone there was no reason to hold the desktop count
  // down any more (see the note in useRailCardWidth).
  const railCard = ({ profile, conversationId }) => (
    <PortraitCard
      key={profile.id}
      profile={profile}
      width={railCardWidth}
      height="auto"
      avatarOnly={!isDesktop}
      onClick={() => onOpen?.(conversationId, profile)}
    />
  );

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: 2,
          color: 'var(--muted)' }}>
          YOUR CONTACTS
        </div>
        <div style={{ flex: 1 }} />

        {/* Same control as FollowingSection, deliberately: two lists that look
            and behave alike are easier than two that each invented their own. */}
        {!showAll && (
          <div style={{ display: 'flex', background: 'var(--card2)', borderRadius: 8,
            overflow: 'hidden', border: '1px solid var(--border)' }}>
            {[['portrait', '▦'], ['landscape', '☰']].map(([v, icon]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-label={v === 'portrait' ? 'Card view' : 'List view'}
                style={{
                  background: view === v ? 'rgba(0,229,255,.18)' : 'none', border: 'none',
                  color: view === v ? 'var(--neon2)' : 'var(--muted)', padding: '5px 10px',
                  cursor: 'pointer', fontSize: 13, lineHeight: 1,
                  transition: 'background .15s, color .15s',
                }}
              >{icon}</button>
            ))}
          </div>
        )}

        {/* ⚠ HIDDEN, NOT JUST INERT, for phone+portrait — a control that
            visibly does nothing when pressed is worse than no control. */}
        {(showAll || contacts.length > 3) && !(isPhone && view === 'portrait') && (
          <span
            onClick={() => { setShowAll((v) => !v); setSearch(''); }}
            style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: 1,
              color: showAll ? 'var(--text)' : 'var(--muted)', cursor: 'pointer', flexShrink: 0 }}
          >{showAll ? 'View less' : 'View all >'}</span>
        )}
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</p>

      ) : showAll && view === 'portrait' ? (
        // Unchanged: the portrait grid's existing search-everything behaviour.
        // Never reached on phone — the effect above forces showAll back to
        // false the moment phone+portrait becomes true.
        <div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your contacts…"
            style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.06)',
              border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '10px 14px',
              color: '#fff', fontFamily: "'DM Sans',sans-serif", fontSize: 13, marginBottom: 10,
              outline: 'none' }}
          />
          {filtered.length === 0
            ? <p style={{ fontSize: 13, color: 'var(--muted)' }}>No results.</p>
            : <div style={{ display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
                {filtered.map(card)}
              </div>}
        </div>

      ) : showAll ? (
        // LIST view, expanded: paginated, loading the next batch as the
        // sentinel below scrolls into view — never the whole list at once.
        <div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your contacts…"
            style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.06)',
              border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '10px 14px',
              color: '#fff', fontFamily: "'DM Sans',sans-serif", fontSize: 13, marginBottom: 10,
              outline: 'none' }}
          />
          {filtered.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>No results.</p>
          ) : (
            <>
              <div style={{
                display: isDesktop ? 'grid' : 'flex',
                flexDirection: isDesktop ? undefined : 'column',
                gridTemplateColumns: isDesktop ? '1fr 1fr' : undefined,
                gap: 6,
              }}>
                {filtered.slice(0, visibleCount).map(({ profile, conversationId }) => (
                  <ProfileCard
                    key={profile.id}
                    item={profile}
                    onClick={() => onOpen?.(conversationId, profile)}
                  />
                ))}
              </div>
              {/* Not rendered once everything is showing — an
                  IntersectionObserver with nothing to observe is a leak
                  waiting for a reason, not a feature staying ready. */}
              {hasMore && <div ref={sentinelRef} style={{ height: 1 }} aria-hidden="true" />}
            </>
          )}
        </div>

      ) : view === 'portrait' ? (
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

      ) : (
        // LIST view, collapsed: a peek at ~3.3 rows, faded rather than cut
        // hard, so the eye reads "more below" instead of "that's everything".
        // Owner: "use gradient to fade the bottom to show theres more."
        <div style={{ position: 'relative', maxHeight: COLLAPSED_MAX_HEIGHT, overflow: 'hidden' }}>
          <div style={{
            display: isDesktop ? 'grid' : 'flex',
            flexDirection: isDesktop ? undefined : 'column',
            gridTemplateColumns: isDesktop ? '1fr 1fr' : undefined,
            gap: 6,
          }}>
            {contacts.map(({ profile, conversationId }) => (
              <ProfileCard
                key={profile.id}
                item={profile}
                onClick={() => onOpen?.(conversationId, profile)}
              />
            ))}
          </div>
          {contacts.length > COLLAPSED_ROWS * (isDesktop ? DESKTOP_COLUMNS : 1) && (
            <div
              aria-hidden="true"
              style={{
                position: 'absolute', left: 0, right: 0, bottom: 0, height: FADE_HEIGHT,
                // ⚠ --dark, NOT --bg. --bg is used elsewhere in this codebase
                // (InboxScreen) but is never actually DEFINED as a custom
                // property anywhere — it silently resolves to nothing, which
                // would have made this fade transparent-to-transparent and
                // invisible. --dark (#0a0a0f) is the token `body` itself is
                // painted with, so this genuinely matches the page behind it.
                background: 'linear-gradient(to bottom, rgba(10,10,15,0) 0%, var(--dark) 85%)',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
