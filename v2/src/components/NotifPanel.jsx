import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import { getNotifMeta, cleanMessage } from '../lib/notifMeta';
import { acceptSlotOffer, declineSlotOffer, acceptInvite, declineInvite } from '../lib/notifActions';

export default function NotifPanel({ onClose, onMarkAll }) {
  const navigate = useNavigate();
  const { session } = useSession();
  const [notifs, setNotifs]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit]     = useState(10);
  const ref = useRef(null);

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(60);
      setNotifs(data || []);
      setLoading(false);
      const ids = (data || []).filter(n => !n.read).map(n => n.id);
      if (ids.length) {
        await supabase.from('notifications').update({ read: true }).in('id', ids);
        if (onMarkAll) onMarkAll();
      }
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

  async function markAllRead() {
    const ids = notifs.filter(n => !n.read).map(n => n.id);
    if (ids.length) await supabase.from('notifications').update({ read: true }).in('id', ids);
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    if (onMarkAll) onMarkAll();
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
      <style>{`
        @keyframes notifFadeIn { from { opacity:0; transform:translateY(-8px) } to { opacity:1; transform:translateY(0) } }
        .yp-notif-list::-webkit-scrollbar { width: 3px; }
        .yp-notif-list::-webkit-scrollbar-track { background: transparent; }
        .yp-notif-list::-webkit-scrollbar-thumb { background: rgba(191,95,255,.25); border-radius: 2px; }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 16, letterSpacing: 3, color: '#fff' }}>NOTIFICATIONS</div>
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
            isLast={i === visible.length - 1 && !hasMore}
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

function PanelRow({ notif, userId, onUpdate, isLast }) {
  const [busy, setBusy]           = useState(false);
  const [responded, setResponded] = useState(!!notif.responded_at);
  const meta = getNotifMeta(notif.type, notif.message);
  const { Icon } = meta;
  const data = notif.data || {};
  const message = cleanMessage(notif.message);
  const isUnread = !notif.read;

  async function handleAcceptSlot() {
    if (!userId || busy) return;
    setBusy(true);
    await acceptSlotOffer(data, userId);
    onUpdate(notif.id, { responded_at: new Date().toISOString() });
    setResponded(true); setBusy(false);
  }
  async function handleDeclineSlot() {
    if (!userId || busy) return;
    setBusy(true);
    await declineSlotOffer(data, userId);
    onUpdate(notif.id, { responded_at: new Date().toISOString() });
    setResponded(true); setBusy(false);
  }
  async function handleAcceptInvite() {
    if (!userId || busy) return;
    setBusy(true);
    await acceptInvite(data, userId);
    onUpdate(notif.id, { responded_at: new Date().toISOString() });
    setResponded(true); setBusy(false);
  }
  async function handleDeclineInvite() {
    if (!userId || busy) return;
    setBusy(true);
    await declineInvite(data, userId);
    onUpdate(notif.id, { responded_at: new Date().toISOString() });
    setResponded(true); setBusy(false);
  }

  const actionable = !responded && (notif.type === 'slot_offer' || notif.type === 'event_invite');

  return (
    <div style={{ display: 'flex', gap: 12, padding: '12px 16px', borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,.05)', background: isUnread ? `rgba(${meta.rgb},.04)` : 'transparent' }}>

      {/* Icon circle */}
      <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 20, background: meta.bg, border: `1px solid rgba(${meta.rgb},.35)`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
        <Icon color={meta.col} size={18} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
          <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 10, letterSpacing: 1.5, color: meta.col }}>
            {meta.label}
          </span>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: 'rgba(255,255,255,.28)', whiteSpace: 'nowrap' }}>
              {getTimeAgo(notif.created_at)}
            </span>
            {isUnread && <div style={{ width: 7, height: 7, borderRadius: '50%', background: meta.col, flexShrink: 0 }} />}
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
