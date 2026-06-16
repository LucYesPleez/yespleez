// ═══════════════════════════════════════════════════
//  standup.js — YesPleez Stand Up / Poetry Module
//  Depends on: state.js, navigation.js, auth.js
// ═══════════════════════════════════════════════════

let standupProfile = {};
let _standupAvailDates = new Set();
let _standupAvailMonth = new Date();

const _STANDUP_VIBES = ['Dark','Observational','Political','Storytelling','Absurdist','Clean','Adult','Improv','Roast','Self-Deprecating','Surreal','Deadpan','Physical','Character','Topical','Experimental','Feminist','LGBTQ+','Cultural','Feel Good'];
let _standupVibeSelected = new Set();

function _renderStandupVibePicker() {
  const el = document.getElementById('standupVibePicker');
  if (!el) return;
  el.innerHTML = _STANDUP_VIBES.map(t => {
    const on = _standupVibeSelected.has(t);
    return `<button type="button" onclick="toggleStandupVibe(this,'${t.replace(/'/g,"\\'")}')"
      style="padding:6px 14px;border-radius:20px;font-size:12px;font-family:'DM Sans',sans-serif;cursor:pointer;transition:all .15s;
      background:${on ? 'rgba(255,136,170,.2)' : 'rgba(255,255,255,.05)'};
      border:1px solid ${on ? '#FF88AA' : 'rgba(255,255,255,.12)'};
      color:${on ? '#FF88AA' : 'var(--muted)'};">${t}</button>`;
  }).join('');
}

function toggleStandupVibe(btn, tag) {
  if (_standupVibeSelected.has(tag)) _standupVibeSelected.delete(tag);
  else _standupVibeSelected.add(tag);
  _renderStandupVibePicker();
}

function previewStandupAvatar(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('standupAvatarPreview');
    if (preview) preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;">`;
  };
  reader.readAsDataURL(file);
}

function updateStandupStyleCount()   { const el = document.getElementById('standupStyleCharCount');   if (el) el.textContent = (document.getElementById('standupStyleInput')?.value.length||0)   + ' / 35'; }
function updateStandupTaglineCount() { const el = document.getElementById('standupTaglineCharCount'); if (el) el.textContent = (document.getElementById('standupTaglineInput')?.value.length||0) + ' / 120'; }
function updateStandupBioCount()     { const el = document.getElementById('standupBioCharCount');     if (el) el.textContent = (document.getElementById('standupBioInput')?.value.length||0)     + ' / 500'; }

function selectStandupExp(btn) {
  document.querySelectorAll('#standupExpPills .exp-pill').forEach(p => p.classList.remove('selected'));
  btn.classList.add('selected');
}

function selectStandupFeeType(type) {
  const tBtn  = document.getElementById('standupFeeTicketsBtn');
  const pBtn  = document.getElementById('standupFeePaidBtn');
  const block = document.getElementById('standupFeeAmountBlock');
  if (tBtn)  tBtn.className  = 'fee-toggle-btn' + (type === 'minimum' ? ' selected-tickets' : '');
  if (pBtn)  pBtn.className  = 'fee-toggle-btn' + (type === 'paid'    ? ' selected-fee'     : '');
  if (block) block.style.display = type === 'paid' ? 'block' : 'none';
}

function selectStandupABN(hasABN) {
  const yBtn  = document.getElementById('standupAbnYesBtn');
  const nBtn  = document.getElementById('standupAbnNoBtn');
  const block = document.getElementById('standupAbnBlock');
  if (yBtn)  yBtn.className  = 'fee-toggle-btn' + (hasABN  ? ' selected-tickets' : '');
  if (nBtn)  nBtn.className  = 'fee-toggle-btn' + (!hasABN ? ' selected-fee'     : '');
  if (block) block.style.display = hasABN ? 'block' : 'none';
}
function selectStandupGST(registered) {
  const yBtn = document.getElementById('standupGstYesBtn');
  const nBtn = document.getElementById('standupGstNoBtn');
  if (yBtn) yBtn.className = 'fee-toggle-btn' + (registered  ? ' selected-tickets' : '');
  if (nBtn) nBtn.className = 'fee-toggle-btn' + (!registered ? ' selected-fee'     : '');
}

// ── Enter dashboard ────────────────────────────────

async function enterStandupDashboard() {
  const email = currentUser?.email || '';
  const el = document.getElementById('standupDashUserEmail');
  if (el) el.textContent = email;

  try { const c = localStorage.getItem('yp_standup_profile'); standupProfile = c ? JSON.parse(c) : {}; } catch(e) { standupProfile = {}; }

  show('standupDashScreen');
  _renderStandupDashCard();

  if (!DEMO && currentUser?.id) {
    sbRest(
      `profiles?user_id=eq.${currentUser.id}&type=eq.standup&limit=1`,
      { method: 'GET' },
      currentSession?.access_token || null
    ).then(rows => {
      if (rows && rows.length) {
        standupProfile = rows[0];
        try { localStorage.setItem('yp_standup_profile', JSON.stringify(standupProfile)); } catch(e) {}
        _renderStandupDashCard();
      }
    }).catch(e => console.warn('standup profile load:', e));
  }
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
  setVal('standupStyleInput',     p.sound || '');
  setVal('standupTaglineInput',   p.tagline || '');
  setVal('standupLocationInput',  p.suburb || p.location || '');
  setVal('standupStateInput',     p.state || '');
  setVal('standupPostcodeInput',  p.postcode || '');
  setVal('standupTypeInput',      p.act_type || '');
  setVal('standupSetLengthInput', p.set_length || '');
  setVal('standupBioInput',       p.bio || '');
  setVal('standupFeeInput',       p.fee || '');
  setVal('standupABN',            p.abn || '');
  setVal('standupVideoInput',     p.mix_link || p.video_link || '');
  setVal('standupInstagramInput', p.instagram || '');
  setVal('standupFacebookInput',  p.facebook || '');
  setVal('standupTiktok',         p.tiktok || '');
  setVal('standupContactInput',   p.contact_email || '');
  setVal('standupWebsiteInput',   p.website || '');
  // Restore char counts
  updateStandupStyleCount(); updateStandupTaglineCount(); updateStandupBioCount();
  // Restore vibe tags
  _standupVibeSelected = new Set((p.vibe_tags || '').split(',').map(s => s.trim()).filter(Boolean));
  _renderStandupVibePicker();
  // Restore experience pill
  document.querySelectorAll('#standupExpPills .exp-pill').forEach(btn => {
    btn.classList.toggle('selected', btn.textContent === (p.experience || ''));
  });
  // Restore fee type + checkboxes
  if (p.fee_type) selectStandupFeeType(p.fee_type);
  const negEl = document.getElementById('standupFeeNegotiable'); if (negEl) negEl.checked = !!p.fee_negotiable;
  const trvEl = document.getElementById('standupFeeTravel');     if (trvEl) trvEl.checked = !!p.fee_travel;
  // Restore ABN/GST
  if (p.has_abn !== undefined) { selectStandupABN(p.has_abn); if (p.gst_registered !== undefined) selectStandupGST(p.gst_registered); }
  // Restore avatar
  const preview = document.getElementById('standupAvatarPreview');
  if (preview) {
    if (p.avatar) {
      preview.innerHTML = `<img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
      preview.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,136,170,.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg><div style="font-size:10px;color:rgba(255,136,170,.6);margin-top:6px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">PHOTO</div>`;
    }
  }
  const fileInput = document.getElementById('standupAvatarInput');
  if (fileInput) fileInput.value = '';
  show('standupProfileScreen');
}

async function saveStandupProfile() {
  const getVal = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const name      = getVal('standupNameInput');
  const sound     = getVal('standupStyleInput');
  const tagline   = getVal('standupTaglineInput');
  const suburb    = getVal('standupLocationInput');
  const state     = getVal('standupStateInput');
  const postcode  = getVal('standupPostcodeInput');
  const _spc = (typeof AU_POSTCODES !== 'undefined' && postcode && AU_POSTCODES[postcode]) ? AU_POSTCODES[postcode] : null;
  const lat = _spc ? _spc[0] : (standupProfile?.lat || null);
  const lng = _spc ? _spc[1] : (standupProfile?.lng || null);
  const type      = getVal('standupTypeInput');
  const setLength = getVal('standupSetLengthInput');
  const vibes     = [..._standupVibeSelected].join(', ');
  const bio       = getVal('standupBioInput');
  const fee       = getVal('standupFeeInput');
  const feeNeg    = document.getElementById('standupFeeNegotiable')?.checked || false;
  const feeTrv    = document.getElementById('standupFeeTravel')?.checked || false;
  const feeTypeBtn = document.querySelector('#standupFeePaidBtn.selected-fee') ? 'paid' : (document.querySelector('#standupFeeTicketsBtn.selected-tickets') ? 'minimum' : '');
  const expBtn    = document.querySelector('#standupExpPills .exp-pill.selected');
  const experience = expBtn ? expBtn.textContent : '';
  const hasAbn    = document.getElementById('standupAbnYesBtn')?.classList.contains('selected-tickets') || false;
  const abn       = getVal('standupABN');
  const gstReg    = document.getElementById('standupGstYesBtn')?.classList.contains('selected-tickets') || false;
  const video     = getVal('standupVideoInput');
  const instagram = getVal('standupInstagramInput');
  const facebook  = getVal('standupFacebookInput');
  const tiktok    = getVal('standupTiktok');
  const contact   = getVal('standupContactInput');
  const website   = getVal('standupWebsiteInput');

  if (!name) { showToast('Please enter your act or stage name', 'error'); return; }

  // Avatar upload
  let avatarUrl = standupProfile?.avatar || null;
  const fileInput = document.getElementById('standupAvatarInput');
  const file = fileInput?.files?.[0];
  if (file && !DEMO && currentSession?.access_token) {
    try {
      const ext  = file.name.split('.').pop();
      const path = `${currentUser.id}_standup_${Date.now()}.${ext}`;
      const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${currentSession.access_token}`, 'Content-Type': file.type, 'x-upsert': 'true' },
        body: file
      });
      if (uploadRes.ok) avatarUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}`;
    } catch(e) { console.warn('avatar upload:', e); }
  }

  const payload = {
    user_id:       currentUser.id,
    type:          'standup',
    name:          name,
    dj_name:       name,
    sound:         sound,
    tagline:       tagline,
    suburb:        suburb,
    location:      suburb,
    state:         state,
    postcode:      postcode,
    lat:           lat,
    lng:           lng,
    act_type:      type,
    set_length:    setLength ? parseInt(setLength) : null,
    vibe_tags:     vibes,
    bio:           bio,
    experience:    experience,
    fee:           fee ? parseInt(fee) : null,
    fee_type:      feeTypeBtn,
    fee_negotiable: feeNeg,
    fee_travel:    feeTrv,
    has_abn:       hasAbn,
    abn:           abn,
    gst_registered: gstReg,
    mix_link:      video,
    video_link:    video,
    instagram:     instagram,
    facebook:      facebook,
    tiktok:        tiktok,
    contact_email: contact,
    website:       website,
    avatar:        avatarUrl,
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


