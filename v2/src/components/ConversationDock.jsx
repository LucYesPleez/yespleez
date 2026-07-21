import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useConversationUi } from '../lib/conversationUi';
import { useSession } from '../App';
import { supabase } from '../lib/supabase';
import { unreadCount } from '../lib/messaging';
import ConversationView from './ConversationView';

/**
 * THE CONVERSATION DOCK — drawer + minimised tabs. Mounted ONCE by the app
 * shell, above the router.
 *
 * Because it lives above the router it survives navigation: opening a
 * conversation while editing an event, then moving to Discover, keeps the
 * conversation alive and its draft intact. A screen-owned drawer could not do
 * this — it would unmount, and "minimise" would silently mean "discard".
 *
 * ── THE DRAWER IS AN OVERLAY, NOT A PAGE TRANSITION ──────────────────
 *
 * It slides up over the current screen and the screen underneath is preserved,
 * not replaced. Closing minimises to a tab docked on the bottom nav.
 * `--yp-nav-height` is maintained by BottomNav's ResizeObserver, so the tab
 * sits correctly above it including the safe-area inset.
 */
/**
 * How many minimised conversations show as tabs before the rest collapse into
 * a "+n". Three 210px-capped tabs plus the count fit inside the nav's 680px
 * without any of them shrinking below a readable name — the failure mode this
 * avoids is tabs that all fit but none of which can be identified.
 */
const MAX_VISIBLE_TABS = 3;

/**
 * The 20px avatar shared by a docked tab and its overflow row.
 *
 * One definition so the two can never diverge — the fan is literally the same
 * conversation shown somewhere else, and a tab that looks different once it
 * overflows would read as a different thing.
 *
 * Falls back to the initial on a gradient when a profile has no image, which
 * is also what an unclaimed profile looks like.
 */
function TabAvatar({ name, src }) {
  return (
    <span style={{ width: 20, height: 20, borderRadius: 999, overflow: 'hidden', flexShrink: 0, background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0a0a0f', fontFamily: "'Bebas Neue',sans-serif", fontSize: 10 }}>
      {src
        ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : (name ?? '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

export default function ConversationDock() {
  const { openId, minimised, open, minimise, dismiss, getState, patch } = useConversationUi();
  const { session } = useSession();
  const location = useLocation();
  // Purely presentational — which conversations are minimised lives in shell
  // state; this is only whether the fan is showing.
  const [overflowOpen, setOverflowOpen] = useState(false);

  // "Opening another screen" MINIMISES — it does not close, and it does not
  // leave the drawer covering the screen the user just navigated to. The dock
  // outlives the route change; only its presentation collapses.
  useEffect(() => {
    if (openId) minimise(openId);
    // Intentionally keyed on the path alone: this must fire on navigation, not
    // when a conversation opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  /**
   * FREEZE THE PAGE UNDERNEATH WHILE A CONVERSATION IS OPEN.
   *
   * The drawer is `position: fixed`, so it does not scroll itself — but the
   * document behind it still did. On a phone that showed as the app sliding
   * around behind the thread, which is the thing that made a conversation read
   * as a window floating over the app rather than as somewhere you had gone.
   *
   * Covering the screen was not enough on its own: a scroll that begins inside
   * the thread and reaches either end chains outward to the document unless
   * something stops it. The message list sets `overscroll-behavior: contain`,
   * and this closes the same hole from the other side.
   *
   * Restores the PREVIOUS value rather than clearing it, so this cannot quietly
   * take ownership of a property another overlay was already managing.
   */
  useEffect(() => {
    if (!openId) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [openId]);

  /**
   * A minimised tab must be able to become UNREAD.
   *
   * Shell state's `unread` was only ever driven DOWN — open() zeroes it and
   * ConversationView zeroes it after marking read — so nothing raised it and a
   * docked tab could never light up. The inbox row and the nav badge each
   * refresh from their own subscription; the tab had none, which is why it sat
   * grey while the card beside it glowed.
   *
   * Only conversations that are MINIMISED and NOT open count: a conversation
   * you are looking at is read by definition, and ConversationView is already
   * advancing its watermark.
   *
   * §5.6 — the count is re-read from the database rather than incremented
   * locally, so the tab, the card and the nav badge all answer to the same
   * counting rule instead of three approximations.
   */
  useEffect(() => {
    if (!session) return undefined;

    const channel = supabase
      .channel('dock-unread')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
      }, async ({ new: row }) => {
        const cid = row.conversation_id;
        if (row.from_user_id === session.user.id) return;   // your own message
        if (cid === openId) return;                          // you are reading it
        if (!minimised.includes(cid)) return;                // not a docked tab

        const { count } = await unreadCount(cid);
        patch(cid, { unread: count }, true);                 // notify — repaints tabs
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session, openId, minimised, patch]);

  /* ── THE DISMISS GESTURE DOES NOT LIVE HERE ANY MORE ─────────────────
   *
   * It used to: `onTouchStart`/`onTouchEnd` on the dialog below, minimising
   * whenever the touch ended more than 56px lower than it began.
   *
   * ⚠ THAT WAS A REAL BUG, reproduced on iPhone and Android — conversations
   * dismissed themselves during ordinary reading.
   *
   * The dialog is an ANCESTOR of the message list, which is the element that
   * actually scrolls. Touch events bubble, so every drag inside the list
   * arrived here too, and a downward drag of more than 56px is not an unusual
   * gesture — it is precisely what scrolling back through a conversation looks
   * like. The old comment argued that downward-only made it safe from scrolling;
   * downward-only is exactly what put it in the scroller's path.
   *
   * No threshold fixes this. Two handlers were competing for one drag and the
   * ancestor had no way to know the descendant had consumed it — so the gesture
   * was first moved to a non-scrolling grab handle in the header, and then
   * REMOVED ENTIRELY (owner, 2026-07-22): the back button and the desktop
   * scrim already close the drawer, so the handle was a second control for a
   * solved problem. There is now no dismiss drag anywhere in the drawer.
   *
   * Do not reintroduce a drag listener on this element or on the scrim.
   */

  return (
    <>
      {/* ── Minimised tabs, docked on the bottom nav ── */}
      {minimised.length > 0 && (
        /* Docked FLUSH to the nav, not floating above it. The 8px gap and
           centred column made these read as cards hovering over the page;
           sitting on the nav's top edge makes them read as tabs belonging to
           it. Laid out as a ROW from the left so a second and third
           conversation extend sideways like browser tabs — the language
           already scales without a redesign. */
        /* Width and centring MIRROR BottomNav's own `min(100%, 680px)`. The
           tabs belong to the nav, so they must share its bounds — anchored to
           the viewport instead, they drift to the far left on any screen wider
           than the nav, which is exactly what happened on desktop. */
        <div style={{ position: 'fixed', left: 0, right: 0, margin: '0 auto', width: 'min(100%, 680px)', bottom: 'var(--yp-nav-height, 64px)', zIndex: 140, display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-start', gap: 6, padding: '0 10px', boxSizing: 'border-box', pointerEvents: 'none' }}>
          {minimised.slice(0, MAX_VISIBLE_TABS).map(id => (
            <ConversationTab
              key={id}
              conversationId={id}
              state={getState(id)}
              onOpen={() => open(id)}
              onDismiss={() => dismiss(id)}
            />
          ))}

          {/* OVERFLOW. Tabs beyond the third collapse into a count rather than
              shrinking every tab until no name is readable. Tapping it fans the
              remainder upward, so hidden conversations stay one tap away
              instead of being unreachable until another tab closes. */}
          {minimised.length > MAX_VISIBLE_TABS && (
            <span style={{ position: 'relative', pointerEvents: 'auto', flexShrink: 0 }}>
              {overflowOpen && (
                <>
                  {/* Dismiss layer — below the fan, above everything else, so a
                      tap closes it without also activating what sits beneath. */}
                  <div onClick={() => setOverflowOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1 }} />

                  <div style={{ position: 'absolute', bottom: 'calc(100% + 7px)', left: 0, zIndex: 2, display: 'flex', flexDirection: 'column-reverse', gap: 6, minWidth: 190 }}>
                    {minimised.slice(MAX_VISIBLE_TABS).map((id, i) => {
                      const st = getState(id);
                      const nm = st.profile?.name ?? 'Conversation';
                      const un = st.unread ?? 0;
                      return (
                        <div
                          key={id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            background: 'rgba(26,26,32,.98)',
                            border: '1px solid rgba(255,255,255,.10)',
                            borderRadius: 11, padding: '7px 9px',
                            boxShadow: '0 8px 22px -10px rgba(0,0,0,.8)',
                            // Staggered so they fan open rather than appearing at once.
                            animation: `ypFanUp .26s cubic-bezier(.16,1,.3,1) ${i * 40}ms both`,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => { setOverflowOpen(false); open(id); }}
                            aria-label={`Reopen conversation with ${nm}`}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                          >
                            <TabAvatar name={nm} src={st.profile?.avatar} />
                            <span style={{ minWidth: 0, flex: 1, color: 'rgba(255,255,255,.86)', fontSize: 12.5, fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {nm}
                            </span>
                            {un > 0 && (
                              <span aria-label={`${un} unread`} style={{ minWidth: 15, height: 15, borderRadius: 999, background: '#FF3B30', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', flexShrink: 0 }}>
                                {un > 9 ? '9+' : un}
                              </span>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => dismiss(id)}
                            aria-label={`Close conversation with ${nm}`}
                            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.34)', fontSize: 14, cursor: 'pointer', lineHeight: 1, padding: '0 1px', flexShrink: 0 }}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              <button
                type="button"
                onClick={() => setOverflowOpen(o => !o)}
                aria-expanded={overflowOpen}
                aria-label={`${minimised.length - MAX_VISIBLE_TABS} more minimised conversations`}
                style={{
                  display: 'flex', alignItems: 'center',
                  height: 32, padding: '0 10px',
                  background: 'rgba(24,24,29,.97)',
                  border: '1px solid rgba(255,255,255,.09)',
                  borderBottom: 'none',
                  borderRadius: '11px 11px 0 0',
                  color: overflowOpen ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.5)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                +{minimised.length - MAX_VISIBLE_TABS}
              </button>
            </span>
          )}
        </div>
      )}

      {/* ── The drawer ── */}
      {openId && (
        <div
          /* Geometry lives in `.yp-drawer-overlay` (index.css), because it has
             to differ between phone and desktop and an inline style cannot
             carry a media query. On a phone the drawer is the whole screen;
             on desktop it stays a panel docked below the top bar.

             The nav rule is enforced there too: the overlay stops at
             `--yp-nav-height` in BOTH cases. */
          className="yp-drawer-overlay"
          onClick={() => minimise(openId)}
        >
          <div
            role="dialog"
            aria-label="Conversation"
            className="yp-drawer-panel"
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 560,
              // Fills the space the overlay allows — which already excludes the
              // nav — so the composer lands immediately above it and the thread
              // is never clipped. Sizing from dvh here would reintroduce the
              // overlap the rule forbids.
              height: '100%',
              // OPAQUE, deliberately. The conversation is its own environment,
              // not a pane of glass over the profile you came from — seeing a
              // face through the thread undermines that it is a separate space.
              // Charcoal with a slight gradient and a soft vignette, so it has
              // depth without translucency.
              background: `
                radial-gradient(120% 70% at 50% 0%, rgba(191,95,255,.10), transparent 60%),
                radial-gradient(100% 60% at 50% 100%, rgba(0,0,0,.55), transparent 60%),
                linear-gradient(180deg, #17171B 0%, #121215 40%, #0E0E11 100%)
              `,
              // border / border-radius / box-shadow live in `.yp-drawer-panel`,
              // NOT here. The phone breakpoint has to square the corners off,
              // and an inline style beats a stylesheet rule — leaving them here
              // would make the media query silently do nothing.
              position: 'relative',   // anchors the hand watermark below
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
              animation: 'ypDrawerUp .44s cubic-bezier(.16,1,.3,1)',
            }}
          >
            {/* The app-wide hand watermark (index.css body::after) cannot show
                through an opaque surface, so the conversation carries its own.
                Same asset, same centring, a little fainter — the dock sits
                closer to the eye than the page behind it. */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                backgroundImage: "url('/hand-logo.png')",
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center 46%',
                backgroundSize: 'min(66%, 330px)',
                opacity: 0.06,
              }}
            />

            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
              <ConversationView
                conversationId={openId}
                compact
                onMinimise={() => minimise(openId)}
              />
            </div>

          </div>

          <style>{`
            @keyframes ypDrawerUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
            @keyframes ypDockFade { from { opacity: 0 } to { opacity: 1 } }
          `}</style>
        </div>
      )}
    </>
  );
}

/**
 * The minimised conversation. It is ALIVE, not a shortcut — reopening restores
 * draft, scroll, playback and everything else held in shell state.
 */
function ConversationTab({ state, onOpen, onDismiss }) {
  const name     = state.profile?.name ?? 'Conversation';
  const unread   = state.unread ?? 0;
  const hasDraft = Boolean(state.draft?.trim());

  return (
    /* A TAB, not a card. Square top corners on a flat bottom edge, docked to
       the nav, sized to its content rather than 92% of the screen. No shadow —
       a drop shadow is what lifts something off the page and makes it read as
       floating content. Width is capped so a long name truncates instead of
       pushing a second tab off screen. */
    /* An UNREAD tab wears the brand gradient as its border — no glow. The tab
       is the thing sitting on the nav, so it is where "something is waiting"
       belongs; the inbox card says WHICH conversation, the tab only says
       there is one.

       Two-background trick: an opaque padding-box keeps the dark fill while
       the border-box carries the gradient. A plain `border` cannot take a
       gradient, and a solid approximation would drift from the brand ramp
       used everywhere else. */
    <div style={{
      pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 7,
      maxWidth: 210, minWidth: 0,
      ...(unread > 0
        ? {
            background: 'linear-gradient(rgba(24,24,29,.97), rgba(24,24,29,.97)) padding-box, linear-gradient(135deg, #00E5FF, #BF5FFF) border-box',
            border: '1px solid transparent',
          }
        : {
            background: 'rgba(24,24,29,.97)',
            border: '1px solid rgba(255,255,255,.09)',
          }),
      borderBottom: 'none',
      borderRadius: '11px 11px 0 0',
      padding: '5px 8px 6px 6px',
    }}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Reopen conversation with ${name}`}
        style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
      >
        <TabAvatar name={name} src={state.profile?.avatar} />

        {/* Name only. The subtitle is gone: "Tap to continue" told the user
            nothing they could not infer, and a message preview is content —
            it invites reading, which is the opposite of a reminder you barely
            notice. Draft state survives as a dot rather than a sentence. */}
        <span style={{ minWidth: 0, flex: 1, color: 'rgba(255,255,255,.86)', fontSize: 12.5, fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>

        {/* No unread badge. The gradient border already says "something is
            waiting", and a red dot on top of it is the same message twice —
            on the element whose whole brief is to be barely noticed. The
            exact count lives on the inbox card and the nav badge, which is
            where a number is actually useful. */}
        {hasDraft && (
          <span
            aria-label="Draft saved"
            title="Draft saved"
            style={{ width: 5, height: 5, borderRadius: 999, flexShrink: 0, background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)' }}
          />
        )}
      </button>

      {/* Explicit teardown. Separate from minimise so an accidental tap on the
          drawer backdrop can never discard a draft. Quiet, but still a real
          target — it is the only way to actually end a conversation. */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Close conversation with ${name}`}
        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.34)', fontSize: 14, cursor: 'pointer', lineHeight: 1, padding: '0 1px', flexShrink: 0 }}
      >
        ×
      </button>
    </div>
  );
}
