// ═══════════════════════════════════════════════════
//  venues.js — YesPleez Venues Module
//  Handles venue profile CRUD, availability, and dashboard
//  Depends on: state.js, navigation.js, auth.js
// ═══════════════════════════════════════════════════

let venueProfile = {};
let _venueAvailDates = new Set();
let _venueAvailMonth = new Date();

const _VENUE_GENRES = ['DJs','Live Bands','Solo Artists','Acoustic Acts','Cover Bands','Function Bands','Stand Up Comedy','Comedians','Poetry / Spoken Word','Jazz Acts','Open Mic','Trivia Nights','Karaoke','Other'];
let _venueGenreSelected = new Set();

function _renderVenueGenrePicker() {
  const el = document.getElementById('venueGenrePicker');
  if (!el) return;
  el.innerHTML = _VENUE_GENRES.map(t => {
    const on = _venueGenreSelected.has(t);
    return `<button type="button" onclick="toggleVenueGenre(this,'${t.replace(/'/g,"\\'")}')"
      style="padding:6px 14px;border-radius:20px;font-size:12px;font-family:'DM Sans',sans-serif;cursor:pointer;transition:all .15s;
      background:${on ? 'rgba(0,229,160,.15)' : 'rgba(255,255,255,.05)'};
      border:1px solid ${on ? '#00E5A0' : 'rgba(255,255,255,.12)'};
      color:${on ? '#00E5A0' : 'var(--muted)'};">${t}</button>`;
  }).join('');
}

function toggleVenueGenre(btn, tag) {
  if (_venueGenreSelected.has(tag)) _venueGenreSelected.delete(tag);
  else _venueGenreSelected.add(tag);
  _renderVenueGenrePicker();
}

function _populateVenueYearDropdown() {
  const sel = document.getElementById('venueEstablishedInput');
  if (!sel || sel.options.length > 2) return;
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= 1900; y--) {
    const opt = document.createElement('option');
    opt.value = y; opt.textContent = y;
    sel.appendChild(opt);
  }
}

function previewVenueAvatar(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('venueAvatarPreview');
    if (preview) preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;">`;
  };
  reader.readAsDataURL(file);
}

function updateVenueVibeCount()    { const el = document.getElementById('venueVibeCharCount');    if (el) el.textContent = (document.getElementById('venueVibeInput')?.value.length||0)    + ' / 35'; }
function updateVenueTaglineCount() { const el = document.getElementById('venueTaglineCharCount'); if (el) el.textContent = (document.getElementById('venueTaglineInput')?.value.length||0) + ' / 120'; }
function updateVenueBioCount()     { const el = document.getElementById('venueBioCharCount');     if (el) el.textContent = (document.getElementById('venueBioInput')?.value.length||0)     + ' / 500'; }

function toggleVenueTech(btn) { btn.classList.toggle('selected'); }

function selectVenueABN(hasABN) {
  const yBtn = document.getElementById('venueAbnYesBtn');
  const nBtn = document.getElementById('venueAbnNoBtn');
  const block = document.getElementById('venueAbnBlock');
  if (yBtn)  yBtn.className  = 'fee-toggle-btn' + (hasABN  ? ' selected-tickets' : '');
  if (nBtn)  nBtn.className  = 'fee-toggle-btn' + (!hasABN ? ' selected-fee'     : '');
  if (block) block.style.display = hasABN ? 'block' : 'none';
}
function selectVenueGST(registered) {
  const yBtn = document.getElementById('venueGstYesBtn');
  const nBtn = document.getElementById('venueGstNoBtn');
  if (yBtn) yBtn.className = 'fee-toggle-btn' + (registered  ? ' selected-tickets' : '');
  if (nBtn) nBtn.className = 'fee-toggle-btn' + (!registered ? ' selected-fee'     : '');
}

// ── Enter venue dashboard ──────────────────────────

async function enterVenueDashboard() {
  const email = currentUser?.email || '';
  const el = document.getElementById('venueDashUserEmail');
  if (el) el.textContent = email;

  try { const c = localStorage.getItem('yp_venue_profile'); venueProfile = c ? JSON.parse(c) : {}; } catch(e) { venueProfile = {}; }

  show('venueDashScreen');
  _renderVenueDashCard();

  if (!DEMO && currentUser?.id) {
    sbRest(
      `profiles?user_id=eq.${currentUser.id}&type=eq.venue&limit=1`,
      { method: 'GET' },
      currentSession?.access_token || null
    ).then(rows => {
      if (rows && rows.length) {
        venueProfile = rows[0];
        try { localStorage.setItem('yp_venue_profile', JSON.stringify(venueProfile)); } catch(e) {}
        _renderVenueDashCard();
      }
    }).catch(e => console.warn('venue profile load:', e));
  }
  _loadVenueStats();
  _loadVenueAvailSummary();
  _loadVenueUpcomingEvents();
  if (typeof loadDbNotifs === 'function') loadDbNotifs();
  if (typeof startNotifPolling === 'function') startNotifPolling();
  updateNotifDot();
}

// ── Dashboard card ─────────────────────────────────

function _renderVenueDashCard() {
  const nameEl     = document.getElementById('venueDashName');
  const locationEl = document.getElementById('venueDashLocation');
  const capacityEl = document.getElementById('venueDashCapacity');
  const ctaEl      = document.getElementById('venueDashCta');
  const avatarEl   = document.getElementById('venueDashAvatar');

  const p = venueProfile || {};

  if (p.name || p.dj_name) {
    // Profile exists
    if (nameEl) nameEl.textContent = p.name || p.dj_name || 'Your Venue';
    const suburb = p.suburb || p.location || '';
    const state  = p.state || '';
    const loc    = [suburb, state].filter(Boolean).join(', ');
    if (locationEl) locationEl.textContent = loc || 'No location set';
    if (capacityEl) {
      const cap  = p.capacity ? `Capacity: ${p.capacity}` : '';
      const type = p.venue_type || '';
      capacityEl.textContent = [cap, type].filter(Boolean).join(' · ');
    }
    if (ctaEl) ctaEl.textContent = 'EDIT →';
    if (avatarEl && p.avatar) {
      avatarEl.innerHTML = `<img src="${p.avatar}" style="width:52px;height:52px;border-radius:10px;object-fit:cover;">`;
    }
  } else {
    if (nameEl) nameEl.textContent = 'Set up your venue profile';
    if (locationEl) locationEl.textContent = 'Add your venue details so promoters can find you';
    if (capacityEl) capacityEl.textContent = '';
    if (ctaEl) ctaEl.textContent = 'SET UP →';
  }
}

// ── Stats ──────────────────────────────────────────

async function _loadVenueStats() {
  const evEl  = document.getElementById('venueStatEvents');
  const inqEl = document.getElementById('venueStatInquiries');
  const avEl  = document.getElementById('venueStatAvail');
  if (!currentUser?.id) return;

  // Count upcoming events linked to this venue (via config->venue matching)
  if (venueProfile?.name || venueProfile?.dj_name) {
    try {
      const venueName = venueProfile.name || venueProfile.dj_name || '';
      const enc = encodeURIComponent(`%${venueName}%`);
      const evRows = await sbRest(
        `events?select=id&config->>venue=ilike.${enc}&status=eq.live&limit=100`,
        { method: 'GET' },
        currentSession?.access_token || null
      );
      if (evEl) evEl.textContent = (evRows || []).length;
    } catch(e) {}
  }

  // Count availability dates
  try {
    const today = new Date().toISOString().split('T')[0];
    const avRows = await sbRest(
      `venue_availability?user_id=eq.${currentUser.id}&available_date=gte.${today}&select=available_date`,
      { method: 'GET' },
      currentSession?.access_token || null
    );
    const avCount = (avRows || []).length;
    if (avEl) avEl.textContent = avCount;
    _venueAvailDates = new Set((avRows || []).map(r => r.available_date));
    _renderVenueAvailSummary(avRows || []);
  } catch(e) {
    if (avEl) avEl.textContent = '0';
  }

  if (inqEl) inqEl.textContent = '—';
}

// ── Availability summary ───────────────────────────

function _loadVenueAvailSummary() {
  // Already loaded in _loadVenueStats via venue_availability table
}

function _renderVenueAvailSummary(rows) {
  const el = document.getElementById('venueAvailSummary');
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = 'No availability set — tap <strong style="color:#00E5A0;">MANAGE</strong> to add open dates.';
    return;
  }
  const today = new Date().toISOString().split('T')[0];
  const upcoming = rows
    .filter(r => r.available_date >= today)
    .sort((a, b) => a.available_date.localeCompare(b.available_date))
    .slice(0, 6);

  el.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      ${upcoming.map(r => {
        const d = new Date(r.available_date + 'T12:00:00');
        const label = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
        return `<div style="background:rgba(0,229,160,.1);border:1px solid rgba(0,229,160,.3);border-radius:8px;padding:5px 12px;font-size:12px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:#00E5A0;">${label.toUpperCase()}</div>`;
      }).join('')}
      ${rows.length > 6 ? `<div style="font-size:12px;color:var(--muted);align-self:center;">+${rows.length - 6} more</div>` : ''}
    </div>`;
}

// ── Upcoming events at this venue ──────────────────

async function _loadVenueUpcomingEvents() {
  const el = document.getElementById('venueUpcomingEvents');
  if (!el) return;
  const venueName = venueProfile?.name || venueProfile?.dj_name;
  if (!venueName) {
    el.innerHTML = '<span style="color:var(--muted);font-size:13px;">Set up your venue profile to see linked events.</span>';
    return;
  }
  try {
    const enc = encodeURIComponent(`%${venueName}%`);
    const today = new Date().toISOString().split('T')[0];
    const rows = await sbRest(
      `events?select=id,name,config&config->>venue=ilike.${enc}&status=eq.live&order=created_at.desc&limit=10`,
      { method: 'GET' },
      currentSession?.access_token || null
    );
    if (!rows || !rows.length) {
      el.innerHTML = '<span style="color:var(--muted);font-size:13px;">No events linked to this venue yet.</span>';
      return;
    }
    el.innerHTML = rows.map(ev => {
      const cfg  = ev.config || {};
      const date = cfg.date ? new Date(cfg.date + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
      return `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
          <div style="flex:1;min-width:0;">
            <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1px;">${ev.name || 'Untitled Event'}</div>
            ${date ? `<div style="font-size:12px;color:var(--muted);">${date}</div>` : ''}
          </div>
          <div style="font-size:10px;letter-spacing:1px;color:#00E5A0;font-family:'Bebas Neue',sans-serif;">LIVE</div>
        </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<span style="color:var(--muted);font-size:13px;">Could not load events.</span>';
  }
}

// ── Venue profile screen ───────────────────────────

function showVenueProfile() {
  _populateVenueYearDropdown();
  const p = venueProfile || {};
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('venueNameInput',        p.name || p.dj_name || '');
  setVal('venueVibeInput',        p.sound || '');
  setVal('venueTaglineInput',     p.tagline || '');
  setVal('venueAddressInput',     p.suburb || p.location || '');
  setVal('venueStateInput',       p.state || '');
  setVal('venuePostcodeInput',    p.postcode || '');
  setVal('venueTypeInput',        p.venue_type || '');
  setVal('venueEstablishedInput', p.established_year || '');
  setVal('venueBioInput',         p.bio || '');
  setVal('venueStageDims',        p.stage_dims || '');
  setVal('venueABN',              p.abn || '');
  setVal('venueContactInput',     p.contact_email || '');
  setVal('venueWebsiteInput',     p.website || '');
  setVal('venueInstagramInput',   p.instagram || '');
  setVal('venueFacebookInput',    p.facebook || '');
  setVal('venueTiktok',           p.tiktok || '');
  // Restore char counts
  updateVenueVibeCount(); updateVenueTaglineCount(); updateVenueBioCount();
  // Restore genre picker
  _venueGenreSelected = new Set((p.genre_string || '').split(',').map(s => s.trim()).filter(Boolean));
  _renderVenueGenrePicker();
  // Restore tech pills
  const tech = (p.tech_features || '').split(',').map(s => s.trim());
  document.querySelectorAll('#venueTechPills .tech-pill').forEach(btn => {
    btn.classList.toggle('selected', tech.includes(btn.textContent));
  });
  // Restore days
  const days = (p.live_nights || '').split(',').map(s => s.trim());
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d => {
    const cb = document.getElementById('venueDay' + d); if (cb) cb.checked = days.includes(d.toUpperCase());
  });
  // Restore ABN/GST
  if (p.has_abn !== undefined) { selectVenueABN(p.has_abn); if (p.gst_registered !== undefined) selectVenueGST(p.gst_registered); }
  // Restore avatar
  const preview = document.getElementById('venueAvatarPreview');
  if (preview) {
    if (p.avatar) {
      preview.innerHTML = `<img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      preview.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(0,229,160,.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg><div style="font-size:10px;color:rgba(0,229,160,.6);margin-top:6px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">PHOTO</div>`;
    }
  }
  const fileInput = document.getElementById('venueAvatarInput');
  if (fileInput) fileInput.value = '';
  show('venueProfileScreen');
}

async function saveVenueProfile() {
  const getVal = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const name        = getVal('venueNameInput');
  const sound       = getVal('venueVibeInput');
  const tagline     = getVal('venueTaglineInput');
  const suburb      = getVal('venueAddressInput');
  const state       = getVal('venueStateInput');
  const postcode    = getVal('venuePostcodeInput');
  const _vpc = (typeof AU_POSTCODES !== 'undefined' && postcode && AU_POSTCODES[postcode]) ? AU_POSTCODES[postcode] : null;
  const lat = _vpc ? _vpc[0] : (venueProfile?.lat || null);
  const lng = _vpc ? _vpc[1] : (venueProfile?.lng || null);
  const type        = getVal('venueTypeInput');
  const established = getVal('venueEstablishedInput');
  const genres      = [..._venueGenreSelected].join(', ');
  const bio         = getVal('venueBioInput');
  const stageDims   = getVal('venueStageDims');
  const tech        = [...document.querySelectorAll('#venueTechPills .tech-pill.selected')].map(b => b.textContent).join(', ');
  const liveNights  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    .filter(d => document.getElementById('venueDay' + d)?.checked)
    .map(d => d.toUpperCase()).join(', ');
  const hasAbn      = document.getElementById('venueAbnYesBtn')?.classList.contains('selected-tickets') || false;
  const abn         = getVal('venueABN');
  const gstReg      = document.getElementById('venueGstYesBtn')?.classList.contains('selected-tickets') || false;
  const contact     = getVal('venueContactInput');
  const website     = getVal('venueWebsiteInput');
  const instagram   = getVal('venueInstagramInput');
  const facebook    = getVal('venueFacebookInput');
  const tiktok      = getVal('venueTiktok');

  if (!name) { showToast('Please enter a venue name', 'error'); return; }

  // Avatar upload
  let avatarUrl = venueProfile?.avatar || null;
  const fileInput = document.getElementById('venueAvatarInput');
  const file = fileInput?.files?.[0];
  if (file && !DEMO && currentSession?.access_token) {
    try {
      const ext  = file.name.split('.').pop();
      const path = `${currentUser.id}_venue_${Date.now()}.${ext}`;
      const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${currentSession.access_token}`, 'Content-Type': file.type, 'x-upsert': 'true' },
        body: file
      });
      if (uploadRes.ok) avatarUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}`;
    } catch(e) { console.warn('avatar upload:', e); }
  }

  const payload = {
    user_id:          currentUser.id,
    type:             'venue',
    name:             name,
    dj_name:          name,
    sound:            sound,
    tagline:          tagline,
    suburb:           suburb,
    location:         suburb,
    state:            state,
    postcode:         postcode,
    lat:              lat,
    lng:              lng,
    venue_type:       type,
    established_year: established ? parseInt(established) : null,
    genre_string:     genres,
    bio:              bio,
    stage_dims:       stageDims,
    tech_features:    tech,
    live_nights:      liveNights,
    has_abn:          hasAbn,
    abn:              abn,
    gst_registered:   gstReg,
    contact_email:    contact,
    website:          website,
    instagram:        instagram,
    facebook:         facebook,
    tiktok:           tiktok,
    avatar:           avatarUrl,
    updated_at:       new Date().toISOString()
  };

  try {
    const existing = venueProfile?.id;
    let result;
    if (existing) {
      result = await sbRest(
        `profiles?id=eq.${existing}`,
        { method: 'PATCH', body: JSON.stringify(payload) },
        currentSession?.access_token
      );
    } else {
      result = await sbRest(
        `profiles`,
        { method: 'POST', body: JSON.stringify(payload) },
        currentSession?.access_token
      );
    }
    venueProfile = { ...venueProfile, ...payload };
    showToast('Venue profile saved ✓', 'success');
    show('venueDashScreen');
    _renderVenueDashCard();
    _loadVenueStats();
    _loadVenueUpcomingEvents();
  } catch(e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

// ── Venue Availability Manager ─────────────────────

function openVenueAvailability() {
  // Re-use the availability overlay pattern from calendar.js
  // but with venue-specific table: venue_availability
  _venueAvailMonth = new Date();
  _showVenueAvailOverlay();
}

function _showVenueAvailOverlay() {
  // Build and inject overlay dynamically
  let overlay = document.getElementById('venueAvailOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'venueAvailOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.85);display:flex;align-items:flex-end;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:#0f0f1a;border-radius:20px 20px 0 0;width:100%;max-width:480px;padding:24px 20px 40px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;color:#00E5A0;">VENUE AVAILABILITY</div>
          <button onclick="closeVenueAvailability()" style="background:none;border:none;color:var(--muted);font-size:24px;cursor:pointer;">×</button>
        </div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:16px;">Tap dates your venue is available for hire. Promoters will see this when browsing venues.</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <button onclick="venueAvailPrevMonth()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;">‹</button>
          <div id="venueAvailMonthLabel" style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:2px;color:var(--text);"></div>
          <button onclick="venueAvailNextMonth()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;">›</button>
        </div>
        <div id="venueAvailGrid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:16px;"></div>
        <div id="venueAvailList" style="margin-top:8px;font-size:12px;color:var(--muted);"></div>
      </div>`;
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  _renderVenueAvailMonth();
  _renderVenueAvailGrid();
}

function closeVenueAvailability() {
  const overlay = document.getElementById('venueAvailOverlay');
  if (overlay) overlay.style.display = 'none';
}

function venueAvailPrevMonth() {
  _venueAvailMonth = new Date(_venueAvailMonth.getFullYear(), _venueAvailMonth.getMonth() - 1, 1);
  _renderVenueAvailMonth();
  _renderVenueAvailGrid();
}

function venueAvailNextMonth() {
  _venueAvailMonth = new Date(_venueAvailMonth.getFullYear(), _venueAvailMonth.getMonth() + 1, 1);
  _renderVenueAvailMonth();
  _renderVenueAvailGrid();
}

function _renderVenueAvailMonth() {
  const el = document.getElementById('venueAvailMonthLabel');
  if (!el) return;
  el.textContent = _venueAvailMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }).toUpperCase();
}

function _renderVenueAvailGrid() {
  const el = document.getElementById('venueAvailGrid');
  if (!el) return;
  const year  = _venueAvailMonth.getFullYear();
  const month = _venueAvailMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split('T')[0];

  const dayLabels = ['S','M','T','W','T','F','S'];
  let html = dayLabels.map(d => `<div style="text-align:center;font-size:10px;color:var(--muted);padding:4px 0;font-family:'Bebas Neue',sans-serif;">${d}</div>`).join('');

  // Empty cells
  for (let i = 0; i < firstDay; i++) {
    html += '<div></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isPast  = dateStr < today;
    const isAvail = _venueAvailDates.has(dateStr);
    const isToday = dateStr === today;

    let bg = 'rgba(255,255,255,.04)';
    let color = isPast ? 'rgba(255,255,255,.2)' : 'var(--text)';
    let border = '1px solid transparent';

    if (isAvail) { bg = 'rgba(0,229,160,.18)'; border = '1px solid rgba(0,229,160,.5)'; color = '#00E5A0'; }
    if (isToday) { border = '1px solid rgba(255,255,255,.3)'; }

    html += `<div onclick="${isPast ? '' : `toggleVenueAvailDate('${dateStr}')`}"
      style="text-align:center;padding:7px 2px;border-radius:6px;font-size:13px;cursor:${isPast?'default':'pointer'};background:${bg};color:${color};border:${border};transition:background .15s;"
      >${d}</div>`;
  }

  el.innerHTML = html;

  // List
  const listEl = document.getElementById('venueAvailList');
  if (listEl) {
    const futureAvail = [..._venueAvailDates].filter(d => d >= today).sort();
    listEl.textContent = futureAvail.length
      ? `${futureAvail.length} date${futureAvail.length !== 1 ? 's' : ''} marked available`
      : 'No dates marked yet';
  }
}

async function toggleVenueAvailDate(dateStr) {
  if (!currentUser?.id) return;
  const wasAvail = _venueAvailDates.has(dateStr);

  // Optimistic update
  if (wasAvail) _venueAvailDates.delete(dateStr);
  else _venueAvailDates.add(dateStr);
  _renderVenueAvailGrid();

  try {
    if (wasAvail) {
      await sbRest(
        `venue_availability?user_id=eq.${currentUser.id}&available_date=eq.${dateStr}`,
        { method: 'DELETE' },
        currentSession?.access_token
      );
    } else {
      await sbRest(
        `venue_availability`,
        { method: 'POST', body: JSON.stringify({ user_id: currentUser.id, available_date: dateStr }) },
        currentSession?.access_token
      );
    }
    // Update the stat count
    const avEl = document.getElementById('venueStatAvail');
    if (avEl) avEl.textContent = [..._venueAvailDates].filter(d => d >= new Date().toISOString().split('T')[0]).length;
    // Refresh summary
    _renderVenueAvailSummary(
      [..._venueAvailDates].filter(d => d >= new Date().toISOString().split('T')[0]).map(d => ({ available_date: d }))
    );
  } catch(e) {
    // Rollback
    if (wasAvail) _venueAvailDates.add(dateStr);
    else _venueAvailDates.delete(dateStr);
    _renderVenueAvailGrid();
    showToast('Could not update availability', 'error');
  }
}
