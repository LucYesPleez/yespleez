import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useConversationUi } from '../lib/conversationUi';
import ConversationView from './ConversationView';

/**
 * THE CONVERSATION DOCK — drawer + minimised pills. Mounted ONCE by the app
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
 * not replaced. Closing minimises to a pill immediately above the bottom nav.
 * `--yp-nav-height` is maintained by BottomNav's ResizeObserver, so the pill
 * sits correctly above it including the safe-area inset.
 */
export default function ConversationDock() {
  const { openId, minimised, open, minimise, dismiss, getState } = useConversationUi();
  const location = useLocation();
  const touchStartY = useRef(null);

  // "Opening another screen" MINIMISES — it does not close, and it does not
  // leave the drawer covering the screen the user just navigated to. The dock
  // outlives the route change; only its presentation collapses.
  useEffect(() => {
    if (openId) minimise(openId);
    // Intentionally keyed on the path alone: this must fire on navigation, not
    // when a conversation opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  function onTouchStart(e) {
    touchStartY.current = e.touches?.[0]?.clientY ?? null;
  }

  // Swipe down to minimise. Deliberately generous (56px) and downward-only, so
  // a scroll gesture inside the thread cannot collapse the drawer by accident.
  function onTouchEnd(e) {
    const start = touchStartY.current;
    const end   = e.changedTouches?.[0]?.clientY;
    touchStartY.current = null;
    if (start == null || end == null) return;
    if (end - start > 56) minimise(openId);
  }

  return (
    <>
      {/* ── Minimised pills, stacked above the bottom nav ── */}
      {minimised.length > 0 && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(var(--yp-nav-height, 64px) + 8px)', zIndex: 140, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, pointerEvents: 'none' }}>
          {minimised.map(id => (
            <ConversationPill
              key={id}
              conversationId={id}
              state={getState(id)}
              onOpen={() => open(id)}
              onDismiss={() => dismiss(id)}
            />
          ))}
        </div>
      )}

      {/* ── The drawer ── */}
      {openId && (
        <div
          /* CONSTITUTIONAL LAYOUT RULE — THE BOTTOM NAVIGATION IS SACRED.
             Nothing renders underneath it. Not this dock, not the backdrop.
             So the overlay STOPS at the top of the nav (`bottom`), rather than
             covering the viewport and letting the nav sit on top of it.
             --yp-nav-height is measured by BottomNav's ResizeObserver and
             includes the safe-area inset, so this is reserved layout space —
             not padding applied after the fact. */
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 'var(--yp-nav-height, 64px)', zIndex: 160, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,.78)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', animation: 'ypDockFade .28s ease-out' }}
          onClick={() => minimise(openId)}
        >
          <div
            role="dialog"
            aria-label="Conversation"
            onClick={e => e.stopPropagation()}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
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
              border: '1px solid rgba(255,255,255,.08)',
              borderRadius: '30px 30px 0 0',
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 -24px 70px rgba(0,0,0,.7)',
              animation: 'ypDrawerUp .44s cubic-bezier(.16,1,.3,1)',
            }}
          >
            <ConversationView
              conversationId={openId}
              compact
              onMinimise={() => minimise(openId)}
            />

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
function ConversationPill({ state, onOpen, onDismiss }) {
  const name    = state.profile?.name ?? 'Conversation';
  const preview = state.lastPreview;
  const unread  = state.unread ?? 0;
  const hasDraft = Boolean(state.draft?.trim());

  return (
    <div style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 10, width: 'min(92%, 520px)', background: 'rgba(20,20,24,.96)', border: '1px solid var(--border)', borderRadius: 999, padding: '8px 12px', boxShadow: '0 6px 24px rgba(0,0,0,.45)' }}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Reopen conversation with ${name}`}
        style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
      >
        <span style={{ width: 30, height: 30, borderRadius: 999, background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', fontFamily: "'Bebas Neue',sans-serif", fontSize: 13, flexShrink: 0 }}>
          {name.slice(0, 1).toUpperCase()}
        </span>

        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', color: 'var(--text)', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
          <span style={{ display: 'block', color: 'var(--muted)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {hasDraft
              ? 'Draft saved'
              : preview?.kind === 'voice'
                ? '🎤 Voice note'
                : preview?.text || 'Tap to continue'}
          </span>
        </span>

        {unread > 0 && (
          <span aria-label={`${unread} unread`} style={{ minWidth: 18, height: 18, borderRadius: 999, background: '#FF3B30', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flexShrink: 0 }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Explicit teardown. Separate from minimise so an accidental tap on the
          drawer backdrop can never discard a draft. */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Close conversation with ${name}`}
        style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
      >
        ×
      </button>
    </div>
  );
}
