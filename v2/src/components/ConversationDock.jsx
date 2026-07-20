import { Link } from 'react-router-dom';
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
          style={{ position: 'fixed', inset: 0, zIndex: 160, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,.5)' }}
          onClick={() => minimise(openId)}
        >
          <div
            role="dialog"
            aria-label="Conversation"
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 560,
              height: 'min(78dvh, 680px)',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: '18px 18px 0 0',
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
              animation: 'ypDrawerUp .22s ease-out',
            }}
          >
            <ConversationView
              conversationId={openId}
              compact
              onMinimise={() => minimise(openId)}
            />

            <div style={{ borderTop: '1px solid var(--border)', padding: '8px 16px', textAlign: 'center' }}>
              {/* The full inbox still exists — for search, archive, pinning and
                  management. Daily communication happens in this drawer. */}
              <Link
                to="/messages"
                onClick={() => minimise(openId)}
                style={{ color: 'var(--muted)', fontFamily: "'Bebas Neue',sans-serif", fontSize: 12, letterSpacing: 1.5, textDecoration: 'none' }}
              >
                SEE ALL MESSAGES
              </Link>
            </div>
          </div>

          <style>{`@keyframes ypDrawerUp { from { transform: translateY(12%); opacity: .6 } to { transform: translateY(0); opacity: 1 } }`}</style>
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
