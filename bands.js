// ═══════════════════════════════════════════════════
//  bands.js — YesPleez Bands & Musos Module
//  Depends on: state.js, navigation.js, auth.js
// ═══════════════════════════════════════════════════

let bandProfile = {};
let _bandsAvailDates = new Set();
let _bandsAvailMonth = new Date();

// ── Enter bands dashboard ──────────────────────────

async function enterBandsDashboard() {
  const email = currentUser?.email || '';
  const el = document.getElementById('bandsDashUserEmail');
  if (el) el.textContent = email;

  bandProfile = {};

  if (!DEMO && currentUser?.id) {
    try {
      const rows = await sbRest(
        `profiles?user_id=eq.${currentUser.id}&type=eq.band&limit=1`,
        { method: 'GET' },
        currentSession?.access_token || null
      );
      if (rows && rows.length) bandProfile = rows[0];
    } catch(e) { console.warn('band profile load:', e); }
  }

  show('bandsDashScreen');
  _renderBandsDashCard();
  _loadBandsStats();
  _loadBandsUpcomingGigs();
  if (typeof loadDbNotifs === 'function') loadDbNotifs();
  if (typeof startNotifPolling === 'function') startNotifPolling();
  updateNotifDot();
}

// ── Dashboard card ─────────────────────────────────

function _renderBandsDashCard() {
  const nameEl     = document.getElementById('bandsDashName');
  const locationEl = document.getElementById('bandsDashLocation');
  const genreEl    = document.getElementById('bandsDashGenre');
  const ctaEl      = document.getElementById('bandsDashCta');
  const avatarEl   = document.getElementById('bandsDashAvatar');
  const p = bandProfile || {};

  if (p.name || p.dj_name) {
    if (nameEl) nameEl.textContent = p.name || p.dj_name;
    const loc   = [p.suburb || p.location, p.state].filter(Boolean).join(', ');
    if (locationEl) locationEl.textContent = loc || 'No location set';
    const parts = [p.band_type, p.genre_string ? p.genre_string.split(' · ').slice(0,3).join(' · ') : ''].filter(Boolean);
    if (genreEl) genreEl.textContent = parts.join(' · ');
    if (ctaEl) ctaEl.textContent = 'EDIT →';
    if (avatarEl && p.avatar) {
      avatarEl.innerHTML = `<img src="${p.avatar}" style="width:52px;height:52px;border-radius:10px;object-fit:cover;">`;
    }
  } else {
    if (nameEl) nameEl.textContent = 'Set up your band profile';
    if (locationEl) locationEl.textContent = 'Add your details so promoters and venues can find you';
    if (genreEl) genreEl.textContent = '';
    if (ctaEl) ctaEl.textContent = 'SET UP →';
  }
}

// ── Stats ──────────────────────────────────────────

async function _loadBandsStats() {
  const membersEl = document.getElementById('bandsStatMembers');
  const gigsEl    = document.getElementById('bandsStatGigs');
  const avEl      = document.getElementById('bandsStatAvail');

  if (membersEl && bandProfile?.member_count) {
    membersEl.textContent = bandProfile.member_count;
  } else if (membersEl) {
    membersEl.textContent = '—';
  }

  if (!currentUser?.id) return;

  // Availability count
  try {
    const today = new Date().toISOString().split('T')[0];
    const avRows = await sbRest(
      `band_availability?user_id=eq.${currentUser.id}&available_date=gte.${today}&select=available_date`,
      { method: 'GET' },
      currentSession?.access_token || null
    );
    const avCount = (avRows || []).length;
    if (avEl) avEl.textContent = avCount;
    _bandsAvailDates = new Set((avRows || []).map(r => r.available_date));
    _renderBandsAvailSummary(avRows || []);
  } catch(e) {
    if (avEl) avEl.textContent = '0';
  }

  if (gigsEl) gigsEl.textContent = '—';
}

function _renderBandsAvailSummary(rows) {
  const el = document.getElementById('bandsAvailSummary');
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = 'No availability set — tap <strong style="color:#FF8C42;">MANAGE</strong> to add open dates.';
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
        return `<div style="background:rgba(255,140,66,.1);border:1px solid rgba(255,140,66,.3);border-radius:8px;padding:5px 12px;font-size:12px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:#FF8C42;">${label.toUpperCase()}</div>`;
      }).join('')}
      ${rows.length > 6 ? `<div style="font-size:12px;color:var(--muted);align-self:center;">+${rows.length - 6} more</div>` : ''}
    </div>`;
}

// ── Upcoming gigs ──────────────────────────────────

async function _loadBandsUpcomingGigs() {
  const el = document.getElementById('bandsUpcomingGigs');
  if (!el) return;
  const bandName = bandProfile?.name || bandProfile?.dj_name;
  if (!bandName) {
    el.innerHTML = '<span style="color:var(--muted);font-size:13px;">Set up your band profile to track gigs.</span>';
    return;
  }
  try {
    const enc = encodeURIComponent(`%${bandName}%`);
    const rows = await sbRest(
      `events?select=id,name,config&config->>venue=ilike.${enc}&status=eq.live&order=created_at.desc&limit=8`,
      { method: 'GET' },
      currentSession?.access_token || null
    );
    if (!rows || !rows.length) {
      el.innerHTML = '<span style="color:var(--muted);font-size:13px;">No gigs booked yet — browse open events to apply.</span>';
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
          <div style="font-size:10px;letter-spacing:1px;color:#FF8C42;font-family:'Bebas Neue',sans-serif;">LIVE</div>
        </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<span style="color:var(--muted);font-size:13px;">Could not load gigs.</span>';
  }
}

// ── Band profile form ──────────────────────────────

function _populateBandYearDropdown() {
  const sel = document.getElementById('bandEstablishedInput');
  if (!sel || sel.options.length > 2) return; // already populated
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= 1950; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  }
}

function previewBandAvatar(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('bandAvatarPreview');
    if (preview) {
      preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;">`;
    }
  };
  reader.readAsDataURL(file);
}

function showBandProfile() {
  _populateBandYearDropdown();
  const p = bandProfile || {};
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('bandNameInput',        p.name || p.dj_name || '');
  setVal('bandLocationInput',    p.suburb || p.location || '');
  setVal('bandStateInput',       p.state || '');
  setVal('bandPostcodeInput',    p.postcode || '');
  setVal('bandMembersInput',     p.member_count || '');
  setVal('bandEstablishedInput', p.established_year || '');
  setVal('bandTypeInput',        p.band_type || '');
  setVal('bandGenresInput',      p.genre_string || '');
  setVal('bandBioInput',         p.bio || '');
  setVal('bandEpkInput',         p.mix_link || p.epk_link || '');
  setVal('bandContactInput',     p.contact_email || '');
  setVal('bandWebsiteInput',     p.website || '');
  setVal('bandInstagramInput',   p.instagram || '');
  // Restore avatar preview
  const preview = document.getElementById('bandAvatarPreview');
  if (preview) {
    if (p.avatar) {
      preview.innerHTML = `<img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      preview.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,140,66,.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg><div style="font-size:10px;color:rgba(255,140,66,.6);margin-top:6px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">PHOTO</div>`;
    }
  }
  // Reset file input
  const fileInput = document.getElementById('bandAvatarInput');
  if (fileInput) fileInput.value = '';
  show('bandProfileScreen');
}

async function saveBandProfile() {
  const getVal = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const name        = getVal('bandNameInput');
  const suburb      = getVal('bandLocationInput');
  const state       = getVal('bandStateInput');
  const postcode    = getVal('bandPostcodeInput');
  const members     = getVal('bandMembersInput');
  const established = getVal('bandEstablishedInput');
  const type        = getVal('bandTypeInput');
  const genres      = getVal('bandGenresInput');
  const bio         = getVal('bandBioInput');
  const epk         = getVal('bandEpkInput');
  const contact     = getVal('bandContactInput');
  const website     = getVal('bandWebsiteInput');
  const instagram   = getVal('bandInstagramInput');

  if (!name) { showToast('Please enter a band or act name', 'error'); return; }

  // Avatar upload
  let avatarUrl = bandProfile?.avatar || null;
  const fileInput = document.getElementById('bandAvatarInput');
  const file = fileInput?.files?.[0];
  if (file && !DEMO && currentSession?.access_token) {
    try {
      const ext  = file.name.split('.').pop();
      const path = `band_avatars/${currentUser.id}_${Date.now()}.${ext}`;
      const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${path}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentSession.access_token}`,
          'Content-Type': file.type,
          'x-upsert': 'true'
        },
        body: file
      });
      if (uploadRes.ok) {
        avatarUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}`;
      }
    } catch(e) { console.warn('avatar upload:', e); }
  }

  const payload = {
    user_id:          currentUser.id,
    type:             'band',
    name:             name,
    dj_name:          name,
    suburb:           suburb,
    location:         suburb,
    state:            state,
    postcode:         postcode,
    member_count:     members ? parseInt(members) : null,
    established_year: established ? parseInt(established) : null,
    band_type:        type,
    genre_string:     genres,
    bio:              bio,
    mix_link:         epk,
    epk_link:         epk,
    contact_email:    contact,
    website:          website,
    instagram:        instagram,
    avatar:           avatarUrl,
    updated_at:       new Date().toISOString()
  };

  try {
    const existing = bandProfile?.id;
    if (existing) {
      await sbRest(`profiles?id=eq.${existing}`, { method: 'PATCH', body: JSON.stringify(payload) }, currentSession?.access_token);
    } else {
      await sbRest(`profiles`, { method: 'POST', body: JSON.stringify(payload) }, currentSession?.access_token);
    }
    bandProfile = { ...bandProfile, ...payload };
    showToast('Band profile saved ✓', 'success');
    show('bandsDashScreen');
    _renderBandsDashCard();
    _loadBandsStats();
  } catch(e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

// ── Bands Availability Manager ─────────────────────

function openBandsAvailability() {
  _bandsAvailMonth = new Date();
  _showBandsAvailOverlay();
}

function _showBandsAvailOverlay() {
  let overlay = document.getElementById('bandsAvailOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'bandsAvailOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.85);display:flex;align-items:flex-end;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:#0f0f1a;border-radius:20px 20px 0 0;width:100%;max-width:480px;padding:24px 20px 40px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;color:#FF8C42;">BAND AVAILABILITY</div>
          <button onclick="closeBandsAvailability()" style="background:none;border:none;color:var(--muted);font-size:24px;cursor:pointer;">×</button>
        </div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:16px;">Tap dates your band is available to perform. Venues and promoters will see this when searching for acts.</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <button onclick="bandsAvailPrevMonth()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;">‹</button>
          <div id="bandsAvailMonthLabel" style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:2px;color:var(--text);"></div>
          <button onclick="bandsAvailNextMonth()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;">›</button>
        </div>
        <div id="bandsAvailGrid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:16px;"></div>
        <div id="bandsAvailList" style="margin-top:8px;font-size:12px;color:var(--muted);"></div>
      </div>`;
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  _renderBandsAvailMonth();
  _renderBandsAvailGrid();
}

function closeBandsAvailability() {
  const overlay = document.getElementById('bandsAvailOverlay');
  if (overlay) overlay.style.display = 'none';
}

function bandsAvailPrevMonth() {
  _bandsAvailMonth = new Date(_bandsAvailMonth.getFullYear(), _bandsAvailMonth.getMonth() - 1, 1);
  _renderBandsAvailMonth(); _renderBandsAvailGrid();
}

function bandsAvailNextMonth() {
  _bandsAvailMonth = new Date(_bandsAvailMonth.getFullYear(), _bandsAvailMonth.getMonth() + 1, 1);
  _renderBandsAvailMonth(); _renderBandsAvailGrid();
}

function _renderBandsAvailMonth() {
  const el = document.getElementById('bandsAvailMonthLabel');
  if (el) el.textContent = _bandsAvailMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }).toUpperCase();
}

function _renderBandsAvailGrid() {
  const el = document.getElementById('bandsAvailGrid');
  if (!el) return;
  const year  = _bandsAvailMonth.getFullYear();
  const month = _bandsAvailMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split('T')[0];

  const dayLabels = ['S','M','T','W','T','F','S'];
  let html = dayLabels.map(d => `<div style="text-align:center;font-size:10px;color:var(--muted);padding:4px 0;font-family:'Bebas Neue',sans-serif;">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += '<div></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isPast  = dateStr < today;
    const isAvail = _bandsAvailDates.has(dateStr);
    const isToday = dateStr === today;

    let bg = 'rgba(255,255,255,.04)';
    let color = isPast ? 'rgba(255,255,255,.2)' : 'var(--text)';
    let border = '1px solid transparent';
    if (isAvail) { bg = 'rgba(255,140,66,.18)'; border = '1px solid rgba(255,140,66,.5)'; color = '#FF8C42'; }
    if (isToday) { border = '1px solid rgba(255,255,255,.3)'; }

    html += `<div onclick="${isPast ? '' : `toggleBandsAvailDate('${dateStr}')`}"
      style="text-align:center;padding:7px 2px;border-radius:6px;font-size:13px;cursor:${isPast?'default':'pointer'};background:${bg};color:${color};border:${border};transition:background .15s;"
      >${d}</div>`;
  }
  el.innerHTML = html;

  const listEl = document.getElementById('bandsAvailList');
  if (listEl) {
    const count = [..._bandsAvailDates].filter(d => d >= today).length;
    listEl.textContent = count ? `${count} date${count !== 1 ? 's' : ''} marked available` : 'No dates marked yet';
  }
}

async function toggleBandsAvailDate(dateStr) {
  if (!currentUser?.id) return;
  const wasAvail = _bandsAvailDates.has(dateStr);
  if (wasAvail) _bandsAvailDates.delete(dateStr);
  else _bandsAvailDates.add(dateStr);
  _renderBandsAvailGrid();

  try {
    if (wasAvail) {
      await sbRest(
        `band_availability?user_id=eq.${currentUser.id}&available_date=eq.${dateStr}`,
        { method: 'DELETE' }, currentSession?.access_token
      );
    } else {
      await sbRest(
        `band_availability`,
        { method: 'POST', body: JSON.stringify({ user_id: currentUser.id, available_date: dateStr }) },
        currentSession?.access_token
      );
    }
    const today = new Date().toISOString().split('T')[0];
    const avEl = document.getElementById('bandsStatAvail');
    if (avEl) avEl.textContent = [..._bandsAvailDates].filter(d => d >= today).length;
    _renderBandsAvailSummary(
      [..._bandsAvailDates].filter(d => d >= today).map(d => ({ available_date: d }))
    );
  } catch(e) {
    if (wasAvail) _bandsAvailDates.add(dateStr);
    else _bandsAvailDates.delete(dateStr);
    _renderBandsAvailGrid();
    showToast('Could not update availability', 'error');
  }
}
