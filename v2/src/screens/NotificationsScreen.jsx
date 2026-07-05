import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import s from './NotificationsScreen.module.css';

export default function NotificationsScreen() {
  const navigate = useNavigate();
  const { session } = useSession();
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const pollRef = useRef(null);

  async function load(cancelled = { current: false }) {
    if (!session) { setLoading(false); return; }
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (cancelled.current) return;
    setNotifs(data || []);
    setLoading(false);
    // Mark all as read
    const unreadIds = (data || []).filter(n => !n.read).map(n => n.id);
    if (unreadIds.length > 0) {
      await supabase.from('notifications').update({ read: true }).in('id', unreadIds);
    }
  }

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    const cancelled = { current: false };
    load(cancelled);
    pollRef.current = setInterval(() => load(cancelled), 30000);
    return () => {
      cancelled.current = true;
      clearInterval(pollRef.current);
    };
  }, [session]);

  const unreadCount = notifs.filter(n => !n.read).length;
  const visible = expanded ? notifs : notifs.slice(0, 6);

  function updateNotif(id, changes) {
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, ...changes } : n));
  }

  return (
    <div className={s.screen}>
      <div className={s.header}>
        <h1 className={s.title}>
          NOTIFICATIONS
          {unreadCount > 0 && <span className={s.unreadBadge}>{unreadCount}</span>}
        </h1>
      </div>

      <div className={s.list}>
        {loading && <p className={s.empty}>Loading…</p>}
        {!loading && notifs.length === 0 && <p className={s.empty}>No notifications yet.</p>}
        {visible.map(n => (
          <NotifRow
            key={n.id}
            notif={n}
            userId={session?.user?.id}
            onUpdate={updateNotif}
          />
        ))}
        {!expanded && notifs.length > 6 && (
          <button className={s.seeMore} onClick={() => setExpanded(true)}>
            SEE ALL ({notifs.length - 6} MORE)
          </button>
        )}
      </div>
    </div>
  );
}

function NotifRow({ notif, userId, onUpdate }) {
  const [busy, setBusy] = useState(false);
  const [responded, setResponded] = useState(!!notif.responded_at);
  const timeAgo = getTimeAgo(notif.created_at);
  const data = notif.data || {};

  async function acceptSlotOffer() {
    if (!userId || busy) return;
    setBusy(true);
    // Upsert to claims
    await supabase.from('claims').upsert({
      event_id: data.event_id,
      slot_id: data.slot_id,
      user_id: userId,
      name: data.artist_name || '',
      genre: data.genre || '',
      sound: data.sound || '',
      card_pills: data.card_pills || [],
    });
    // Update slot_offers status
    if (data.slot_offer_id) {
      await supabase.from('slot_offers').update({ status: 'accepted' }).eq('id', data.slot_offer_id);
    }
    // Notify host
    if (data.host_id) {
      await supabase.from('notifications').insert({
        user_id: data.host_id,
        type: 'slot_accepted',
        message: `${data.artist_name || 'An artist'} accepted the slot offer for ${data.event_name || 'your event'}.`,
        data: { event_id: data.event_id, slot_id: data.slot_id, artist_user_id: userId },
      });
    }
    onUpdate(notif.id, { responded_at: new Date().toISOString() });
    setResponded(true);
    setBusy(false);
  }

  async function declineSlotOffer() {
    if (!userId || busy) return;
    setBusy(true);
    if (data.slot_offer_id) {
      await supabase.from('slot_offers').update({ status: 'declined' }).eq('id', data.slot_offer_id);
    }
    if (data.host_id) {
      await supabase.from('notifications').insert({
        user_id: data.host_id,
        type: 'slot_declined',
        message: `${data.artist_name || 'An artist'} declined the slot offer for ${data.event_name || 'your event'}.`,
        data: { event_id: data.event_id, slot_id: data.slot_id, artist_user_id: userId },
      });
    }
    onUpdate(notif.id, { responded_at: new Date().toISOString() });
    setResponded(true);
    setBusy(false);
  }

  async function acceptInvite() {
    if (!userId || busy) return;
    setBusy(true);
    await supabase.from('applications').insert({
      event_id: data.event_id,
      artist_id: userId,
      status: 'pending',
      via_invite: true,
      artist_name: data.artist_name,
      genre: data.genre,
      mix_link: data.mix_link,
    });
    if (data.host_id) {
      await supabase.from('notifications').insert({
        user_id: data.host_id,
        type: 'invite_accepted',
        message: `${data.artist_name || 'An artist'} accepted your invite to ${data.event_name || 'your event'}.`,
        data: { event_id: data.event_id, artist_user_id: userId },
      });
    }
    onUpdate(notif.id, { responded_at: new Date().toISOString() });
    setResponded(true);
    setBusy(false);
  }

  async function declineInvite() {
    if (!userId || busy) return;
    setBusy(true);
    onUpdate(notif.id, { responded_at: new Date().toISOString() });
    setResponded(true);
    setBusy(false);
  }

  return (
    <div className={notif.read ? s.notifRead : s.notif}>
      <div className={s.notifDot} style={{ opacity: notif.read ? 0 : 1 }} />
      <div className={s.notifBody}>
        {notif.type && <p className={s.notifType}>{notif.type.toUpperCase().replace(/_/g, ' ')}</p>}
        <p className={s.notifMsg}>{notif.message}</p>
        {data.event_name && <p className={s.notifEvent}>{data.event_name}</p>}
        <p className={s.notifTime}>{timeAgo}</p>

        {!responded && notif.type === 'slot_offer' && (
          <div className={s.notifActions}>
            <button className={s.btnAccept} onClick={acceptSlotOffer} disabled={busy}>
              {busy ? '…' : '✓ ACCEPT SLOT'}
            </button>
            <button className={s.btnDecline} onClick={declineSlotOffer} disabled={busy}>
              {busy ? '…' : '✕ DECLINE'}
            </button>
          </div>
        )}

        {!responded && notif.type === 'event_invite' && (
          <div className={s.notifActions}>
            <button className={s.btnAccept} onClick={acceptInvite} disabled={busy}>
              {busy ? '…' : '✓ ACCEPT'}
            </button>
            <button className={s.btnDecline} onClick={declineInvite} disabled={busy}>
              {busy ? '…' : '✕ DECLINE'}
            </button>
          </div>
        )}

        {responded && (notif.type === 'slot_offer' || notif.type === 'event_invite') && (
          <p className={s.notifResponded}>Responded ✓</p>
        )}
      </div>
    </div>
  );
}

function getTimeAgo(ts) {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
