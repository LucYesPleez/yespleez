// ═══════════════════════════════════════════════════
//  notifications.js — YesPleez Notifications Module
//  Depends on: state.js, auth.js (sbRest, sbFetch), navigation.js (showToast)
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

// ── Write a DB notification to another user ────────

async function writeDbNotif(userId, type, message, extras = {}) {
  if (!userId || !currentSession?.access_token) return;
  try {
    await sbRest('notifications', {
      method: 'POST',
      body: JSON.stringify({
        user_id:    userId,
        type,
        message,
        read:       false,
        status:     'pending',
        ...extras
      }),
      prefer: 'return=minimal'
    }, currentSession.access_token);
  } catch(e) {
    console.warn('writeDbNotif failed:', e);
  }
}

// ── Dot indicator ──────────────────────────────────

function updateNotifDot() {
  const mode = currentMode || 'both';
  const localUnread  = notifications.filter(n => !n.read && (!n.mode || n.mode === 'both' || n.mode === mode)).length;
  const dbUnread     = _dbNotifs.filter(n => !n.read).length;
  const totalUnread  = localUnread + dbUnread;
  const active       = totalUnread > 0;
  ['notifDotHost','notifDotArtist','notifDotVenue','notifDotBands','notifDotStandup','notifDotManage','notifDotGlobal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', active);
  });
  // Update nav bar badge
  if (typeof updateNavNotifBadge === 'function') updateNavNotifBadge(totalUnread);
}

// ── Load from Supabase ─────────────────────────────

async function loadDbNotifs() {
  if (DEMO || !currentUser?.id || currentUser.id === 'guest' || !currentSession?.access_token) return;
  try {
    const rows = await sbRest(
      `notifications?user_id=eq.${currentUser.id}&order=created_at.desc&limit=50`,
      { method: 'GET' }, currentSession.access_token
    );
    _dbNotifs = Array.isArray(rows) ? rows : [];
    updateNotifDot();
    renderNotifList();
  } catch(e) {
    _dbNotifs = [];
  }
}

async function markDbNotifRead(notifId) {
  if (!currentSession?.access_token) return;
  try {
    await sbRest(
      `notifications?id=eq.${notifId}`,
      { method: 'PATCH', body: JSON.stringify({ read: true }), prefer: 'return=minimal' },
      currentSession.access_token
    );
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
  // Reset to preview mode for next open
  _notifShowAll = false;
  const panel = document.getElementById('notifPanel');
  if (panel) panel.style.maxHeight = '';
}

function markAllRead() {
  notifications.forEach(n => n.read = true);
  notifUnread = 0;
  const unreadIds = _dbNotifs.filter(n => !n.read).map(n => n.id);
  _dbNotifs.forEach(n => n.read = true);
  updateNotifDot();
  renderNotifList();
  if (unreadIds.length && currentSession?.access_token) {
    unreadIds.forEach(id => {
      sbRest(`notifications?id=eq.${id}`,
        { method: 'PATCH', body: JSON.stringify({ read: true }), prefer: 'return=minimal' },
        currentSession.access_token
      ).catch(() => {});
    });
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

let _notifShowAll = false;
const NOTIF_PREVIEW_COUNT = 6;

function showAllNotifs() {
  _notifShowAll = true;
  renderNotifList();
  // Allow scroll when expanded
  const panel = document.getElementById('notifPanel');
  if (panel) panel.style.maxHeight = '90dvh';
}

function renderNotifList() {
  const el = document.getElementById('notifList');
  if (!el) return;
  const mode = currentMode || 'both';
  const localFiltered = notifications.filter(n => !n.mode || n.mode === 'both' || n.mode === mode);

  // Merge DB + local into a single time-sorted list for rendering
  const dbItems = (_dbNotifs || []).map(n => ({ ...n, _src: 'db' }));
  const localItems = localFiltered.map(n => ({ ...n, _src: 'local' }));

  // Sort: DB by created_at desc, local by time desc — interleave newest first
  const allItems = [...dbItems, ...localItems].sort((a, b) => {
    const ta = a._src === 'db' ? new Date(a.created_at).getTime() : a.time;
    const tb = b._src === 'db' ? new Date(b.created_at).getTime() : b.time;
    return tb - ta;
  });

  const total   = allItems.length;
  const visible = _notifShowAll ? allItems : allItems.slice(0, NOTIF_PREVIEW_COUNT);

  let html = '';
  visible.forEach(n => {
    if (n._src === 'db') {
      if (n.type === 'slot_offer')   { html += renderSlotOfferNotif(n); return; }
      if (n.type === 'event_invite') { html += renderInviteNotif(n);    return; }
      html += `
        <div class="notif-item${n.read ? '' : ' unread'}" onclick="markDbNotifRead('${n.id}')">
          <div><span class="notif-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7v4l-2 2v1h18v-1l-2-2V9a7 7 0 0 0-7-7zm0 20a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2z"/></svg>
          </span><span class="notif-text">${esc(n.message || '')}</span></div>
          <div class="notif-time">${timeAgo(n.created_at)}</div>
        </div>`;
    } else {
      html += `
        <div class="notif-item${n.read ? '' : ' unread'}">
          <div><span class="notif-icon">${n.icon || ''}</span><span class="notif-text">${n.text}</span></div>
          <div class="notif-time">${timeAgo(n.time)}</div>
        </div>`;
    }
  });

  if (!html) html = '<div class="notif-empty">No notifications yet</div>';
  el.innerHTML = html;

  // Show/hide "see more" button
  const seeMore = document.getElementById('notifSeeMore');
  if (seeMore) seeMore.style.display = (!_notifShowAll && total > NOTIF_PREVIEW_COUNT) ? 'block' : 'none';
}

// ── Slot offer notification (specific slot) ────────

function renderSlotOfferNotif(n) {
  const isActioned = n.status === 'accepted' || n.status === 'declined';
  const statusBadge = n.status === 'accepted'
    ? `<span style="font-size:11px;color:var(--neon2);letter-spacing:1px;font-family:'Bebas Neue',sans-serif;">ACCEPTED ✓</span>`
    : n.status === 'declined'
    ? `<span style="font-size:11px;color:var(--muted);letter-spacing:1px;font-family:'Bebas Neue',sans-serif;">DECLINED</span>`
    : '';

  return `
    <div class="notif-item${n.read ? '' : ' unread'}" id="notifRow_${n.id}" style="display:block;padding:14px 16px;">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:${isActioned ? '0' : '12px'};">
        <div style="width:36px;height:36px;border-radius:8px;background:rgba(0,229,255,.12);border:1px solid rgba(0,229,255,.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--neon2);"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg></div>
        <div style="flex:1;min-width:0;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1px;color:var(--neon2);margin-bottom:3px;">SLOT OFFER</div>
          <div style="font-size:13px;color:var(--text);line-height:1.4;">${esc(n.message || '')}</div>
          ${n.slot_label ? `<div style="font-size:11px;color:var(--neon2);margin-top:4px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">🕐 ${esc(n.slot_label)}</div>` : ''}
          <div style="font-size:11px;color:var(--muted);margin-top:4px;">${timeAgo(n.created_at)}</div>
        </div>
        ${statusBadge ? `<div style="flex-shrink:0;">${statusBadge}</div>` : ''}
      </div>
      ${!isActioned ? `
        <div style="display:flex;gap:8px;">
          <button onclick="respondToSlotOffer('${n.id}','${n.event_id||''}','${n.slot_id||''}','accepted')"
            style="flex:1;background:var(--neon2);color:#0a0a0f;border:none;border-radius:8px;font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1.5px;padding:10px;cursor:pointer;">
            ACCEPT SLOT
          </button>
          <button onclick="respondToSlotOffer('${n.id}','${n.event_id||''}','${n.slot_id||''}','declined')"
            style="flex:1;background:var(--card);color:var(--muted);border:1px solid var(--border);border-radius:8px;font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1.5px;padding:10px;cursor:pointer;">
            DECLINE
          </button>
        </div>` : ''}
    </div>`;
}

// ── Respond to slot offer ──────────────────────────

async function respondToSlotOffer(notifId, eventId, slotId, response) {
  const row = document.querySelector(`#notifRow_${notifId}`);
  if (row) row.querySelectorAll('button').forEach(b => b.disabled = true);

  try {
    // Update notification status
    await sbRest(
      `notifications?id=eq.${notifId}`,
      { method: 'PATCH', body: JSON.stringify({ read: true, status: response }), prefer: 'return=minimal' },
      currentSession.access_token
    );

    const n = _dbNotifs.find(n => n.id === notifId);
    if (n) { n.read = true; n.status = response; }

    if (response === 'accepted' && slotId && eventId) {
      // Load the event data if not already loaded, then claim the slot
      const artistName = artistProfile?.djName || artistProfile?.name || currentUser?.email || 'Artist';
      const genre = artistProfile?.genreString || '';
      const cardPills = artistProfile?.cardPills || '';
      const sound = artistProfile?.sound || '';

      // Need the event to be loaded — upsert the claim directly
      const claimBody = JSON.stringify({
        event_id:   eventId,
        slot_id:    slotId,
        name:       artistName,
        genre,
        notes:      '',
        backups:    [],
        card_pills: cardPills,
        sound,
        user_id:    currentUser.id,
        updated_at: new Date().toISOString()
      });
      await sbRest('claims', {
        method: 'POST',
        body: claimBody,
        prefer: 'resolution=merge-duplicates,return=minimal'
      }, currentSession.access_token);

      // Update slot_offers status
      await sbRest(
        `slot_offers?slot_id=eq.${slotId}&event_id=eq.${eventId}&offered_to_uid=eq.${currentUser.id}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'accepted' }), prefer: 'return=minimal' },
        currentSession.access_token
      ).catch(() => {});

      // Notify the host
      if (n?.from_uid) {
        await writeDbNotif(n.from_uid, 'offer_accepted', `✅ ${artistName} accepted your slot offer for ${n.slot_label || 'a slot'} at ${n.event_name || 'your event'}.`, {
          event_id: eventId,
          slot_id: slotId,
          slot_label: n.slot_label || '',
          event_name: n.event_name || ''
        });
      }

      showToast(`🎉 Slot accepted! You're in the lineup.`, 'success', 5000);
      pushNotif('🎧', `You accepted the ${n?.slot_label || 'slot'} offer — you're in the lineup!`, 'artist');

      // Refresh artist gigs
      setTimeout(() => { if (typeof renderArtistDashGigsWithManual === 'function') renderArtistDashGigsWithManual(); }, 800);

    } else if (response === 'declined') {
      // Update slot_offers status
      if (slotId && eventId) {
        await sbRest(
          `slot_offers?slot_id=eq.${slotId}&event_id=eq.${eventId}`,
          { method: 'PATCH', body: JSON.stringify({ status: 'declined' }), prefer: 'return=minimal' },
          currentSession.access_token
        ).catch(() => {});
      }
      // Notify the host
      const artistName = artistProfile?.djName || artistProfile?.name || 'An artist';
      if (n?.from_uid) {
        await writeDbNotif(n.from_uid, 'offer_declined', `❌ ${artistName} declined your slot offer for ${n?.slot_label || 'a slot'}.`, {
          event_id: eventId,
          slot_id: slotId
        });
      }
      showToast('Offer declined.', 'success');
    }

  } catch(e) {
    console.warn('respondToSlotOffer:', e);
    showToast(response === 'accepted' ? 'Slot accepted!' : 'Declined.', 'success');
    const n = _dbNotifs.find(n => n.id === notifId);
    if (n) { n.read = true; n.status = response; }
  }

  updateNotifDot();
  renderNotifList();
}

// ── Event invite notification (no specific slot) ───

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

// ── Respond to event invite ────────────────────────

async function respondToInvite(notifId, eventId, response) {
  const row = document.querySelector(`#notifRow_${notifId}`);
  if (row) row.querySelectorAll('button').forEach(b => b.disabled = true);

  try {
    await sbRest(
      `notifications?id=eq.${notifId}`,
      { method: 'PATCH', body: JSON.stringify({ read: true, status: response }), prefer: 'return=minimal' },
      currentSession.access_token
    );

    const n = _dbNotifs.find(n => n.id === notifId);
    if (n) { n.read = true; n.status = response; }

    const artistName = artistProfile?.djName || artistProfile?.name || currentUser?.email || 'Artist';

    if (response === 'accepted' && eventId) {
      // Create application record
      await sbRest('applications', {
        method: 'POST',
        body: JSON.stringify({
          event_id:   eventId,
          user_id:    currentUser.id,
          status:     'pending',
          artist_name: artistName,
          dj_name:    artistProfile?.djName || '',
          genre:      artistProfile?.genreString || '',
          mix_link:   artistProfile?.mixLink || '',
          avatar_url: artistProfile?.avatar || '',
          via_invite: true
        }),
        prefer: 'resolution=merge-duplicates,return=minimal'
      }, currentSession.access_token);

      // Notify host
      if (n?.from_uid) {
        await writeDbNotif(n.from_uid, 'offer_accepted', `✅ ${artistName} accepted your event invite for ${n.event_name || 'your event'} — they're now in your applications.`, {
          event_id: eventId,
          event_name: n.event_name || ''
        });
      }

      showToast(`Invite accepted! You're in the applications list.`, 'success');
      pushNotif('🎤', `You accepted an invite to ${n?.event_name || 'an event'} — check your gigs.`, 'artist');
      setTimeout(() => { if (typeof renderArtistDashGigsWithManual === 'function') renderArtistDashGigsWithManual(); }, 800);

    } else {
      if (n?.from_uid) {
        await writeDbNotif(n.from_uid, 'offer_declined', `❌ ${artistName} declined your event invite for ${n?.event_name || 'your event'}.`, { event_id: eventId });
      }
      showToast('Invite declined.', 'success');
    }

  } catch(e) {
    console.warn('respondToInvite:', e);
    showToast(response === 'accepted' ? 'Accepted!' : 'Declined.', 'success');
    const n = _dbNotifs.find(n => n.id === notifId);
    if (n) { n.read = true; n.status = response; }
  }

  updateNotifDot();
  renderNotifList();
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

// ── Poll for new DB notifs every 30s ───────────────

function startNotifPolling() {
  if (_notifPolling) return;
  _notifPolling = setInterval(async () => {
    if (!currentUser?.id || currentUser.id === 'guest' || !currentSession?.access_token) return;
    const prev = _dbNotifs.filter(n => !n.read).length;
    await loadDbNotifs();
    const now  = _dbNotifs.filter(n => !n.read).length;
    if (now > prev) {
      updateNotifDot();
      showToast('🔔 You have new notifications', 'success');
    }
  }, 30000);
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
