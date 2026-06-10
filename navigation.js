// ═══════════════════════════════════════════════════
//  navigation.js — YesPleez Navigation Module
//  Depends on: state.js, auth.js, profiles.js, events.js
// ═══════════════════════════════════════════════════

// ── Navigation history stack ───────────────────────

const _navHistory = [];
const _noNavScreens = new Set(['authScreen', 'roleScreen']);

// Screen → human-readable title
const _screenTitles = {
  dashboardScreen:     'HOST DASHBOARD',
  artistDashScreen:    'ARTIST DASHBOARD',
  venueDashScreen:     'VENUE DASHBOARD',
  bandsDashScreen:     'BANDS & MUSOS',
  standupDashScreen:   'STAND UP / POETRY',
  standupProfileScreen:'ACT PROFILE',
  bandProfileScreen:   'BAND PROFILE',
  calendarScreen:      'CALENDAR',
  searchScreen:        'DISCOVER',
  profileScreen:       'MY PROFILE',
  artistProfileScreen: 'MY PROFILE',
  venueProfileScreen:  'VENUE PROFILE',
  hostProfileScreen:   'HOST PROFILE',
  setTimesScreen:      'SET TIMES',
  publicEventScreen:   'EVENT',
  publicProfileScreen: 'PROFILE',
};

// ── Core screen switcher ───────────────────────────

function show(id, opts = {}) {
  const prev = document.querySelector('.screen.active')?.id;

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');

  const lockScreens = ['authScreen'];
  const isLocked = lockScreens.includes(id);
  document.body.classList.toggle('auth-mode', isLocked);

  // Push to history (skip auth/role, skip if same screen, skip if going back)
  if (!isLocked && !opts._isBack && prev && prev !== id && !_noNavScreens.has(prev)) {
    _navHistory.push(prev);
    if (_navHistory.length > 30) _navHistory.shift();
  }
  if (opts._isBack) {
    // already popped by navBack()
  }

  // Update global nav bar
  _updateGlobalNav(id, isLocked);

  const banner = document.getElementById('trialBanner') || document.querySelector('.trial-banner');
  const bannerH = (banner && banner.offsetHeight) ? banner.offsetHeight : 0;
  document.querySelectorAll('.back-btn-sticky, .back-sticky, [id$="BackBtn"], .btn-back-sticky').forEach(el => {
    el.style.top = bannerH ? (bannerH + 'px') : '';
  });
}

function _updateGlobalNav(id, isLocked) {
  // Reserved for future nav chrome — btn-back buttons now handle navigation inline
}

function navBack() {
  if (!_navHistory.length) { showRoleSelector(); return; }
  const prev = _navHistory.pop();
  show(prev, { _isBack: true });
  _updateGlobalNav(prev, false);
}

// ── Toast notifications ────────────────────────────

function showToast(msg, type = 'success', duration = 3200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

// ── Role selector ──────────────────────────────────

async function showRoleSelector() {
  _navHistory.length = 0; // clear history at home
  if (!DEMO && currentUser?.id) {
    const [hostRow, artistRow] = await Promise.all([
      loadProfileFromSupabase('host'),
      loadProfileFromSupabase('artist')
    ]);
    if (hostRow && (hostRow.name || hostRow.dj_name)) hostProfile = mapDbToHostProfile(hostRow);
    if (artistRow && (artistRow.dj_name || artistRow.name)) artistProfile = mapDbToArtistProfile(artistRow);
  }
  updateRoleCards();
  show('roleScreen');
  setTimeout(() => { if (typeof flashPendingOffers === 'function') flashPendingOffers(); }, 800);
}

function updateRoleCards() {
  const hostCard   = document.querySelector('.role-card.host-card');
  const artistCard = document.querySelector('.role-card.artist-card');
  if (!hostCard || !artistCard) return;

  const hostDot   = hostProfile.name    ? ' <span style="color:var(--neon);font-size:11px;margin-left:4px;white-space:nowrap;">✓ Profile set up</span>' : '';
  const artistDot = artistProfile.djName ? ' <span style="color:var(--neon2);font-size:11px;margin-left:4px;white-space:nowrap;">✓ Profile set up</span>' : '';

  const hostDesc   = hostCard.querySelector('.role-card-desc');
  const artistDesc = artistCard.querySelector('.role-card-desc');
  if (hostDesc)   hostDesc.innerHTML   = 'Create events, build set times, manage your lineup, go live' + hostDot;
  if (artistDesc) artistDesc.innerHTML = 'Build your profile, track your bookings, apply to events' + artistDot;
}

function enterMode(mode) {
  currentMode = mode;
  try { localStorage.setItem('yp_last_mode', mode); } catch(e) {}
  if (mode === 'host') {
    enterDashboard();
  } else {
    enterArtistDashboard();
  }
}

function canToggleMode() {
  return !!(hostProfile.name && artistProfile.djName);
}

function tryToggleMode() {
  showRoleSelector();
}

function updateToggleVisibility(mode) {
  const can = canToggleMode();
  if (mode === 'host') {
    const el = document.getElementById('hostModeToggle');
    if (el) {
      el.style.opacity = '1';
      el.title = can ? 'Switch to Artist mode' : 'Create an artist profile to switch modes';
    }
  } else {
    const el = document.getElementById('artistModeToggle');
    if (el) {
      el.style.opacity = '1';
      el.title = can ? 'Switch to Host mode' : 'Create a host profile to switch modes';
    }
  }
}

// ── Host dashboard ─────────────────────────────────

async function enterDashboard() {
  isHost = false;
  hostProfile = {};
  const email = currentUser?.email || '';
  document.getElementById('dashUserEmail').textContent = email ? `${email}` : '';
  document.getElementById('shareLinkBtn').style.display = 'none';
  if (!DEMO && currentUser?.id) {
    const row = await loadProfileFromSupabase('host');
    if (row && (row.name || row.dj_name)) {
      hostProfile = mapDbToHostProfile(row);
      try { localStorage.setItem('yp_host_profile', JSON.stringify(hostProfile)); } catch(e) {}
    }
  }
  show('dashboardScreen');
  updateDashProfileCard();
  updateToggleVisibility('host');
  updateNotifDot();
  await loadUserEvents();
  if (!DEMO) loadPendingAppsBadge();
  if (typeof loadDbNotifs === 'function') loadDbNotifs();
  if (typeof startNotifPolling === 'function') startNotifPolling();
}

function switchDashTab(tab) {
  ['Events','Applications','Artists'].forEach(t => {
    const key = t.toLowerCase();
    const btn = document.getElementById('dashTab'+t);
    const content = document.getElementById('dashTab'+t+'Content');
    if (btn) { btn.style.borderBottomColor = tab===key ? 'var(--neon2)' : 'transparent'; btn.style.color = tab===key ? 'var(--text)' : 'var(--muted)'; }
    if (content) content.style.display = tab===key ? '' : 'none';
  });
  if (tab === 'applications') { _appsCache = null; loadAllApplications(); }
  if (tab === 'artists') Promise.all([loadAcceptedUnassignedArtists(), loadUnclaimedProfiles()]);
}

// ── Artist dashboard ───────────────────────────────

async function enterArtistDashboard() {
  artistProfile = {};
  const email = currentUser?.email || '';
  document.getElementById('artistDashUserEmail').textContent = email;
  if (!DEMO && currentUser?.id && currentUser.id !== 'guest') {
    const row = await loadProfileFromSupabase('artist');
    if (row && (row.dj_name || row.name)) {
      artistProfile = mapDbToArtistProfile(row);
      try { localStorage.setItem('yp_artist_profile', JSON.stringify(artistProfile)); } catch(e) {}
    }
  }
  updateArtistDashCard();
  renderArtistDashGigsWithManual();
  renderProfileNudge();
  loadMyApplications();
  mergePendingArtistNotifs();
  updateToggleVisibility('artist');
  show('artistDashScreen');
  updateNotifDot();
  checkForClaimableProfile();
  if (typeof loadMyAvailability === 'function') loadMyAvailability();
  if (typeof loadDbNotifs === 'function') loadDbNotifs();
  if (typeof startNotifPolling === 'function') startNotifPolling();
}

// ── Profile completeness nudge ─────────────────────

function renderProfileNudge() {
  const el = document.getElementById('profileNudge');
  if (!el) return;

  const p = artistProfile || {};
  const missing = [];

  if (!p.avatar)    missing.push({ label: 'Add a photo',    icon: '📸', action: "showProfile()" });
  if (!p.mixLink)   missing.push({ label: 'Link a mix',     icon: '▶',  action: "showProfile()" });
  if (!p.bio)       missing.push({ label: 'Write a bio',    icon: '✏️', action: "showProfile()" });
  if (!p.genreString) missing.push({ label: 'Set your genres', icon: '🎵', action: "showProfile()" });

  // Dismiss key — reset each time a new field is filled
  const dismissKey = `yp_nudge_dismissed_${(missing.map(m=>m.label).join(','))}`;
  try { if (localStorage.getItem(dismissKey)) { el.style.display = 'none'; return; } } catch(e) {}

  if (!missing.length) { el.style.display = 'none'; return; }

  // Completeness score
  const total = 4;
  const done  = total - missing.length;
  const pct   = Math.round((done / total) * 100);
  const color = pct >= 75 ? 'var(--neon2)' : pct >= 50 ? 'var(--gold)' : 'var(--neon)';

  el.style.display = '';
  el.innerHTML = `
    <div style="background:rgba(255,45,120,.06);border:1px solid rgba(255,45,120,.25);border-radius:14px;padding:14px 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:2px;color:var(--neon);">COMPLETE YOUR PROFILE</div>
        <button onclick="try{localStorage.setItem('${dismissKey}','1')}catch(e){}; document.getElementById('profileNudge').style.display='none';"
          style="background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;line-height:1;padding:0;">×</button>
      </div>
      <!-- Progress bar -->
      <div style="height:4px;background:rgba(255,255,255,.08);border-radius:2px;margin-bottom:12px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:2px;transition:width .4s;"></div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${done}/${total} complete · Promoters skip incomplete profiles</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${missing.map(m => `
          <button onclick="${m.action}"
            style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:var(--text);border-radius:20px;font-size:12px;padding:6px 14px;cursor:pointer;display:flex;align-items:center;gap:6px;">
            <span>${m.icon}</span><span>${m.label}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

// ── Navigation helpers ─────────────────────────────

function goBack() {
  if (_discoverOrigin === 'artist') {
    _discoverOrigin = null;
    showSearchScreen();
  } else if (_discoverOrigin === 'host') {
    _discoverOrigin = null;
    showSearchScreen();
  } else {
    if (currentMode === 'artist') enterArtistDashboard();
    else enterDashboard();
  }
}

function goToDash() {
  isReadOnly = false;
  if (isHost) enterDashboard();
  else if (currentMode === 'artist') enterArtistDashboard();
  else enterDashboard();
}

// ── Public link overlay ────────────────────────────

function showPubLink() {
  if (!currentEventId) return;
  const url = `${location.origin}${location.pathname}?event=${currentEventId}`;
  document.getElementById('pubLinkUrl').textContent = url;
  document.getElementById('pubLinkOverlay').classList.add('open');
}

function closePubLinkOverlay() {
  document.getElementById('pubLinkOverlay').classList.remove('open');
}

function copyPubLink() {
  const url = document.getElementById('pubLinkUrl').textContent;
  navigator.clipboard.writeText(url).then(() => showToast('Link copied!', 'success'));
}

// ── Universal share ────────────────────────────────

function shareItem(type, id, name) {
  const base = location.origin + location.pathname;
  const url  = type === 'calendar'
    ? `${base}?view=calendar`
    : type === 'event'
      ? `${base}?event=${id}`
      : `${base}?profile=${id}&ptype=${encodeURIComponent(type)}`;

  const titles = { event:'Check out this event on YesPleez', artist:'Check out this artist on YesPleez', band:'Check out this band on YesPleez', standup:'Check out this act on YesPleez', host:'Check out this promoter on YesPleez', venue:'Check out this venue on YesPleez', calendar:'See what\'s on near you — YesPleez' };
  const text = name ? `${name} — YesPleez` : (titles[type] || 'Check this out on YesPleez');

  if (navigator.share) {
    navigator.share({ title: 'YesPleez', text, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url)
      .then(() => showToast('Link copied!', 'success'))
      .catch(() => { prompt('Copy this link:', url); });
  }
}

// ── Search screen ──────────────────────────────────

let _searchDebounce = null;
let _discoverOrigin = null;

async function showCalendar() {
  _calViewMonth = new Date();
  _calSelDate   = null;
  show('calendarScreen');
  if (currentMode) updateToggleVisibility(currentMode);
  renderCalHeader();
  document.getElementById('calContent').innerHTML = '<div style="text-align:center;padding:60px 0;color:var(--muted);font-family:\'Bebas Neue\',sans-serif;letter-spacing:2px;font-size:16px;">LOADING...</div>';
  await loadCalEvents();
  renderCalHeader();
  calRestorePostcode();
  renderCalContent();
}

function showSearchScreen() {
  _discoverOrigin = currentMode || null;
  show('searchScreen');
  document.getElementById('searchInput').focus();
  runSearch();
}

function debounceSearch() {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(runSearch, 350);
}
