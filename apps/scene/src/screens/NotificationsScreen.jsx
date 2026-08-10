import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import { getNotifMeta, cleanMessage } from '../lib/notifMeta';
import { acceptSlotOffer, declineSlotOffer, acceptInvite, declineInvite, dismissNotification, markResponded } from '../lib/notifActions';
import NotificationPreferences from '../components/NotificationPreferences';
import PushNotificationToggle from '../components/PushNotificationToggle';
import {
  conversationNotificationTypes, KNOWN_CONVERSATION_TYPES,
} from '../lib/conversationNotifications';
import useSeenNotifications from '../hooks/useSeenNotifications';

export default function NotificationsScreen() {
  const { session } = useSession();
  const [notifs, setNotifs]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  // Arriving via the cog in NotifPanel opens preferences directly, rather than
  // landing on the list and making the user find MANAGE. Keyed on the location
  // object so clicking the cog while ALREADY on this screen still opens them —
  // `state.openPrefs` alone would be referentially equal and the effect would
  // not re-run.
  const location = useLocation();
  const [prefsOpen, setPrefsOpen] = useState(!!location.state?.openPrefs);
  useEffect(() => {
    if (location.state?.openPrefs) setPrefsOpen(true);
  }, [location]);
  const pollRef = useRef(null);
  // DEF-4 — see the note under load(). `observe` is attached to each row and
  // marks it read once it has actually been on screen.
  const { observe } = useSeenNotifications({
    enabled: !!session,
    onSeen: ids => setNotifs(prev => prev.map(
      n => (ids.includes(n.id) ? { ...n, read: true } : n))),
  });
  // Conversation types are read from the policy table so voice notes, images
  // and attachments join the rule by being categorised, not by someone
  // remembering to extend a list. Falls back to the known set on failure —
  // an empty list would mean "exclude nothing" and put messages back in the
  // feed, which is the defect this fixes.
  const convTypesRef = useRef(KNOWN_CONVERSATION_TYPES);

  async function load(cancelled = { current: false }) {
    if (!session) { setLoading(false); return; }
    const { data } = await supabase
      .from('notifications')
      .select('*')
      // Account-wide, per R5. Feed scoping to the active profile is deferred
      // until an active-profile concept exists — see writeNotification.js.
      .eq('to_user_id', session.user.id)
      // NP1: muted categories are recorded but never shown.
      .is('suppressed_at', null)
      // SEC-6a — dismissed rows are hidden, never deleted.
      .is('dismissed_at', null)
      // DEF-3 — conversation activity belongs to the MESSAGES badge and
      // nowhere else. The rows are still WRITTEN (N1's held pile and future
      // push both need them); they are simply not a notification-feed concern.
      // Excluding them from the bell COUNT but not from this list is what made
      // the feed fill up with "New message" while the bell stayed at zero.
      .not('type', 'in', `(${convTypesRef.current.join(',')})`)
      // CJ2 — "In Messages only" means only in Messages. The bell is a
      // different tab, so an in_app row must not appear in this feed.
      .neq('channel', 'in_app')
      .order('created_at', { ascending: false })
      .limit(60);
    if (cancelled.current) return;
    setNotifs(data || []);
    setLoading(false);
  }

  /**
   * DEF-4 · THE MARK-READ WRITE THAT USED TO LIVE HERE IS GONE, and the three
   * filters above no longer carry a second job.
   *
   * Two of them used to be defended with ⚠ notes explaining that anything this
   * query returned got marked read on its way past — so a dismissed row left in
   * would come back from an undismiss already-read, and an `in_app` row left in
   * would mean opening the BELL silently cleared the FIND FRIENDS badge. Both
   * hazards are retired: this query no longer writes anything, and rows are
   * marked read by having been SEEN. The filters stay because a dismissed row
   * and an in_app row still do not belong in this feed — which is all they were
   * ever supposed to mean.
   *
   * ⚠ It also fixes what this screen was doing to the rows it never showed. It
   * fetches 60 and renders 8 until SEE ALL is pressed, so up to 52 rows per
   * visit were marked read without ever being on screen — and the bell counts
   * only `read = false`, so they could never ask for attention again.
   */

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    const cancelled = { current: false };
    (async () => {
      convTypesRef.current = await conversationNotificationTypes();
      if (!cancelled.current) load(cancelled);
    })();
    pollRef.current = setInterval(() => load(cancelled), 30000);
    return () => { cancelled.current = true; clearInterval(pollRef.current); };
  }, [session]);

  function updateNotif(id, changes) {
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, ...changes } : n));
  }

  // Drops the row from THIS list only; the record stays. Matches NotifPanel —
  // the two surfaces show the same rows and must not diverge.
  function removeNotif(id) {
    setNotifs(prev => prev.filter(n => n.id !== id));
  }

  const visible = expanded ? notifs : notifs.slice(0, 8);

  return (
    <div style={{ paddingTop: 72, paddingBottom: 90, minHeight: '100dvh', background: 'var(--bg)', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px' }}>

        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 3, background: 'linear-gradient(135deg, #00E5FF, #BF5FFF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', display: 'inline-block' }}>
            NOTIFICATIONS
          </div>
          {/* NP1 · preferences live here rather than in a settings section the
              app does not have. This is where someone comes when they want
              fewer of these, so it is where the control belongs. */}
          <button
            type="button"
            onClick={() => setPrefsOpen(o => !o)}
            aria-expanded={prefsOpen}
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', borderRadius: 999, color: 'var(--muted)', fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, letterSpacing: 1.5, padding: '5px 12px', cursor: 'pointer' }}
          >
            {prefsOpen ? 'DONE' : 'MANAGE'}
          </button>
        </div>

        {prefsOpen && (
          <>
            <PushNotificationToggle session={session} />
            <NotificationPreferences session={session} />
          </>
        )}

        {loading && (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.35)', fontFamily: "'Bebas Neue',sans-serif", fontSize: 14, letterSpacing: 2, padding: '48px 0' }}>
            LOADING…
          </div>
        )}

        {!loading && notifs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 0' }}>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, letterSpacing: 2, color: 'rgba(255,255,255,.3)' }}>NO NOTIFICATIONS YET</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.2)', marginTop: 6 }}>We'll let you know when something happens.</div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visible.map(n => (
            <NotifRow key={n.id} notif={n} userId={session?.user?.id} onUpdate={updateNotif} onDismiss={removeNotif} rootRef={n.read ? undefined : observe(n.id)} />
          ))}
        </div>

        {!expanded && notifs.length > 8 && (
          <button
            onClick={() => setExpanded(true)}
            style={{ display: 'block', width: '100%', marginTop: 14, padding: '12px', fontFamily: "'Bebas Neue',sans-serif", fontSize: 13, letterSpacing: 2, color: 'rgba(255,255,255,.4)', background: 'none', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, cursor: 'pointer' }}
          >
            SEE ALL ({notifs.length - 8} MORE)
          </button>
        )}
      </div>
    </div>
  );
}

function NotifRow({ notif, userId, onUpdate, onDismiss, rootRef }) {
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
    // ⭐ The invitation named ONE act — pass it, rather than letting
    // acceptInvite re-derive it from the account and lose it on a
    // multi-act holder.
    await acceptInvite(data, userId, notif.to_profile_id ?? null);
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

  // An unanswered offer cannot be dismissed — this row is its only surface.
  // See the fuller note in NotifPanel.
  const dismissible = !actionable;

  async function handleDismiss() {
    if (dismissing) return;
    setDismissing(true);
    const { error } = await dismissNotification(notif.id);
    if (error) { setDismissing(false); return; }
    onDismiss(notif.id);
  }

  return (
    <div ref={rootRef} style={{
      display: 'flex',
      gap: 14,
      padding: '14px 16px',
      borderRadius: 14,
      background: isUnread ? `rgba(${meta.rgb},.05)` : 'rgba(255,255,255,.03)',
      border: `1px solid ${isUnread ? `rgba(${meta.rgb},.2)` : 'rgba(255,255,255,.07)'}`,
    }}>

      {/* Icon circle */}
      <div style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 22, background: meta.bg, border: `1px solid rgba(${meta.rgb},.35)`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
        <Icon color={meta.col} size={20} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          {/* White heading, coloured icon — matches NotifPanel; see the note
              there. The two surfaces show the same rows and must not diverge. */}
          <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 11, letterSpacing: 1.5, color: '#fff' }}>
            {meta.label}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: 'rgba(255,255,255,.28)' }}>
              {getTimeAgo(notif.created_at)}
            </span>
            {isUnread && <div style={{ width: 7, height: 7, borderRadius: '50%', background: meta.col, flexShrink: 0 }} />}
            {dismissible && (
              <button
                onClick={handleDismiss}
                disabled={dismissing}
                aria-label="Dismiss notification"
                title="Dismiss"
                style={{
                  flexShrink: 0, width: 20, height: 20, lineHeight: '18px', padding: 0,
                  borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer',
                  color: 'rgba(255,255,255,.28)', fontSize: 12,
                  fontFamily: "'DM Sans',sans-serif",
                }}
              >
                {dismissing ? '·' : '✕'}
              </button>
            )}
          </div>
        </div>

        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, fontWeight: isUnread ? 600 : 400, color: isUnread ? '#fff' : 'rgba(255,255,255,.65)', lineHeight: 1.45 }}>
          {message}
        </div>

        {data.event_name && (
          <div style={{ fontSize: 11, color: `rgba(${meta.rgb},.75)`, fontFamily: "'Bebas Neue',sans-serif", letterSpacing: 1, marginTop: 4 }}>
            {data.event_name}
          </div>
        )}

        {notif.type === 'event_invite' && (data.proposed_date || data.proposed_fee) && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(255,255,255,.04)', borderRadius: 8, display: 'flex', gap: 20 }}>
            {data.proposed_date && (
              <div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', fontFamily: "'Bebas Neue',sans-serif", letterSpacing: 1 }}>DATE</div>
                <div style={{ fontSize: 13, color: '#fff', fontFamily: "'DM Sans',sans-serif" }}>{data.proposed_date}</div>
              </div>
            )}
            {data.proposed_fee && (
              <div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', fontFamily: "'Bebas Neue',sans-serif", letterSpacing: 1 }}>FEE</div>
                <div style={{ fontSize: 13, color: '#fff', fontFamily: "'DM Sans',sans-serif" }}>{data.proposed_fee}</div>
              </div>
            )}
          </div>
        )}

        {actionable && notif.type === 'slot_offer' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={handleAcceptSlot} disabled={busy} style={actionBtn(meta.col, false)}>{busy ? '…' : '✓ ACCEPT SLOT'}</button>
            <button onClick={handleDeclineSlot} disabled={busy} style={actionBtn(null, true)}>{busy ? '…' : '✕ DECLINE'}</button>
          </div>
        )}
        {actionable && notif.type === 'event_invite' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={handleAcceptInvite} disabled={busy} style={{ ...actionBtn(null, false), background: 'linear-gradient(135deg,#00E5FF,#BF5FFF)', color: '#0a0a14' }}>{busy ? '…' : '✓ ACCEPT'}</button>
            <button onClick={handleDeclineInvite} disabled={busy} style={actionBtn(null, true)}>{busy ? '…' : '✕ DECLINE'}</button>
          </div>
        )}
        {responded && (notif.type === 'slot_offer' || notif.type === 'event_invite') && (
          <div style={{ marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,.28)', fontFamily: "'Bebas Neue',sans-serif", letterSpacing: 1 }}>RESPONDED ✓</div>
        )}
      </div>
    </div>
  );
}

function actionBtn(col, ghost) {
  return {
    fontFamily: "'Bebas Neue',sans-serif", fontSize: 12, letterSpacing: 1.2,
    padding: '8px 18px', borderRadius: 10, cursor: 'pointer',
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
