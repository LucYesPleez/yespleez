// ═══════════════════════════════════════════════════
//  venues.js — YesPleez Venues Module
//  Handles venue profile CRUD, availability, and dashboard
//  Depends on: state.js, navigation.js, auth.js
// ═══════════════════════════════════════════════════

let venueProfile = {};
let _venueAvailDates = new Set();
let _venueAvailMonth = new Date();

// ── Enter venue dashboard ──────────────────────────

async function enterVenueDashboard() {
  const email = currentUser?.email || '';
  const el = document.getElementById('venueDashUserEmail');
  if (el) el.textContent = email;

  venueProfile = {};

  if (!DEMO && currentUser?.id) {
    try {
      const rows = await sbRest(
        `profiles?user_id=eq.${currentUser.id}&type=eq.venue&limit=1`,
        { method: 'GET' },
        currentSession?.access_token || null
      );
      if (rows && rows.length) {
        venueProfile = rows[0];
      }
    } catch(e) {
      console.warn('venue profile load:', e);
    }
  }

  show('venueDashScreen');
  _renderVenueDashCard();
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
  const p = venueProfile || {};
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('venueNameInput',      p.name || p.dj_name || '');
  setVal('venueAddressInput',   p.suburb || p.location || '');
  setVal('venueStateInput',     p.state || '');
  setVal('venueCapacityInput',  p.capacity || '');
  setVal('venueTypeInput',      p.venue_type || '');
  setVal('venueGenresInput',    p.genre_string || '');
  setVal('venueBioInput',       p.bio || '');
  setVal('venueContactInput',   p.contact_email || '');
  setVal('venueWebsiteInput',   p.website || '');
  setVal('venueInstagramInput', p.instagram || '');
  show('venueProfileScreen');
}

async function saveVenueProfile() {
  const getVal = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const name     = getVal('venueNameInput');
  const suburb   = getVal('venueAddressInput');
  const state    = getVal('venueStateInput');
  const capacity = getVal('venueCapacityInput');
  const type     = getVal('venueTypeInput');
  const genres   = getVal('venueGenresInput');
  const bio      = getVal('venueBioInput');
  const contact  = getVal('venueContactInput');
  const website  = getVal('venueWebsiteInput');
  const instagram = getVal('venueInstagramInput');

  if (!name) { showToast('Please enter a venue name', 'error'); return; }

  const payload = {
    user_id:       currentUser.id,
    type:          'venue',
    name:          name,
    dj_name:       name,
    suburb:        suburb,
    location:      suburb,
    state:         state,
    capacity:      capacity ? parseInt(capacity) : null,
    venue_type:    type,
    genre_string:  genres,
    bio:           bio,
    contact_email: contact,
    website:       website,
    instagram:     instagram,
    updated_at:    new Date().toISOString()
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
