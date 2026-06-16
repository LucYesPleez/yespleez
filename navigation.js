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
  calendarScreen:      "WHATS HAPPENIN'",
  searchScreen:        'DISCOVER',
  profileScreen:       'MY PROFILE',
  artistProfileScreen: 'MY PROFILE',
  venueProfileScreen:  'VENUE PROFILE',
  hostProfileScreen:   'HOST PROFILE',
  punterDashScreen:    'MY SCENE',
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

// Screens that suppress the nav (auth / onboarding only)
const _noNavScreens2 = new Set(['authScreen']);

function _updateGlobalBackBtn() {
  const btn = document.getElementById('globalBackBtn');
  if (!btn) return;
  btn.classList.toggle('can-go-back', _navHistory.length > 0);
}

function _updateGlobalNav(id, isLocked) {
  const nav    = document.getElementById('bottomNav');
  const header = document.getElementById('globalPageHeader');
  if (!nav) return;
  const _noHeaderScreens = new Set(['authScreen', 'roleScreen']);
  if (isLocked || _noNavScreens2.has(id)) {
    nav.style.display = 'none';
    if (header) header.style.display = 'none';
    return;
  }
  nav.style.display = 'block';
  if (header) {
    if (_noHeaderScreens.has(id)) {
      header.style.display = 'none';
    } else {
      header.style.display = 'flex';
      _updateGlobalBackBtn();
    }
  }
  const el = (id) => document.getElementById(id);
  if (el('globalInfoBtn'))       el('globalInfoBtn').style.display       = id === 'publicProfileScreen' ? 'none' : '';
  if (el('globalNotifBtn'))      el('globalNotifBtn').style.display      = id === 'calendarScreen'  ? '' : 'none';
  if (el('globalShareCal'))      el('globalShareCal').style.display      = id === 'calendarScreen'  ? '' : 'none';
  if (el('globalShareDiscover')) el('globalShareDiscover').style.display = id === 'searchScreen'    ? '' : 'none';
  if (el('globalShareManage'))   el('globalShareManage').style.display   = id === 'manageScreen'    ? '' : 'none';
  // Show/hide the My Scene FAB
  const fab = document.getElementById('mySceneFab');
  if (fab) fab.style.display = id === 'punterDashScreen' ? '' : 'none';
  // Highlight the matching tab; panels (notif/industry) handled separately
  const calScreens      = new Set(['calendarScreen']);
  const discoverScreens = new Set(['searchScreen']);
  const msgScreens      = new Set(['messagesScreen']);
  const myScreens       = new Set(['punterDashScreen','dashboardScreen','artistDashScreen']);
  document.getElementById('bnTabScene')?.classList.toggle('bn-active', myScreens.has(id));
  document.getElementById('bnTabWhatson')?.classList.toggle('bn-active', calScreens.has(id));
  document.getElementById('bnTabDiscover')?.classList.toggle('bn-active', discoverScreens.has(id));
  document.getElementById('bnTabMessages')?.classList.toggle('bn-active', msgScreens.has(id));
  document.getElementById('bnTabNotif')?.classList.remove('bn-active');
  document.getElementById('bnTabIndustry')?.classList.remove('bn-active');
}

// Update notification badge count on nav bar
function updateNavNotifBadge(count) {
  const badge = document.getElementById('bnNotifBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// Messages panel placeholder
function openMessagesPanel() {
  showToast('Messages coming soon', 'success');
}

// ── Industry Panel ─────────────────────────────────

async function openIndustryPanel() {
  const overlay = document.getElementById('industryPanelOverlay');
  const panel   = document.getElementById('industryPanel');
  if (!overlay || !panel) return;
  overlay.style.display = 'block';
  panel.style.display   = 'block';
  document.getElementById('bnTabIndustry')?.classList.add('bn-active');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { panel.classList.add('ip-open'); });
  });

  // Load any profiles not yet in memory
  if (!DEMO && currentUser?.id && currentSession?.access_token) {
    try {
      const rows = await sbRest(
        `profiles?user_id=eq.${currentUser.id}&select=type,name,dj_name`,
        { method: 'GET' }, currentSession.access_token
      );
      if (Array.isArray(rows)) {
        rows.forEach(r => {
          if (r.type === 'host'    && (r.name || r.dj_name) && !hostProfile?.name)    hostProfile    = { name: r.name || r.dj_name };
          if (r.type === 'artist'  && (r.dj_name || r.name) && !artistProfile?.djName) artistProfile  = { djName: r.dj_name || r.name };
          if (r.type === 'band'    && (r.name || r.dj_name) && !bandProfile?.name)    bandProfile    = { name: r.name || r.dj_name };
          if (r.type === 'venue'   && (r.name || r.dj_name) && !venueProfile?.name)   venueProfile   = { name: r.name || r.dj_name };
          if (r.type === 'standup' && (r.name || r.dj_name) && !standupProfile?.name) standupProfile = { name: r.name || r.dj_name };
        });
      }
    } catch(e) {}
  }

  _updateIndustryPanelBadges();
}

function closeIndustryPanel() {
  const overlay = document.getElementById('industryPanelOverlay');
  const panel   = document.getElementById('industryPanel');
  if (!overlay || !panel) return;
  panel.classList.remove('ip-open');
  overlay.style.display = 'none';
  document.getElementById('bnTabIndustry')?.classList.remove('bn-active');
  setTimeout(() => { panel.style.display = 'none'; }, 300);
}

function _updateIndustryPanelBadges() {
  const profiles = {
    Host:    !!(hostProfile?.name),
    Artist:  !!(artistProfile?.djName),
    Band:    !!(bandProfile?.name),
    Venue:   !!(venueProfile?.name),
    Standup: !!(standupProfile?.name)
  };
  Object.entries(profiles).forEach(([role, hasProfile]) => {
    const card  = document.getElementById('ipCard' + role);
    const badge = document.getElementById('ipBadge' + role);
    if (card)  card.style.display  = hasProfile ? '' : 'none';
    if (badge) badge.style.display = hasProfile ? '' : 'none';
  });
}

function enterIndustryRole(role) {
  closeIndustryPanel();
  setTimeout(() => {
    if      (role === 'host')    enterMode('host');
    else if (role === 'artist')  enterMode('artist');
    else if (role === 'band')    enterBandsDashboard();
    else if (role === 'venue')   enterVenueDashboard();
    else if (role === 'standup') enterStandupDashboard();
    else if (role === 'punter')  enterPunterDashboard();
  }, 200);
}

function navBack() {
  if (!_navHistory.length) { showCalendar(); return; }
  const prev = _navHistory.pop();
  show(prev, { _isBack: true });
  _updateGlobalNav(prev, false);
  _updateGlobalBackBtn();
}

// ── Toast notifications ────────────────────────────

function showToast(msg, type = 'success', duration = 3200, undoLabel, undoCb) {
  const t = document.getElementById('toast');
  clearTimeout(t._timer);
  if (undoLabel && undoCb) {
    t.innerHTML = `<span>${msg}</span><button onclick="this.closest('#toast')._undoCb && this.closest('#toast')._undoCb()" style="margin-left:12px;background:none;border:1px solid rgba(255,255,255,.4);border-radius:6px;color:#fff;font-family:'Bebas Neue',sans-serif;font-size:12px;letter-spacing:1px;padding:2px 10px;cursor:pointer;">${undoLabel}</button>`;
    t._undoCb = () => { undoCb(); t.classList.remove('show'); };
  } else {
    t.textContent = msg;
    t._undoCb = null;
  }
  t.className = `toast ${type} show`;
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

// ── Role new-profile badges ────────────────────────

function _applyRoleNewBadges() {
  const hasProfile = {
    host:    !!(hostProfile?.name),
    artist:  !!(artistProfile?.djName),
    band:    !!(bandProfile?.name),
    venue:   !!(venueProfile?.name),
    standup: !!(standupProfile?.name)
  };
  ['host','artist','band','venue','standup'].forEach(role => {
    const badge = document.getElementById('roleNewBadge-' + role);
    if (badge) badge.style.display = hasProfile[role] ? 'none' : '';
  });
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
  _updateRoleScreenHeading();
  _applyRoleNewBadges();
  show('roleScreen');
  setTimeout(() => { if (typeof flashPendingOffers === 'function') flashPendingOffers(); }, 800);
}

function _updateRoleScreenHeading() {
  const count  = parseInt(localStorage.getItem('yp_role_views') || '0');
  const title  = document.getElementById('roleTitle');
  const sub    = document.getElementById('roleSub');
  const pips   = document.getElementById('roleOnboardingPips');

  // First 3 views = onboarding mode (count has already been incremented in doLogin before this runs)
  const onboarding = count > 0 && count <= 3;

  if (title) title.innerHTML = onboarding ? 'HOW ARE YOU<br>USING YESPLEEZ?' : 'THE SCENE<br>IN YOUR HANDS';
  if (sub)   sub.textContent  = onboarding ? 'Pick your role — you can switch anytime' : 'Switch between modes anytime';

  if (pips) {
    pips.style.display = onboarding ? 'flex' : 'none';
    [1, 2, 3].forEach(n => {
      const pip = document.getElementById(`rolePip${n}`);
      if (pip) pip.style.background = n <= count ? 'var(--neon2)' : 'var(--border)';
    });
  }
}

function updateRoleCards() {
  const hostCard   = document.querySelector('.role-card.host-card');
  const artistCard = document.querySelector('.role-card.artist-card');
  const punterCard = document.querySelector('.role-card.punter-card');

  const hostDot   = hostProfile.name     ? ' <span style="color:var(--neon);font-size:11px;margin-left:4px;white-space:nowrap;">✓ Profile set up</span>' : '';
  const artistDot = artistProfile.djName  ? ' <span style="color:var(--neon2);font-size:11px;margin-left:4px;white-space:nowrap;">✓ Profile set up</span>' : '';
  const punterDot = (window._punterProfile?.name) ? ' <span style="color:#BF5FFF;font-size:11px;margin-left:4px;white-space:nowrap;">✓ Profile set up</span>' : '';

  if (hostCard)   { const d = hostCard.querySelector('.role-card-desc');   if (d) d.innerHTML = 'Create events, build set times, manage your lineup, go live' + hostDot; }
  if (artistCard) { const d = artistCard.querySelector('.role-card-desc'); if (d) d.innerHTML = 'Build your profile, track your bookings, apply to events' + artistDot; }
  if (punterCard) { const d = punterCard.querySelector('.role-card-desc'); if (d) d.innerHTML = 'Follow artists, save events, get notified when your faves play' + punterDot; }

  const venueTick   = (venueProfile?.name || venueProfile?.dj_name) ? ' <span style="color:#00E5A0;font-size:11px;white-space:nowrap;">✓ Profile set up</span>' : '';
  const bandTick    = (typeof bandProfile !== 'undefined' && bandProfile?.name) ? ' <span style="color:#FF8C42;font-size:11px;white-space:nowrap;">✓ Profile set up</span>' : '';
  const standupTick = (typeof standupProfile !== 'undefined' && standupProfile?.name) ? ' <span style="color:#FF88AA;font-size:11px;white-space:nowrap;">✓ Profile set up</span>' : '';

  const vEl = document.getElementById('venueRoleDesc');
  const bEl = document.getElementById('bandRoleDesc');
  const sEl = document.getElementById('standupRoleDesc');
  if (vEl) vEl.innerHTML = 'List your venue, set availability, get found by promoters and artists' + venueTick;
  if (bEl) bEl.innerHTML = 'List your band, find gigs, connect with venues and promoters' + bandTick;
  if (sEl) sEl.innerHTML = 'Book gigs, share your sets, connect with comedy clubs and spoken word nights' + standupTick;
}

function enterMode(mode) {
  currentMode = mode;
  try { localStorage.setItem('yp_last_mode', mode); } catch(e) {}
  if      (mode === 'host')   enterDashboard();
  else if (mode === 'punter') enterPunterDashboard();
  else                        enterArtistDashboard();
}

async function enterPunterDashboard() {
  currentMode = 'punter';
  try { localStorage.setItem('yp_last_mode', 'punter'); } catch(e) {}
  // Track last visit time for Following notification dots
  window._mySceneLastVisited = localStorage.getItem('yp_myscene_last_visited') || new Date(0).toISOString();
  try { localStorage.setItem('yp_myscene_last_visited', new Date().toISOString()); } catch(e) {}
  const email = currentUser?.email || '';
  const emailEl = document.getElementById('punterDashUserEmail');
  if (emailEl) emailEl.textContent = email;

  // Load punter profile if exists
  if (!DEMO && currentUser?.id) {
    try {
      const rows = await sbRest(
        `profiles?user_id=eq.${currentUser.id}&type=eq.punter&limit=1`,
        { method: 'GET' }, currentSession?.access_token
      );
      if (rows && rows.length) {
        const p = rows[0];
        window._punterProfile = p;
        updateRoleCards();
        const nameEl = document.getElementById('punterDashName');
        const locEl  = document.getElementById('punterDashLocation');
        const ctaEl  = document.getElementById('punterDashCta');
        if (nameEl) nameEl.textContent = p.name || p.dj_name || 'My Profile';
        if (locEl)  locEl.textContent  = p.location ? `${p.location}${p.state ? ', '+p.state : ''}` : (p.genre_string || 'Music fan');
        if (ctaEl)  ctaEl.textContent  = 'EDIT →';
      }
    } catch(e) {}
  }

  show('punterDashScreen');

  // Reset day view state so feed shows on entry
  _punterSelDate = null;
  const _feed    = document.getElementById('punterFeedContent');
  const _dayView = document.getElementById('punterDayContent');
  if (_feed)    _feed.style.display    = '';
  if (_dayView) { _dayView.style.display = 'none'; _dayView.innerHTML = ''; }

  if (_feed) _feed.innerHTML = '<div style="text-align:center;padding:60px 0;color:var(--muted);font-family:\'Bebas Neue\',sans-serif;letter-spacing:2px;font-size:16px;" class="loading-text">LOADING...</div>';

  // Load events and follows in parallel — follows calls renderPunterFeed when done,
  // then Promise.all calls it again once both are complete (idempotent, safe).
  const _calP = typeof loadCalEvents === 'function' ? loadCalEvents() : Promise.resolve();
  const _folP = typeof loadFollows   === 'function' ? loadFollows()   : Promise.resolve();
  Promise.all([_calP, _folP]).then(() => {
    if (typeof renderPunterFeed === 'function') renderPunterFeed();
  });

  if (typeof loadDbNotifs === 'function') loadDbNotifs();
  if (typeof startNotifPolling === 'function') startNotifPolling();
}

const _mySceneGenres = ['Techno','House','Drum & Bass','Breaks','Psytrance','Hip Hop','R&B','Reggae','Jazz','Soul','Folk','Pop','Rock','Metal','Indie','Electronic','Ambient','Comedy','Spoken Word','Open Mic'];

function showPunterProfile() {
  // Populate genre chips
  const wrap = document.getElementById('mySceneGenreChips');
  if (wrap && !wrap.children.length) {
    _mySceneGenres.forEach(g => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = g;
      chip.style.cssText = 'background:rgba(191,95,255,.08);border:1px solid rgba(191,95,255,.25);color:var(--muted);border-radius:20px;font-size:13px;padding:6px 14px;cursor:pointer;touch-action:manipulation;transition:all .15s;';
      chip.onclick = () => {
        const on = chip.dataset.on === '1';
        chip.dataset.on = on ? '0' : '1';
        chip.style.background    = on ? 'rgba(191,95,255,.08)' : 'rgba(191,95,255,.18)';
        chip.style.borderColor   = on ? 'rgba(191,95,255,.25)' : '#BF5FFF';
        chip.style.color         = on ? 'var(--muted)' : '#BF5FFF';
      };
      wrap.appendChild(chip);
    });
  }

  // Pre-fill if profile exists
  try {
    const saved = JSON.parse(localStorage.getItem('yp_myscene_profile') || '{}');
    if (saved.name)     document.getElementById('mySceneName').value = saved.name;
    if (saved.postcode) document.getElementById('myScenePostcode').value = saved.postcode;
    if (saved.genres && wrap) {
      [...wrap.children].forEach(chip => {
        if (saved.genres.includes(chip.textContent)) chip.click();
      });
    }
  } catch(e) {}

  const overlay = document.getElementById('mySceneOverlay');
  const sheet   = document.getElementById('mySceneSheet');
  overlay.style.display = 'block';
  sheet.style.display   = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    sheet.style.transform = 'translateX(-50%) translateY(0)';
  }));
}

function closeMySceneProfile() {
  const sheet = document.getElementById('mySceneSheet');
  const overlay = document.getElementById('mySceneOverlay');
  if (sheet)   sheet.style.transform = 'translateX(-50%) translateY(100%)';
  if (overlay) overlay.style.display = 'none';
  setTimeout(() => { if (sheet) sheet.style.display = 'none'; }, 300);
}

async function saveMySceneProfile() {
  const name     = document.getElementById('mySceneName')?.value.trim() || '';
  const postcode = document.getElementById('myScenePostcode')?.value.trim() || '';
  const wrap     = document.getElementById('mySceneGenreChips');
  const genres   = wrap ? [...wrap.children].filter(c => c.dataset.on === '1').map(c => c.textContent) : [];

  if (!name) { showToast('Add a display name', 'error'); return; }

  const profile = { name, postcode, genres, genreString: genres.join(' · ') };
  try { localStorage.setItem('yp_myscene_profile', JSON.stringify(profile)); } catch(e) {}

  // Save to Supabase profiles table
  if (!DEMO && currentUser?.id && currentSession?.access_token) {
    sbRest('profiles', {
      method: 'POST',
      body: JSON.stringify({
        user_id:      currentUser.id,
        type:         'punter',
        name:         name,
        dj_name:      name,
        postcode:     postcode,
        genre_string: profile.genreString,
        updated_at:   new Date().toISOString()
      }),
      prefer: 'resolution=merge-duplicates,return=minimal'
    }, currentSession.access_token).catch(() => {});
  }

  // Update dashboard card
  const nameEl = document.getElementById('punterDashName');
  const locEl  = document.getElementById('punterDashLocation');
  const ctaEl  = document.getElementById('punterDashCta');
  if (nameEl) nameEl.textContent = name;
  if (locEl)  locEl.textContent  = genres.length ? genres.slice(0,3).join(' · ') : (postcode || 'My Scene');
  if (ctaEl)  ctaEl.textContent  = 'EDIT →';

  window._punterProfile = { name, postcode, genre_string: profile.genreString };
  updateRoleCards();
  showToast('My Scene saved ✓', 'success');
  closeMySceneProfile();
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
  try { const c = localStorage.getItem('yp_host_profile'); hostProfile = c ? JSON.parse(c) : {}; } catch(e) { hostProfile = {}; }
  const email = currentUser?.email || '';
  document.getElementById('dashUserEmail').textContent = email ? `${email}` : '';
  document.getElementById('shareLinkBtn').style.display = 'none';

  // Show screen immediately, then load profile in background
  show('dashboardScreen');
  updateDashProfileCard();
  updateToggleVisibility('host');
  updateNotifDot();
  loadUserEvents();
  if (!DEMO) loadPendingAppsBadge();
  if (typeof loadDbNotifs === 'function') loadDbNotifs();
  if (typeof startNotifPolling === 'function') startNotifPolling();

  if (!DEMO && currentUser?.id) {
    loadProfileFromSupabase('host').then(row => {
      if (row && (row.name || row.dj_name)) {
        hostProfile = mapDbToHostProfile(row);
        try { localStorage.setItem('yp_host_profile', JSON.stringify(hostProfile)); } catch(e) {}
        updateDashProfileCard();
      }
    }).catch(()=>{});
  }
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
  // Restore cached profile so the screen renders correctly on first paint
  try { const c = localStorage.getItem('yp_artist_profile'); artistProfile = c ? JSON.parse(c) : {}; } catch(e) { artistProfile = {}; }
  const email = currentUser?.email || '';
  document.getElementById('artistDashUserEmail').textContent = email;

  // Show screen immediately with whatever profile is cached, then refresh in background
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

  if (!DEMO && currentUser?.id && currentUser.id !== 'guest') {
    loadProfileFromSupabase('artist').then(row => {
      if (row && (row.dj_name || row.name)) {
        artistProfile = mapDbToArtistProfile(row);
        try { localStorage.setItem('yp_artist_profile', JSON.stringify(artistProfile)); } catch(e) {}
        updateArtistDashCard();
        renderProfileNudge();
      }
    }).catch(()=>{});
  }
}

// ── Profile completeness nudge ─────────────────────

function renderProfileNudge() {
  const el = document.getElementById('profileNudge');
  if (!el) return;

  const p = artistProfile || {};
  const missing = [];

  if (!p.avatar)    missing.push({ label: 'Add a photo',    action: "showProfile()" });
  if (!p.mixLink)   missing.push({ label: 'Link a mix',     action: "showProfile()" });
  if (!p.bio)       missing.push({ label: 'Write a bio',    action: "showProfile()" });
  if (!p.genreString) missing.push({ label: 'Set your genres', action: "showProfile()" });

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
            style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:var(--text);border-radius:20px;font-size:12px;padding:6px 14px;cursor:pointer;">
            ${m.label}
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

// ── Skeleton loading helper ────────────────────────

function skeletonHTML(type) {
  return '<div style="text-align:center;padding:60px 0;color:var(--muted);font-family:\'Bebas Neue\',sans-serif;letter-spacing:2px;font-size:16px;" class="loading-text">LOADING...</div>';
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
  document.getElementById('calContent').innerHTML = skeletonHTML('calendar');
  await loadCalEvents();
  renderCalHeader();
  calRestorePostcode();
  renderCalContent();
}

function showSearchScreen() {
  _discoverOrigin = currentMode || null;
  show('searchScreen');
  // Always reset to Everything so discover doesn't open stuck on a previous filter
  const tf = document.getElementById('searchTypeFilter');
  if (tf && tf.value === 'event') tf.value = 'all';
  document.getElementById('searchInput').focus();
  runSearch();
}

function debounceSearch() {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(runSearch, 350);
}
