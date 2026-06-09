// ═══════════════════════════════════════════════════
//  standup.js — YesPleez Stand Up / Poetry Module
//  Depends on: state.js, navigation.js, auth.js
// ═══════════════════════════════════════════════════

let standupProfile = {};
let _standupAvailDates = new Set();
let _standupAvailMonth = new Date();

// ── Enter dashboard ────────────────────────────────

async function enterStandupDashboard() {
  const email = currentUser?.email || '';
  const el = document.getElementById('standupDashUserEmail');
  if (el) el.textContent = email;

  standupProfile = {};

  if (!DEMO && currentUser?.id) {
    try {
      const rows = await sbRest(
        `profiles?user_id=eq.${currentUser.id}&type=eq.standup&limit=1`,
        { method: 'GET' },
        currentSession?.access_token || null
      );
      if (rows && rows.length) standupProfile = rows[0];
    } catch(e) { console.warn('standup profile load:', e); }
  }

  show('standupDashScreen');
  _renderStandupDashCard();
  _loadStandupStats();
  if (typeof loadDbNotifs === 'function') loadDbNotifs();
  if (typeof startNotifPolling === 'function') startNotifPolling();
  updateNotifDot();
}

// ── Dashboard card ─────────────────────────────────

function _renderStandupDashCard() {
  const nameEl     = document.getElementById('standupDashName');
  const locationEl = document.getElementById('standupDashLocation');
  const genreEl    = document.getElementById('standupDashGenre');
  const ctaEl      = document.getElementById('standupDashCta');
  const p = standupProfile || {};

  if (p.name || p.dj_name) {
    if (nameEl) nameEl.textContent = p.name || p.dj_name;
    const loc = [p.suburb || p.location, p.state].filter(Boolean).join(', ');
    if (locationEl) locationEl.textContent = loc || 'No location set';
    const parts = [p.act_type, p.set_length ? `${p.set_length} min set` : ''].filter(Boolean);
    if (genreEl) genreEl.textContent = parts.join(' · ');
    if (ctaEl) ctaEl.textContent = 'EDIT →';
  } else {
    if (nameEl) nameEl.textContent = 'Set up your act profile';
    if (locationEl) locationEl.textContent = 'Add your details so venues and bookers can find you';
    if (genreEl) genreEl.textContent = '';
    if (ctaEl) ctaEl.textContent = 'SET UP →';
  }
}

// ── Stats ──────────────────────────────────────────

async function _loadStandupStats() {
  const setsEl  = document.getElementById('standupStatSets');
  const gigsEl  = document.getElementById('standupStatGigs');
  const avEl    = document.getElementById('standupStatAvail');

  if (setsEl && standupProfile?.set_length) {
    setsEl.textContent = standupProfile.set_length + 'm';
  } else if (setsEl) {
    setsEl.textContent = '—';
  }

  if (!currentUser?.id) return;

  try {
    const today = new Date().toISOString().split('T')[0];
    const avRows = await sbRest(
      `standup_availability?user_id=eq.${currentUser.id}&available_date=gte.${today}&select=available_date`,
      { method: 'GET' },
      currentSession?.access_token || null
    );
    const avCount = (avRows || []).length;
    if (avEl) avEl.textContent = avCount;
    _standupAvailDates = new Set((avRows || []).map(r => r.available_date));
    _renderStandupAvailSummary(avRows || []);
  } catch(e) {
    if (avEl) avEl.textContent = '0';
  }

  if (gigsEl) gigsEl.textContent = '—';
}

function _renderStandupAvailSummary(rows) {
  const el = document.getElementById('standupAvailSummary');
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = 'No availability set — tap <strong style="color:#FF88AA;">MANAGE</strong> to add open dates.';
    return;
  }
  const today = new Date().toISOString().split('T')[0];
  const upcoming = rows
    .filter(r => r.available_date >= today)
    .sort((a, b) => a.available_date.localeCompare(b.available_date))
    .slice(0, 6);

  el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;">
    ${upcoming.map(r => {
      const d = new Date(r.available_date + 'T12:00:00');
      const label = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
      return `<div style="background:rgba(255,136,170,.1);border:1px solid rgba(255,136,170,.3);border-radius:8px;padding:5px 12px;font-size:12px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:#FF88AA;">${label.toUpperCase()}</div>`;
    }).join('')}
    ${rows.length > 6 ? `<div style="font-size:12px;color:var(--muted);align-self:center;">+${rows.length - 6} more</div>` : ''}
  </div>`;
}

// ── Profile form ───────────────────────────────────

function showStandupProfile() {
  const p = standupProfile || {};
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('standupNameInput',      p.name || p.dj_name || '');
  setVal('standupTypeInput',      p.act_type || '');
  setVal('standupSetLengthInput', p.set_length || '');
  setVal('standupLocationInput',  p.suburb || p.location || '');
  setVal('standupStateInput',     p.state || '');
  setVal('standupBioInput',       p.bio || '');
  setVal('standupVideoInput',     p.mix_link || p.video_link || '');
  setVal('standupContactInput',   p.contact_email || '');
  setVal('standupWebsiteInput',   p.website || '');
  setVal('standupInstagramInput', p.instagram || '');
  show('standupProfileScreen');
}

async function saveStandupProfile() {
  const getVal = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const name      = getVal('standupNameInput');
  const type      = getVal('standupTypeInput');
  const setLength = getVal('standupSetLengthInput');
  const suburb    = getVal('standupLocationInput');
  const state     = getVal('standupStateInput');
  const bio       = getVal('standupBioInput');
  const video     = getVal('standupVideoInput');
  const contact   = getVal('standupContactInput');
  const website   = getVal('standupWebsiteInput');
  const instagram = getVal('standupInstagramInput');

  if (!name) { showToast('Please enter your act or stage name', 'error'); return; }

  const payload = {
    user_id:       currentUser.id,
    type:          'standup',
    name:          name,
    dj_name:       name,
    act_type:      type,
    set_length:    setLength ? parseInt(setLength) : null,
    suburb:        suburb,
    location:      suburb,
    state:         state,
    bio:           bio,
    mix_link:      video,
    video_link:    video,
    contact_email: contact,
    website:       website,
    instagram:     instagram,
    updated_at:    new Date().toISOString()
  };

  try {
    const existing = standupProfile?.id;
    if (existing) {
      await sbRest(`profiles?id=eq.${existing}`, { method: 'PATCH', body: JSON.stringify(payload) }, currentSession?.access_token);
    } else {
      await sbRest(`profiles`, { method: 'POST', body: JSON.stringify(payload) }, currentSession?.access_token);
    }
    standupProfile = { ...standupProfile, ...payload };
    showToast('Act profile saved ✓', 'success');
    show('standupDashScreen');
    _renderStandupDashCard();
    _loadStandupStats();
  } catch(e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

// ── Availability manager ───────────────────────────

function openStandupAvailability() {
  _standupAvailMonth = new Date();
  _showStandupAvailOverlay();
}

function _showStandupAvailOverlay() {
  let overlay = document.getElementById('standupAvailOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'standupAvailOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.85);display:flex;align-items:flex-end;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:#0f0f1a;border-radius:20px 20px 0 0;width:100%;max-width:480px;padding:24px 20px 40px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;color:#FF88AA;">ACT AVAILABILITY</div>
          <button onclick="closeStandupAvailability()" style="background:none;border:none;color:var(--muted);font-size:24px;cursor:pointer;">×</button>
        </div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:16px;">Tap dates you're available to perform. Venues and bookers can search for available acts on specific nights.</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <button onclick="standupAvailPrevMonth()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;">‹</button>
          <div id="standupAvailMonthLabel" style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:2px;color:var(--text);"></div>
          <button onclick="standupAvailNextMonth()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;">›</button>
        </div>
        <div id="standupAvailGrid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:16px;"></div>
        <div id="standupAvailList" style="margin-top:8px;font-size:12px;color:var(--muted);"></div>
      </div>`;
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  _renderStandupAvailMonth();
  _renderStandupAvailGrid();
}

function closeStandupAvailability() {
  const o = document.getElementById('standupAvailOverlay');
  if (o) o.style.display = 'none';
}

function standupAvailPrevMonth() {
  _standupAvailMonth = new Date(_standupAvailMonth.getFullYear(), _standupAvailMonth.getMonth() - 1, 1);
  _renderStandupAvailMonth(); _renderStandupAvailGrid();
}
function standupAvailNextMonth() {
  _standupAvailMonth = new Date(_standupAvailMonth.getFullYear(), _standupAvailMonth.getMonth() + 1, 1);
  _renderStandupAvailMonth(); _renderStandupAvailGrid();
}

function _renderStandupAvailMonth() {
  const el = document.getElementById('standupAvailMonthLabel');
  if (el) el.textContent = _standupAvailMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }).toUpperCase();
}

function _renderStandupAvailGrid() {
  const el = document.getElementById('standupAvailGrid');
  if (!el) return;
  const year = _standupAvailMonth.getFullYear();
  const month = _standupAvailMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split('T')[0];

  let html = ['S','M','T','W','T','F','S'].map(d =>
    `<div style="text-align:center;font-size:10px;color:var(--muted);padding:4px 0;font-family:'Bebas Neue',sans-serif;">${d}</div>`
  ).join('');
  for (let i = 0; i < firstDay; i++) html += '<div></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isPast  = dateStr < today;
    const isAvail = _standupAvailDates.has(dateStr);
    const isToday = dateStr === today;
    let bg = 'rgba(255,255,255,.04)', color = isPast ? 'rgba(255,255,255,.2)' : 'var(--text)', border = '1px solid transparent';
    if (isAvail) { bg = 'rgba(232,121,249,.18)'; border = '1px solid rgba(232,121,249,.5)'; color = '#FF88AA'; }
    if (isToday) border = '1px solid rgba(255,255,255,.3)';
    html += `<div onclick="${isPast ? '' : `toggleStandupAvailDate('${dateStr}')`}"
      style="text-align:center;padding:7px 2px;border-radius:6px;font-size:13px;cursor:${isPast?'default':'pointer'};background:${bg};color:${color};border:${border};transition:background .15s;">${d}</div>`;
  }
  el.innerHTML = html;

  const listEl = document.getElementById('standupAvailList');
  if (listEl) {
    const count = [..._standupAvailDates].filter(d => d >= today).length;
    listEl.textContent = count ? `${count} date${count !== 1 ? 's' : ''} marked available` : 'No dates marked yet';
  }
}

async function toggleStandupAvailDate(dateStr) {
  if (!currentUser?.id) return;
  const wasAvail = _standupAvailDates.has(dateStr);
  if (wasAvail) _standupAvailDates.delete(dateStr); else _standupAvailDates.add(dateStr);
  _renderStandupAvailGrid();
  try {
    if (wasAvail) {
      await sbRest(`standup_availability?user_id=eq.${currentUser.id}&available_date=eq.${dateStr}`,
        { method: 'DELETE' }, currentSession?.access_token);
    } else {
      await sbRest(`standup_availability`,
        { method: 'POST', body: JSON.stringify({ user_id: currentUser.id, available_date: dateStr }) },
        currentSession?.access_token);
    }
    const today = new Date().toISOString().split('T')[0];
    const avEl = document.getElementById('standupStatAvail');
    if (avEl) avEl.textContent = [..._standupAvailDates].filter(d => d >= today).length;
    _renderStandupAvailSummary([..._standupAvailDates].filter(d => d >= today).map(d => ({ available_date: d })));
  } catch(e) {
    if (wasAvail) _standupAvailDates.add(dateStr); else _standupAvailDates.delete(dateStr);
    _renderStandupAvailGrid();
    showToast('Could not update availability', 'error');
  }
}


