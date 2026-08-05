import { useState, useMemo, useRef, useEffect } from 'react';
import PortraitCard from './PortraitCard';
import ProfileCard from './ProfileCard';
import { useDragScroll } from '../hooks/useDragScroll';
import { useRailCardWidth, useIsDesktop, useIsPhone } from '../hooks/useRailCardWidth';
import { looksLikeNumber, toE164 } from '../lib/phoneNumber';
import { findByPhone } from '../lib/phoneKey';
import MessengerAvatar from './MessengerAvatar';

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

  // ⚠ ONE FIELD, TWO SEARCHES. Owner: "you should make it you search by name
  // or number". They are genuinely different operations — name filters the
  // contacts already on screen, number is an exact lookup against everyone on
  // YesPleez — so the query is routed rather than blended. See looksLikeNumber
  // for why the test is INTENT rather than validity.
  const isNumberQuery = looksLikeNumber(search);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    // A number query is not a name filter. Returning the unfiltered list here
    // would show every contact underneath the number result, which reads as
    // "these matched" when none of them did.
    if (looksLikeNumber(search)) return [];
    return contacts.filter(({ profile: p }) =>
      ['name', 'location', 'sound', 'type'].some((k) => p?.[k]?.toLowerCase?.().includes(q)));
  }, [contacts, search]);

  // The number lookup. Debounced, because this one goes to the server on every
  // keystroke otherwise — and a partial number matches nobody, so those calls
  // are pure waste.
  const [numberMatch, setNumberMatch] = useState(null);
  const [searchingNumber, setSearchingNumber] = useState(false);
  useEffect(() => {
    if (!isNumberQuery) { setNumberMatch(null); setSearchingNumber(false); return undefined; }
    // Only a COMPLETE number can match, so the request waits for one. The
    // routing above still happened on the first few digits, which is what
    // keeps the UI honest while the user is still typing.
    if (!toE164(search).e164) { setNumberMatch(null); setSearchingNumber(false); return undefined; }

    let cancelled = false;
    setSearchingNumber(true);
    const t = setTimeout(async () => {
      const { matches } = await findByPhone([search]);
      if (cancelled) return;
      setNumberMatch(matches?.[0] ?? null);
      setSearchingNumber(false);
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, isNumberQuery]);

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

  // ⚠ showType={false} ON BOTH RENDERERS, AND ONLY HERE. The type pill was
  // once removed from PortraitCard itself to satisfy "pills are taking up too
  // much of the card" — which was about THIS rail, and silently stripped them
  // from Following and every industry profile as well. Opting out at the call
  // site keeps the request local to the surface that made it.
  //
  // The View-all GRID keeps a fixed 150x200 card — `minmax(150px,1fr)` below
  // is sized for it, and the 7.3-visible rule is specifically about the
  // horizontal RAIL, not a wrapping grid.
  const card = ({ profile, conversationId }) => (
    <PortraitCard
      key={profile.id}
      profile={profile}
      width={150}
      height={200}
      showType={false}
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
      showType={false}
      onClick={() => onOpen?.(conversationId, profile)}
    />
  );

  return (
    <div style={{ marginBottom: 20 }}>
      {/* ⛔ NO HEADING, NO ▦/☰ TOGGLE, NO "VIEW ALL" (owner, 2026-08-05:
          "its not really needed lbh"). The rail is self-evidently your
          contacts, it already renders EVERY one of them drag-scrollably, and
          the list view was a second way to read the same list.

          ⚠ THIS MAKES `showAll` AND `view` PERMANENTLY FALSE/'portrait'. The
          branches keyed on them below — the expanded grid, the paginated list
          and the two search fields inside them — are now UNREACHABLE, not
          merely unused. They are being lifted to a single search at the top of
          Messages rather than deleted in place; until that lands this component
          carries dead weight, which is recorded here so it is a staged move
          and not an oversight. */}
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
            placeholder="Search by name or number…"
            inputMode="text"
            style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.06)',
              border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '10px 14px',
              color: '#fff', fontFamily: "'DM Sans',sans-serif", fontSize: 13, marginBottom: 10,
              outline: 'none' }}
          />
          {isNumberQuery && (
            <NumberResult
              searching={searchingNumber}
              match={numberMatch}
              complete={!!toE164(search).e164}
              onOpen={onOpen}
            />
          )}
          {filtered.length === 0
            ? (isNumberQuery ? null : <p style={{ fontSize: 13, color: 'var(--muted)' }}>No results.</p>)
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
            placeholder="Search by name or number…"
            inputMode="text"
            style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.06)',
              border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '10px 14px',
              color: '#fff', fontFamily: "'DM Sans',sans-serif", fontSize: 13, marginBottom: 10,
              outline: 'none' }}
          />
          {isNumberQuery && (
            <NumberResult
              searching={searchingNumber}
              match={numberMatch}
              complete={!!toE164(search).e164}
              onOpen={onOpen}
            />
          )}
          {filtered.length === 0 ? (
            isNumberQuery ? null : <p style={{ fontSize: 13, color: 'var(--muted)' }}>No results.</p>
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
        // ⚠ TWO ELEMENTS: A WRAPPER THAT DOES NOT SCROLL, AND A SCROLLER
        // INSIDE IT. The fade is positioned against the WRAPPER. Put it inside
        // the scrolling element instead — the obvious single-div version — and
        // `bottom: 0` resolves against the scrollable CONTENT rather than its
        // visible box, so the gradient slides up out of view the moment you
        // scroll and reappears only at the end. It has to stay welded to the
        // bottom edge of the window you are looking through.
        <div style={{ position: 'relative' }}>
          <div style={{
            maxHeight: COLLAPSED_MAX_HEIGHT,
            overflowY: 'auto',
            // Momentum scrolling on iOS; without it a short inner scroller
            // feels stuck compared to the page it sits on.
            WebkitOverflowScrolling: 'touch',
            // No scrollbar here or anywhere — index.css handles it globally.
            // The gradient below is what says "there is more".
          }}>
            <div style={{
              display: isDesktop ? 'grid' : 'flex',
              flexDirection: isDesktop ? undefined : 'column',
              gridTemplateColumns: isDesktop ? '1fr 1fr' : undefined,
              gap: 6,
              // Lets the LAST row scroll clear of the gradient. Without it the
              // final contact can never be seen unobscured — the fade is
              // pointer-transparent so it was always clickable, but it looked
              // permanently half-disabled.
              paddingBottom: FADE_HEIGHT,
            }}>
              {contacts.map(({ profile, conversationId }) => (
                <ProfileCard
                  key={profile.id}
                  item={profile}
                  onClick={() => onOpen?.(conversationId, profile)}
                />
              ))}
            </div>
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

/**
 * The number-search result — the other half of "search by name or number".
 *
 * ⚠ EVERY STATE IS NAMED, INCLUDING THE BORING ONES. A number search that
 * finds nobody must SAY nobody, because the alternative reads as a broken
 * feature: the contact list has already emptied itself (a number is not a name
 * filter), so silence here would leave the user staring at a blank screen with
 * no idea whether it was still working. "Keep typing", "looking", "nobody",
 * and "here they are" are four different things and each gets its own line.
 *
 * ⚠ NO NUMBER IS EVER SHOWN BACK. Not the query, not the match's. Phone
 * Discovery's model is that a number is a lookup key, never content — echoing
 * it into the results would put someone's number on screen next to their name,
 * which is exactly the pairing the whole design avoids creating.
 */
function NumberResult({ searching, match, complete, onOpen }) {
  if (!complete) {
    return <p style={{ fontSize: 13, color: 'var(--muted)' }}>Keep typing the number…</p>;
  }
  if (searching) {
    return <p style={{ fontSize: 13, color: 'var(--muted)' }}>Looking…</p>;
  }
  if (!match) {
    return (
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
        Nobody here with that number. Invite them from FIND FRIENDS.
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen?.(null, {
        id: match.profileId,
        name: match.displayName,
        type: 'punter',
        avatar: match.avatar ?? null,
      })}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, width: '100%',
        background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '10px 12px', marginBottom: 10,
        cursor: 'pointer', textAlign: 'left',
      }}
    >
      <MessengerAvatar src={match.avatar} size={40} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {match.displayName}
        </span>
        {/* The corroboration line, same as the sync results: a name the user
            themselves saved is what makes a squatted number catchable. */}
        <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>
          {match.savedAs ? `saved as ${match.savedAs}` : 'found by number'}
        </span>
      </span>
      <span style={{ color: 'var(--muted)', fontSize: 16 }} aria-hidden="true">›</span>
    </button>
  );
}
