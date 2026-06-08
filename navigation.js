// ═══════════════════════════════════════════════════
//  navigation.js — YesPleez Navigation Module
//  Depends on: state.js, auth.js, profiles.js, events.js
// ═══════════════════════════════════════════════════

// ── Core screen switcher ───────────────────────────

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const lockScreens = ['authScreen', 'roleScreen'];
  document.body.classList.toggle('auth-mode', lockScreens.includes(id));
  const banner = document.getElementById('trialBanner') || document.querySelector('.trial-banner');
  const bannerH = (banner && banner.offsetHeight) ? banner.offsetHeight : 0;
  document.querySelectorAll('.back-btn-sticky, .back-sticky, [id$="BackBtn"], .btn-back-sticky').forEach(el => {
    el.style.top = bannerH ? (bannerH + 'px') : '';
  });
}

// ── Toast notifications ────────────────────────────

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ── Role selector ──────────────────────────────────

async function showRoleSelector() {
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
}

function updateRoleCards() {
  const hostCard   = document.querySelector('.role-card.host-card');
  const artistCard = document.querySelector('.role-card.artist-card');
  if (!hostCard || !artistCard) return;

  const hostDot   = hostProfile.name    ? ' <span style="color:var(--neon);font-size:11px;margin-left:4px;">✓ Profile set up</span>' : '';
  const artistDot = artistProfile.djName ? ' <span style="color:var(--neon2);font-size:11px;margin-left:4px;">✓ Profile set up</span>' : '';

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
      el.style.opacity = can ? '1' : '0.35';
      el.title = can ? 'Switch to Artist mode' : 'Create an artist profile to switch modes';
    }
  } else {
    const el = document.getElementById('artistModeToggle');
    if (el) {
      el.style.opacity = can ? '1' : '0.35';
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
}

function switchDashTab(tab) {
  ['Events','Applications','Artists'].forEach(t => {
    const key = t.toLowerCase();
    const btn = document.getElementById('dashTab'+t);
    const content = document.getElementById('dashTab'+t+'Content');
    if (btn) { btn.style.borderBottomColor = tab===key ? 'var(--neon2)' : 'transparent'; btn.style.color = tab===key ? 'var(--text)' : 'var(--muted)'; }
    if (content) content.style.display = tab===key ? '' : 'none';
  });
  if (tab === 'applications') loadAllApplications();
  if (tab === 'artists') { loadAcceptedUnassignedArtists(); loadUnclaimedProfiles(); }
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
  loadMyApplications();
  mergePendingArtistNotifs();
  updateToggleVisibility('artist');
  show('artistDashScreen');
  updateNotifDot();
  checkForClaimableProfile();
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

// ── Search screen ──────────────────────────────────

let _searchDebounce = null;
let _discoverOrigin = null;

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
