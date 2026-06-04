// ═══════════════════════════════════════════════════
//  notifications.js — YesPleez Notifications Module
//  Depends on: state.js, navigation.js (showToast)
// ═══════════════════════════════════════════════════

let notifications = [];
let notifUnread   = 0;

// ── Core push ──────────────────────────────────────

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
  const unreadCount = notifications.filter(n => !n.read && (!n.mode || n.mode === 'both' || n.mode === mode)).length;
  const active = unreadCount > 0;
  ['notifDotHost','notifDotArtist'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', active);
  });
}

// ── Panel ──────────────────────────────────────────

function openNotifPanel() {
  renderNotifList();
  document.getElementById('notifPanel').classList.add('open');
  document.getElementById('notifBackdrop').style.display = '';
}

function closeNotifPanel() {
  document.getElementById('notifPanel').classList.remove('open');
  document.getElementById('notifBackdrop').style.display = 'none';
}

function markAllRead() {
  notifications.forEach(n => n.read = true);
  notifUnread = 0;
  updateNotifDot();
  renderNotifList();
}

// ── Render ─────────────────────────────────────────

function timeAgo(ts) {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return Math.floor(secs/60) + 'm ago';
  if (secs < 86400) return Math.floor(secs/3600) + 'h ago';
  return Math.floor(secs/86400) + 'd ago';
}

function renderNotifList() {
  const el = document.getElementById('notifList');
  if (!el) return;
  const mode = currentMode || 'both';
  const filtered = notifications.filter(n => !n.mode || n.mode === 'both' || n.mode === mode);
  if (!filtered.length) {
    el.innerHTML = '<div class="notif-empty">No notifications yet</div>';
    return;
  }
  el.innerHTML = filtered.map(n => `
    <div class="notif-item${n.read ? '' : ' unread'}">
      <div><span class="notif-icon">${n.icon}</span><span class="notif-text">${n.text}</span></div>
      <div class="notif-time">${timeAgo(n.time)}</div>
    </div>
  `).join('');
}

// ── Merge pending artist notifs ────────────────────

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