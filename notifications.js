// ═══════════════════════════════════════════════════
//  notifications.js — YesPleez Notifications Module
//  Depends on: state.js, navigation.js (showToast)
// ═══════════════════════════════════════════════════

let notifications    = [];   // local in-session notifs (app events)
let _dbNotifs        = [];   // rows from Supabase notifications table
let notifUnread      = 0;
let _notifPolling    = null;

// ── Core push (local/in-session) ───────────────────

function pushNotif(icon, text, mode) {
  const n = { icon, text, time: Date.now(), read: false, mode: mode || 'both' };
  notifications.unshift(n);
  notifUnread++;
  updateNotifDot();
  renderNotifList();
  try { localStorage.setItem('yp_notifs', JSON.stringify(notifications.slice(0, 50))); } catch(e) {}
}

// ── Dot indicator ──────────────────────────────────

function updateNotifDot() {
  const mode = currentMode || 'both';
  const localUnread  = notifications.filter(n => !n.read && (!n.mode || n.mode === 'both' || n.mode === mode)).length;
  const dbUnread     = _dbNotifs.filter(n => !n.read).length;
  const active       = (localUnread + dbUnread) > 0;
  ['notifDotHost','notifDotArtist'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', active);
  });
}

// ── Load from Supabase ─────────────────────────────

async function loadDbNotifs() {
  if (DEMO || !currentUser?.id || currentUser.id === 'guest') return;
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    _dbNotifs = data || [];
    updateNotifDot();
    renderNotifList();
  } catch(e) {
    // notifications table may not exist yet — silent
    _dbNotifs = [];
  }
}

async function markDbNotifRead(notifId) {
  try {
    await supabase.from('notifications').update({ read: true }).eq('id', notifId);
    const n = _dbNotifs.find(n => n.id === notifId);
    if (n) n.read = true;
    updateNotifDot();
    renderNotifList();
  } catch(e) {}
}

// ── Panel open/close ───────────────────────────────

async function openNotifPanel() {
  await loadDbNotifs();
  renderNotifList();
  document.getElementById('notifPanel').classList.add('open');
  document.getElementById('notifBackdrop').style.display = '';
  // Mark local notifs read on open
  notifications.forEach(n => n.read = true);
  notifUnread = 0;
  updateNotifDot();
}

function closeNotifPanel() {
  document.getElementById('notifPanel').classList.remove('open');
  document.getElementById('notifBackdrop').style.display = 'none';
}

function markAllRead() {
  notifications.forEach(n => n.read = true);
  notifUnread = 0;
  // Mark all DB notifs read
  const unreadIds = _dbNotifs.filter(n => !n.read).map(n => n.id);
  _dbNotifs.forEach(n => n.read = true);
  updateNotifDot();
  renderNotifList();
  if (unreadIds.length) {
    supabase.from('notifications').update({ read: true }).in('id', unreadIds).then(() => {}).catch(() => {});
  }
}

// ── Render ─────────────────────────────────────────

function timeAgo(ts) {
  const secs = Math.floor((Date.now() - (typeof ts === 'number' ? ts : new Date(ts).getTime())) / 1000);
  if (secs < 60)    return 'just now';
  if (secs < 3600)  return Math.floor(secs/60)   + 'm ago';
  if (secs < 86400) return Math.floor(secs/3600)  + 'h ago';
  return Math.floor(secs/86400) + 'd ago';
}

function renderNotifList() {
  const el = document.getElementById('notifList');
  if (!el) return;
  const mode = currentMode || 'both';

  // Local notifs filtered by mode
  const localFiltered = notifications.filter(n => !n.mode || n.mode === 'both' || n.mode === mode);

  let html = '';

  // ── DB notifs first (invites, etc.) ──
  if (_dbNotifs.length) {
    _dbNotifs.forEach(n => {
      if (n.type === 'event_invite') {
        html += renderInviteNotif(n);
      } else {
        html += `
          <div class="notif-item${n.read ? '' : ' unread'}" onclick="markDbNotifRead('${n.id}')">
            <div><span class="notif-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7v4l-2 2v1h18v-1l-2-2V9a7 7 0 0 0-7-7zm0 20a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2z"/></svg>
            </span><span class="notif-text">${esc(n.message || '')}</span></div>
            <div class="notif-time">${timeAgo(n.created_at)}</div>
          </div>`;
      }
    });
  }

  // ── Local in-session notifs ──
  localFiltered.forEach(n => {
    html += `
      <div class="notif-item${n.read ? '' : ' unread'}">
        <div><span class="notif-icon">${n.icon || ''}</span><span class="notif-text">${n.text}</span></div>
        <div class="notif-time">${timeAgo(n.time)}</div>
      </div>`;
  });

  if (!html) {
    html = '<div class="notif-empty">No notifications yet</div>';
  }

  el.innerHTML = html;
}

function renderInviteNotif(n) {
  const isActioned = n.status === 'accepted' || n.status === 'declined';
  const statusBadge = n.status === 'accepted'
    ? `<span style="font-size:11px;color:var(--neon);letter-spacing:1px;font-family:'Bebas Neue',sans-serif;">ACCEPTED</span>`
    : n.status === 'declined'
    ? `<span style="font-size:11px;color:var(--muted);letter-spacing:1px;font-family:'Bebas Neue',sans-serif;">DECLINED</span>`
    : '';

  return `
    <div class="notif-item${n.read ? '' : ' unread'}" id="notifRow_${n.id}" style="display:block;padding:14px 16px;">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:${isActioned ? '0' : '12px'};">
        <div style="width:36px;height:36px;border-radius:8px;background:rgba(255,45,120,.15);border:1px solid rgba(255,45,120,.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--neon)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.07 9.8 19.79 19.79 0 0 1 1 1.17 2 2 0 0 1 3 .02h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 7.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 14.92z"/></svg>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1px;color:var(--neon);margin-bottom:3px;">EVENT INVITE</div>
          <div style="font-size:13px;color:var(--text);line-height:1.4;">${esc(n.message || 'You have been invited to perform at an event.')}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;">${timeAgo(n.created_at)}</div>
        </div>
        ${statusBadge ? `<div style="flex-shrink:0;">${statusBadge}</div>` : ''}
      </div>
      ${!isActioned ? `
        <div style="display:flex;gap:8px;">
          <button onclick="respondToInvite('${n.id}','${n.event_id||''}','accepted')"
            style="flex:1;background:var(--neon);color:#fff;border:none;border-radius:8px;font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1.5px;padding:10px;cursor:pointer;">
            ACCEPT
          </button>
          <button onclick="respondToInvite('${n.id}','${n.event_id||''}','declined')"
            style="flex:1;background:var(--card);color:var(--muted);border:1px solid var(--border);border-radius:8px;font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1.5px;padding:10px;cursor:pointer;">
            DECLINE
          </button>
        </div>` : ''}
    </div>`;
}

// ── Respond to invite ──────────────────────────────

async function respondToInvite(notifId, eventId, response) {
  const btn = document.querySelector(`#notifRow_${notifId} button`);
  if (btn) btn.disabled = true;

  try {
    await supabase.from('notifications')
      .update({ read: true, status: response })
      .eq('id', notifId);

    const n = _dbNotifs.find(n => n.id === notifId);
    if (n) { n.read = true; n.status = response; }

    if (response === 'accepted' && eventId) {
      // Add artist as an applicant/accepted entry on the event
      await supabase.from('applications').upsert({
        event_id:   eventId,
        user_id:    currentUser.id,
        status:     'accepted',
        dj_name:    artistProfile?.djName || artistProfile?.name || '',
        genre:      artistProfile?.genreString || '',
        mix_link:   artistProfile?.mixLink || '',
        avatar_url: artistProfile?.avatar || '',
        via_invite: true,
      }, { onConflict: 'event_id,user_id' });

      showToast('Invite accepted! You\'re on the lineup.', 'success');

      // Push a local notif for artist dashboard
      pushNotif('', `You accepted an event invite${eventId ? ' — check your gigs.' : '.'}`, 'artist');
    } else {
      showToast('Invite declined.', 'success');
    }

    updateNotifDot();
    renderNotifList();

    // Refresh artist gigs if on artist dash
    if (currentMode === 'artist' && response === 'accepted') {
      setTimeout(() => renderArtistDashGigsWithManual?.(), 800);
    }
  } catch(e) {
    console.warn('respondToInvite:', e);
    showToast(response === 'accepted' ? 'Accepted!' : 'Declined.', 'success');
    const n = _dbNotifs.find(n => n.id === notifId);
    if (n) { n.read = true; n.status = response; }
    updateNotifDot();
    renderNotifList();
  }
}

// ── Merge pending artist notifs (localStorage) ─────

function mergePendingArtistNotifs() {
  if (!currentUser?.id || currentUser.id === 'guest') return;
  try {
    const key = `yp_pending_notifs_${currentUser.id}`;
    const pending = JSON.parse(localStorage.getItem(key) || '[]');
    if (!pending.length) return;
    pending.forEach(n => {
      notifications.unshift({ ...n, mode: 'artist' });
    });
    localStorage.removeItem(key);
    localStorage.setItem('yp_notifs', JSON.stringify(notifications.slice(0, 50)));
    updateNotifDot();
    renderNotifList();
  } catch(e) {}
}

// ── Poll for new DB notifs every 60s when panel closed ──
function startNotifPolling() {
  if (_notifPolling) return;
  _notifPolling = setInterval(async () => {
    if (!currentUser?.id || currentUser.id === 'guest') return;
    const prev = _dbNotifs.filter(n => !n.read).length;
    await loadDbNotifs();
    const now  = _dbNotifs.filter(n => !n.read).length;
    if (now > prev) updateNotifDot();
  }, 60000);
}

// ── Load saved notifications on boot ──────────────
try {
  const saved = localStorage.getItem('yp_notifs');
  if (saved) {
    notifications = JSON.parse(saved);
    notifUnread = notifications.filter(n => !n.read).length;
    updateNotifDot();
    renderNotifList();
  }
} catch(e) {}
