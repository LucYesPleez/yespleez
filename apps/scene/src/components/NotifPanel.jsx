import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import { getNotifMeta, cleanMessage } from '../lib/notifMeta';
import { acceptSlotOffer, declineSlotOffer, acceptInvite, declineInvite, dismissNotification, markResponded } from '../lib/notifActions';
import { conversationNotificationTypes } from '../lib/conversationNotifications';
import useSeenNotifications from '../hooks/useSeenNotifications';

export default function NotifPanel({ onClose }) {
  const navigate = useNavigate();
  const { session } = useSession();
  const [notifs, setNotifs]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit]     = useState(10);
  const ref = useRef(null);
  // DEF-4 — a row is read once it has been on screen for a moment, not once it
  // has been fetched. See lib/markNotificationsRead.js for what this replaced.
  const { observe, markSeenNow } = useSeenNotifications({
    enabled: !!session,
    onSeen: ids => setNotifs(prev => prev.map(
      n => (ids.includes(n.id) ? { ...n, read: true } : n))),
  });

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    (async () => {
      const convTypes = await conversationNotificationTypes();
      const { data } = await supabase
        .from('notifications')
        .select('*')
        // Account-wide, per R5. Feed scoping to the active profile is
        // deferred until an active-profile concept exists — see
        // writeNotification.js.
        .eq('to_user_id', session.user.id)
        // NP1: muted categories are recorded but never shown.
        .is('suppressed_at', null)
        // SEC-6a: dismissed rows are hidden, never deleted.
        .is('dismissed_at', null)
        // DEF-3 — conversation activity belongs to the MESSAGES badge and
        // nowhere else. This panel is the bell's own dropdown, so a message
        // appearing here is the bell reporting conversation activity by
        // another name.
        .not('type', 'in', `(${convTypes.join(',')})`)
        .order('created_at', { ascending: false })
        .limit(60);
      setNotifs(data || []);
      setLoading(false);
    })();
  }, [session]);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  function updateNotif(id, changes) {
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, ...changes } : n));
  }

  // Drops the row from THIS list only. The record is untouched in the
  // database — see dismissNotification.
  //
  // ⚠ THIS USED TO SAY the bell's count could not move, because the loader had
  // already marked everything read. Since DEF-4 it can: dismissing a row that
  // was never seen leaves it unread, and SEC-6a's badge query excludes
  // dismissed rows, so the count drops by one. dismissNotification's own write
  // is what the badge reacts to — nothing extra is needed here, but the number
  // moving is now correct rather than impossible.
  function removeNotif(id) {
    setNotifs(prev => prev.filter(n => n.id !== id));
  }

  // The explicit half of the read rule. Everything loaded is marked, including
  // the rows below `limit` that were never rendered — that is what the user
  // asked for by pressing a button called "Mark all as read".
  //
  // ⚠ This button was DEAD before DEF-4. The loader marked every row read on
  // open, so `anyUnread` was always false by the time anyone could reach it and
  // it rendered at opacity 0. It only means something now that opening the
  // panel no longer does its job for it.
  async function markAllRead() {
    const ids = notifs.filter(n => !n.read).map(n => n.id);
    if (!ids.length) return;
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    await markSeenNow(ids);
  }

  const visible = notifs.slice(0, limit);
  const hasMore = notifs.length > limit;
  const anyUnread = notifs.some(n => !n.read);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: 'calc(100% + 10px)',
        right: 0,
        width: 'min(390px, calc(100vw - 24px))',
        background: '#12121e',
        border: '1px solid rgba(191,95,255,.3)',
        borderRadius: 16,
        boxShadow: '0 16px 48px rgba(0,0,0,.7)',
        zIndex: 500,
        overflow: 'hidden',
        animation: 'notifFadeIn .18s ease',
      }}
    >
      {/* ⚠ The purple 3px scrollbar that used to live here is GONE, and must
          not come back — no scrollbar is visible anywhere on this site (see
          index.css). It is called out rather than silently deleted because
          `.yp-notif-list::-webkit-scrollbar` is MORE SPECIFIC than the global
          `*::-webkit-scrollbar`, so re-adding it here would quietly beat the
          law rather than fail loudly. */}
      <style>{`
        @keyframes notifFadeIn { from { opacity:0; transform:translateY(-8px) } to { opacity:1; transform:translateY(0) } }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 16, letterSpacing: 3, color: '#fff' }}>NOTIFICATIONS</span>
          {/* ⚠ THE COG IS THE ONLY WAY TO SETTINGS FROM HERE, AND THAT IS THE
              POINT. Owner: the footer link is "view all notifications" and
              nothing else. Two destinations that were previously reached
              through one link now have one control each — you cannot end up
              at the list when you wanted preferences. */}
          <button
            type="button"
            onClick={() => { onClose(); navigate('/notifications', { state: { openPrefs: true } }); }}
            aria-label="Notification settings"
            title="Notification settings"
            style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: 'rgba(255,255,255,.45)', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,.45)'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
        <button
          onClick={markAllRead}
          style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: '#FF3399', background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: anyUnread ? 1 : 0, pointerEvents: anyUnread ? 'auto' : 'none' }}
        >
          Mark all as read
        </button>
      </div>

      {/* List */}
      <div className="yp-notif-list" style={{ maxHeight: 420, overflowY: 'auto' }}>
        {loading && (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'rgba(255,255,255,.3)', fontFamily: "'Bebas Neue',sans-serif", fontSize: 13, letterSpacing: 2 }}>LOADING…</div>
        )}
        {!loading && notifs.length === 0 && (
          <div style={{ padding: '36px 16px', textAlign: 'center' }}>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 14, letterSpacing: 2, color: 'rgba(255,255,255,.25)', marginBottom: 4 }}>ALL CLEAR</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.2)' }}>No notifications yet.</div>
          </div>
        )}
        {visible.map((n, i) => (
          <PanelRow
            key={n.id}
            notif={n}
            userId={session?.user?.id}
            onUpdate={updateNotif}
            onDismiss={removeNotif}
            isLast={i === visible.length - 1 && !hasMore}
            rootRef={n.read ? undefined : observe(n.id)}
          />
        ))}
        {hasMore && (
          <button
            onClick={() => setLimit(l => l + 50)}
            style={{ display: 'block', width: '100%', padding: '12px', fontFamily: "'Bebas Neue',sans-serif", fontSize: 12, letterSpacing: 2, color: 'rgba(255,255,255,.35)', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,.07)', cursor: 'pointer' }}
          >
            VIEW MORE ({notifs.length - limit})
          </button>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,.07)', padding: '12px 16px' }}>
        <button
          onClick={() => { onClose(); navigate('/notifications'); }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: '#FF3399', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          View all notifications
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>
    </div>
  );
}

function PanelRow({ notif, userId, onUpdate, onDismiss, isLast, rootRef }) {
  const [busy, setBusy]           = useState(false);
  const [responded, setResponded] = useState(!!notif.responded_at);
  const [dismissing, setDismissing] = useState(false);
  const meta = getNotifMeta(notif.type, notif.message);
  const { Icon } = meta;
  const data = notif.data || {};
  const message = cleanMessage(notif.message);
  const isUnread = !notif.read;

  async function handleAcceptSlot() {
    if (!userId || busy) return;
    setBusy(true);
    await acceptSlotOffer(data, userId);
    await markResponded(notif.id);
    onUpdate(notif.id, { responded_at: new Date().toISOString() });
    setResponded(true); setBusy(false);
  }
  async function handleDeclineSlot() {
    if (!userId || busy) return;
    setBusy(true);
    await declineSlotOffer(data, userId);
    await markResponded(notif.id);
    onUpdate(notif.id, { responded_at: new Date().toISOString() });
    setResponded(true); setBusy(false);
  }
  async function handleAcceptInvite() {
    if (!userId || busy) return;
    setBusy(true);
    await acceptInvite(data, userId);
    await markResponded(notif.id);
    onUpdate(notif.id, { responded_at: new Date().toISOString() });
    setResponded(true); setBusy(false);
  }
  async function handleDeclineInvite() {
    if (!userId || busy) return;
    setBusy(true);
    await declineInvite(data, userId);
    await markResponded(notif.id);
    onUpdate(notif.id, { responded_at: new Date().toISOString() });
    setResponded(true); setBusy(false);
  }

  const actionable = !responded && (notif.type === 'slot_offer' || notif.type === 'event_invite');

  /**
   * ⚠ AN UNANSWERED OFFER CANNOT BE DISMISSED, and that is not timidity.
   * This row is the ONLY surface that can accept or decline a slot offer or an
   * event invite — there is no second place to find it. Hiding one would strand
   * the offer with no way back, so the control appears once the row is no
   * longer the thing standing between the user and a decision.
   */
  const dismissible = !actionable;

  async function handleDismiss() {
    if (dismissing) return;
    setDismissing(true);
    const { error } = await dismissNotification(notif.id);
    // Only drop it from view once the row is actually stamped. Removing it
    // optimistically would show it gone and bring it back on the next load,
    // which reads as the app losing track rather than the write failing.
    if (error) { setDismissing(false); return; }
    onDismiss(notif.id);
  }

  return (
    <div ref={rootRef} style={{ display: 'flex', gap: 12, padding: '12px 16px', borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,.05)', background: isUnread ? `rgba(${meta.rgb},.04)` : 'transparent' }}>

      {/* Icon circle */}
      <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 20, background: meta.bg, border: `1px solid rgba(${meta.rgb},.35)`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
        <Icon color={meta.col} size={18} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
          {/* ⚠ WHITE HEADING, COLOURED ICON — owner, deliberately. The colour
              coding still does its job from the icon disc on the left; having
              the label carry it too made every row read as a coloured block
              and cost the headings their legibility. One carrier of the code
              per row is enough. */}
          <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 10, letterSpacing: 1.5, color: '#fff' }}>
            {meta.label}
          </span>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: 'rgba(255,255,255,.28)', whiteSpace: 'nowrap' }}>
              {getTimeAgo(notif.created_at)}
            </span>
            {isUnread && <div style={{ width: 7, height: 7, borderRadius: '50%', background: meta.col, flexShrink: 0 }} />}
            {dismissible && (
              <button
                onClick={handleDismiss}
                disabled={dismissing}
                aria-label="Dismiss notification"
                title="Dismiss"
                style={dismissBtn}
              >
                {dismissing ? '·' : '✕'}
              </button>
            )}
          </div>
        </div>

        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: isUnread ? 600 : 400, color: isUnread ? '#fff' : 'rgba(255,255,255,.65)', lineHeight: 1.4 }}>
          {message}
        </div>

        {data.event_name && (
          <div style={{ fontSize: 11, color: `rgba(${meta.rgb},.7)`, fontFamily: "'Bebas Neue',sans-serif", letterSpacing: 1, marginTop: 3 }}>
            {data.event_name}
          </div>
        )}

        {actionable && notif.type === 'slot_offer' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button onClick={handleAcceptSlot} disabled={busy} style={actionBtn(meta.col, false)}>{busy ? '…' : '✓ ACCEPT'}</button>
            <button onClick={handleDeclineSlot} disabled={busy} style={actionBtn(null, true)}>{busy ? '…' : '✕ DECLINE'}</button>
          </div>
        )}
        {actionable && notif.type === 'event_invite' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button onClick={handleAcceptInvite} disabled={busy} style={{ ...actionBtn(null, false), background: 'linear-gradient(135deg,#00E5FF,#BF5FFF)', color: '#0a0a14' }}>{busy ? '…' : '✓ ACCEPT'}</button>
            <button onClick={handleDeclineInvite} disabled={busy} style={actionBtn(null, true)}>{busy ? '…' : '✕ DECLINE'}</button>
          </div>
        )}
        {responded && (notif.type === 'slot_offer' || notif.type === 'event_invite') && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,.28)', fontFamily: "'Bebas Neue',sans-serif", letterSpacing: 1 }}>RESPONDED ✓</div>
        )}
      </div>
    </div>
  );
}

/**
 * Quiet by default, legible on hover. Dismiss is a housekeeping action sitting
 * on every readable row, so at full strength it would compete with the message
 * for attention on a screen whose whole job is the message.
 */
const dismissBtn = {
  flexShrink: 0, width: 18, height: 18, lineHeight: '16px', padding: 0,
  borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer',
  color: 'rgba(255,255,255,.28)', fontSize: 11,
  fontFamily: "'DM Sans',sans-serif",
};

function actionBtn(col, ghost) {
  return {
    fontFamily: "'Bebas Neue',sans-serif", fontSize: 11, letterSpacing: 1.2,
    padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
    border: ghost ? '1px solid rgba(255,255,255,.15)' : 'none',
    background: ghost ? 'none' : col,
    color: ghost ? 'rgba(255,255,255,.45)' : '#0a0a14',
  };
}

function getTimeAgo(ts) {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
