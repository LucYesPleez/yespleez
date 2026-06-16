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
    venueProfile._pendingAvatar = e.target.result;
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
        if (typeof updateRoleCards === 'function') updateRoleCards();
        if (typeof _updateIndustryPanelBadges === 'function') _updateIndustryPanelBadges();
      }
    }).catch(e => console.warn('venue profile load:', e));
  }
  _loadVenueStats();
  _loadVenueAvailSummary();
  _loadVenueUpcomingEvents();
  _loadVenueEnquiries();
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

  // Count pending enquiries
  try {
    const enqRows = await sbRest(
      `venue_enquiries?venue_user_id=eq.${currentUser.id}&select=id`,
      { method: 'GET' }, currentSession?.access_token
    );
    if (inqEl) inqEl.textContent = (enqRows || []).length || '0';
  } catch(e) { if (inqEl) inqEl.textContent = '0'; }
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

// ── Venue enquiries ────────────────────────────────

async function _loadVenueEnquiries() {
  const el = document.getElementById('venueEnquiriesList');
  if (!el || !currentUser?.id) return;

  el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0;">Loading…</div>';

  try {
    const rows = await sbRest(
      `venue_enquiries?venue_user_id=eq.${currentUser.id}&order=created_at.desc&limit=50`,
      { method: 'GET' }, currentSession?.access_token
    );
    if (!rows || !rows.length) {
      el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0;">No enquiries yet — artists will appear here when they tap an available date on your profile.</div>';
      return;
    }

    // Fetch applicant profiles in one query
    const ids = [...new Set(rows.map(r => r.applicant_user_id))];
    const profiles = await sbRest(
      `profiles?user_id=in.(${ids.join(',')})&select=*`,
      { method: 'GET' }, currentSession?.access_token
    ).catch(() => []);

    const profileMap = {};
    (profiles || []).forEach(p => { profileMap[`${p.user_id}__${p.type}`] = p; });

    el.innerHTML = rows.map(enq => {
      const p = profileMap[`${enq.applicant_user_id}__${enq.applicant_type}`]
             || profileMap[Object.keys(profileMap).find(k => k.startsWith(enq.applicant_user_id + '__')) || '']
             || {};
      const name    = p.dj_name || p.name || 'Unknown';
      const genre   = p.genre_string || p.band_type || p.act_type || '';
      const sound   = p.sound || '';
      const bio     = p.bio || '';
      const loc     = [p.location, p.state].filter(Boolean).join(', ');
      const avatar  = p.avatar || '';
      const insta   = p.instagram ? `https://instagram.com/${p.instagram.replace('@','')}` : '';
      const web     = p.website   ? (p.website.startsWith('http') ? p.website : 'https://' + p.website) : '';
      const mix     = p.mix_link || p.soundcloud || '';

      const typeAccents = { artist:'#00E5FF', band:'#FF8C42', standup:'#FF88AA', host:'#FF3399' };
      const accent = typeAccents[enq.applicant_type] || '#00E5FF';

      const prettyDate = new Date(enq.date_requested + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const prettyCreated = new Date(enq.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

      const statusColor = { pending: '#FFB347', accepted: '#00E5A0', declined: 'var(--muted)' }[enq.status] || '#FFB347';
      const statusLabel = enq.status.toUpperCase();

      const avatarHtml = avatar
        ? `<img src="${avatar}" style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:2px solid ${accent};flex-shrink:0;" onerror="this.style.display='none'">`
        : `<div style="width:56px;height:56px;border-radius:10px;background:rgba(255,255,255,.06);border:2px solid rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:24px;">🎵</div>`;

      const genrePills = genre ? genre.split(' · ').slice(0,4).map(g =>
        `<span style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:20px;font-size:10px;padding:2px 8px;color:var(--muted);">${g}</span>`
      ).join('') : '';

      const links = [
        mix    ? `<a href="${mix.startsWith('http')?mix:'https://'+mix}" target="_blank" rel="noopener" style="font-size:11px;color:${accent};text-decoration:none;">▶ Mix</a>` : '',
        insta  ? `<a href="${insta}" target="_blank" rel="noopener" style="font-size:11px;color:#E1306C;text-decoration:none;">Instagram</a>` : '',
        web    ? `<a href="${web}" target="_blank" rel="noopener" style="font-size:11px;color:var(--neon2);text-decoration:none;">Website</a>` : '',
      ].filter(Boolean).join('<span style="color:var(--muted);margin:0 4px;">·</span>');

      const actionBtns = enq.status === 'pending' ? `
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button onclick="_vpEnquiryRespond('${enq.id}','accepted',this)" style="flex:1;background:rgba(0,229,160,.15);border:1.5px solid #00E5A0;color:#00E5A0;font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1px;padding:10px;border-radius:10px;cursor:pointer;">ACCEPT ✓</button>
          <button onclick="_vpEnquiryRespond('${enq.id}','declined',this)" style="flex:1;background:rgba(255,255,255,.04);border:1px solid var(--border);color:var(--muted);font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1px;padding:10px;border-radius:10px;cursor:pointer;">DECLINE ✗</button>
        </div>` : `<div style="margin-top:10px;font-family:'Bebas Neue',sans-serif;font-size:12px;letter-spacing:1px;color:${statusColor};">${statusLabel}</div>`;

      return `
        <div style="background:var(--card);border:1px solid rgba(${accent === '#00E5FF' ? '0,229,255' : accent === '#FF8C42' ? '255,140,66' : accent === '#FF88AA' ? '255,136,170' : '255,51,153'},.2);border-radius:14px;padding:16px;margin-bottom:12px;">
          <div style="display:flex;gap:14px;align-items:flex-start;">
            ${avatarHtml}
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:2px;">
                <div style="font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:1px;">${name}</div>
                <span style="font-size:9px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:2px 7px;letter-spacing:1px;color:${accent};font-family:'Bebas Neue',sans-serif;">${(enq.applicant_type||'').toUpperCase()}</span>
              </div>
              ${loc ? `<div style="font-size:11px;color:var(--muted);">📍 ${loc}</div>` : ''}
              ${genrePills ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">${genrePills}</div>` : ''}
              ${sound ? `<div style="font-size:12px;color:var(--muted);font-style:italic;margin-top:5px;">"${sound.slice(0,80)}${sound.length>80?'…':''}"</div>` : ''}
              ${bio   ? `<div style="font-size:12px;color:var(--muted);margin-top:5px;line-height:1.5;">${bio.slice(0,120)}${bio.length>120?'…':''}</div>` : ''}
              ${links ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center;">${links}</div>` : ''}
            </div>
          </div>
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07);">
            <div style="font-family:'Bebas Neue',sans-serif;font-size:10px;letter-spacing:2px;color:#00E5A0;margin-bottom:4px;">REQUESTED DATE</div>
            <div style="font-size:14px;font-weight:600;">${prettyDate}</div>
            ${enq.note ? `<div style="font-size:13px;color:var(--muted);margin-top:8px;font-style:italic;">"${enq.note}"</div>` : ''}
            <div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:6px;">Received ${prettyCreated}</div>
          </div>
          ${actionBtns}
        </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;">Could not load enquiries.</div>';
  }
}

async function _vpEnquiryRespond(enquiryId, status, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    await sbRest(`venue_enquiries?id=eq.${enquiryId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    }, currentSession?.access_token);
    showToast(status === 'accepted' ? 'Enquiry accepted!' : 'Enquiry declined', status === 'accepted' ? 'success' : 'info');
    _loadVenueEnquiries();
    _loadVenueStats();
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = status === 'accepted' ? 'ACCEPT ✓' : 'DECLINE ✗'; }
    showToast('Failed to update — try again', 'error');
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

  // Avatar — use DataURL stored during preview (same approach as artist/host)
  const avatarUrl = venueProfile._pendingAvatar || venueProfile?.avatar || null;

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
    const patched = await sbRest(`profiles?user_id=eq.${currentUser.id}&type=eq.venue`, { method: 'PATCH', body: JSON.stringify(payload) }, currentSession?.access_token);
    if (!Array.isArray(patched) || patched.length === 0) {
      await sbRest(`profiles`, { method: 'POST', body: JSON.stringify(payload) }, currentSession?.access_token);
    }
    venueProfile = { ...venueProfile, ...payload };
    try { localStorage.setItem('yp_venue_profile', JSON.stringify(venueProfile)); } catch(e) {}
    if (typeof updateRoleCards === 'function') updateRoleCards();
    if (typeof _updateIndustryPanelBadges === 'function') _updateIndustryPanelBadges();
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

// ── Venue Public Profile Sections ──────────────────

let _vpCalMonth = new Date();

async function loadVenuePublicSections(userId, venueName, accentColor, accentRgb, grad2, venueContact) {
  _vpVenueName    = venueName || '';
  _vpVenueContact = venueContact || null;
  _vpVenueUserId  = userId || null;
  const today = new Date().toISOString().split('T')[0];
  _vpCalMonth = new Date();
  _vpCalMonth.setDate(1);

  // Load availability dates and events in parallel
  const [availRows, eventRows] = await Promise.all([
    sbRest(
      `venue_availability?user_id=eq.${userId}&available_date=gte.${today}&order=available_date.asc&limit=90`,
      { method: 'GET' }, currentSession?.access_token || null
    ).catch(() => []),
    sbRest(
      `events?status=eq.live&select=id,name,config,poster_url&limit=20`,
      { method: 'GET' }, currentSession?.access_token || null
    ).catch(() => [])
  ]);

  const availSet = new Set((availRows || []).map(r => r.available_date));
  _vpCurrentAvailSet = availSet;
  _vpAccentColor     = accentColor;
  _vpAccentRgb       = accentRgb;

  // Filter events that mention this venue name (case-insensitive)
  const venueLower = venueName.toLowerCase();
  const venueEvents = (eventRows || [])
    .filter(ev => (ev.config?.venue || '').toLowerCase().includes(venueLower))
    .sort((a, b) => (a.config?.date || '') < (b.config?.date || '') ? -1 : 1)
    .slice(0, 8);

  _renderVenuePublicEvents(venueEvents, accentColor, accentRgb, grad2);
  _renderVenuePublicCalendar(availSet, accentColor, accentRgb);
}

function _renderVenuePublicEvents(events, accentColor, accentRgb, grad2) {
  const el = document.getElementById('venuePublicEvents');
  if (!el) return;

  if (!events.length) {
    el.innerHTML = '';
    return;
  }

  const cards = events.map(ev => {
    const cfg   = ev.config || {};
    const date  = cfg.date  ? new Date(cfg.date + 'T00:00:00').toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short' }) : '';
    const slots = Array.isArray(cfg.slots) ? cfg.slots.filter(s => s.name).length : 0;
    const poster = ev.poster_url || cfg.poster || '';
    return `<div onclick="showPublicEventPage('${ev.id}')"
      style="display:flex;gap:12px;align-items:center;background:rgba(19,19,31,.88);backdrop-filter:blur(10px);border:1px solid rgba(${accentRgb},.2);border-radius:12px;padding:12px;margin-bottom:10px;cursor:pointer;transition:border-color .2s;"
      onmouseenter="this.style.borderColor='rgba(${accentRgb},.6)'" onmouseleave="this.style.borderColor='rgba(${accentRgb},.2)'">
      ${poster
        ? `<img src="${poster}" style="width:52px;height:52px;border-radius:8px;object-fit:cover;flex-shrink:0;">`
        : `<div style="width:52px;height:52px;border-radius:8px;flex-shrink:0;background:linear-gradient(135deg,rgba(${accentRgb},.25),rgba(${accentRgb},.08));display:flex;align-items:center;justify-content:center;">
             <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="${accentColor}" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
           </div>`}
      <div style="flex:1;min-width:0;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(ev.name || 'Untitled Event')}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${[date, slots ? `${slots} artists` : ''].filter(Boolean).join(' · ')}</div>
      </div>
      <div style="color:${accentColor};font-size:18px;flex-shrink:0;">›</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="position:relative;background:rgba(19,19,31,.88);backdrop-filter:blur(10px);border-radius:14px;padding:16px;overflow:hidden;">
      <div style="position:absolute;inset:0;border-radius:14px;padding:1px;background:linear-gradient(135deg,${accentColor},${grad2});-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;"></div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:2px;color:${accentColor};margin-bottom:12px;">UPCOMING EVENTS HERE</div>
      ${cards}
    </div>`;
}

function _renderVenuePublicCalendar(availSet, accentColor, accentRgb) {
  const el = document.getElementById('venuePublicCalendar');
  if (!el) return;

  const today     = new Date().toISOString().split('T')[0];
  const year      = _vpCalMonth.getFullYear();
  const month     = _vpCalMonth.getMonth();
  const monthName = _vpCalMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }).toUpperCase();

  const firstDay  = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDay + 6) % 7; // Mon-first

  const dayLabels = ['M','T','W','T','F','S','S'].map(d =>
    `<div style="text-align:center;font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:1px;color:var(--muted);padding-bottom:4px;">${d}</div>`
  ).join('');

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(`<div></div>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const mm    = String(month + 1).padStart(2, '0');
    const dd    = String(d).padStart(2, '0');
    const dateStr = `${year}-${mm}-${dd}`;
    const isAvail = availSet.has(dateStr);
    const isPast  = dateStr < today;
    const isToday = dateStr === today;

    const bg      = isAvail ? `rgba(${accentRgb},.18)` : 'transparent';
    const color   = isPast ? 'rgba(255,255,255,.2)' : (isAvail ? accentColor : 'var(--muted)');
    const border  = isToday ? `1px solid rgba(255,255,255,.4)` : (isAvail ? `1px solid rgba(${accentRgb},.4)` : '1px solid transparent');
    const dot     = isAvail && !isPast ? `<div style="width:4px;height:4px;border-radius:50%;background:${accentColor};margin:1px auto 0;"></div>` : '';

    const clickable = isAvail && !isPast;
    cells.push(`<div style="text-align:center;padding:4px 0;">
      <div ${clickable ? `onclick="_vpOpenEnquiry('${dateStr}')" ` : ''}style="display:inline-flex;flex-direction:column;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:${bg};border:${border};font-size:12px;color:${color};font-weight:${isAvail?'600':'400'};${clickable?'cursor:pointer;':''}transition:transform .1s,box-shadow .1s;"${clickable ? ` onmouseenter="this.style.transform='scale(1.15)';this.style.boxShadow='0 2px 8px rgba(${accentRgb},.45)'" onmouseleave="this.style.transform='';this.style.boxShadow=''"` : ''}>${d}${dot}</div>
    </div>`);
  }

  const canPrev = new Date(year, month, 1) > new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  el.innerHTML = `
    <div style="position:relative;background:rgba(19,19,31,.88);backdrop-filter:blur(10px);border-radius:14px;padding:16px;overflow:hidden;">
      <div style="position:absolute;inset:0;border-radius:14px;padding:1px;background:linear-gradient(135deg,${accentColor},rgba(${accentRgb},.4));-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:2px;color:${accentColor};">AVAILABILITY</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button onclick="_vpPrevMonth()" ${canPrev?'':'disabled'} style="background:none;border:1px solid rgba(${accentRgb},.3);border-radius:6px;color:${canPrev?accentColor:'rgba(255,255,255,.2)'};width:26px;height:26px;cursor:${canPrev?'pointer':'default'};font-size:14px;line-height:1;padding:0;">‹</button>
          <span style="font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:1px;color:var(--text);min-width:110px;text-align:center;">${monthName}</span>
          <button onclick="_vpNextMonth()" style="background:none;border:1px solid rgba(${accentRgb},.3);border-radius:6px;color:${accentColor};width:26px;height:26px;cursor:pointer;font-size:14px;line-height:1;padding:0;">›</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">
        ${dayLabels}
        ${cells.join('')}
      </div>
      ${availSet.size > 0 ? `<div style="display:flex;align-items:center;gap:6px;margin-top:12px;font-size:11px;color:var(--muted);">
        <div style="width:10px;height:10px;border-radius:3px;background:rgba(${accentRgb},.18);border:1px solid rgba(${accentRgb},.4);flex-shrink:0;"></div>
        Tap a date to enquire
      </div>` : `<div style="text-align:center;padding:8px 0;font-size:12px;color:var(--muted);">No availability set for this month</div>`}
    </div>`;
}

function _vpPrevMonth() {
  _vpCalMonth.setMonth(_vpCalMonth.getMonth() - 1);
  _renderVenuePublicCalendar(_vpCurrentAvailSet, _vpAccentColor, _vpAccentRgb);
}

function _vpNextMonth() {
  _vpCalMonth.setMonth(_vpCalMonth.getMonth() + 1);
  _renderVenuePublicCalendar(_vpCurrentAvailSet, _vpAccentColor, _vpAccentRgb);
}

let _vpCurrentAvailSet  = new Set();
let _vpAccentColor      = '#00E5A0';
let _vpAccentRgb        = '0,229,160';
let _vpVenueName        = '';
let _vpVenueContact     = null;
let _vpVenueUserId      = null;

function _vpOpenEnquiry(dateStr) {
  if (!currentUser?.id) { showToast('Sign in to send an enquiry', 'error'); return; }

  const pretty = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const accent = _vpAccentColor;
  const rgb    = _vpAccentRgb;

  // Pick the right profile based on current mode
  const mode = typeof currentMode !== 'undefined' ? currentMode : 'artist';
  let myName = '', myGenre = '', myAvatar = '', mySound = '', myLocation = '';
  if (mode === 'band' && typeof bandProfile !== 'undefined' && bandProfile?.name) {
    myName = bandProfile.name; myGenre = bandProfile.genre_string || bandProfile.band_type || ''; myAvatar = bandProfile.avatar || ''; mySound = bandProfile.sound || ''; myLocation = bandProfile.location || '';
  } else if (mode === 'standup' && typeof standupProfile !== 'undefined' && standupProfile?.name) {
    myName = standupProfile.name; myGenre = standupProfile.genre_string || standupProfile.act_type || ''; myAvatar = standupProfile.avatar || ''; mySound = standupProfile.sound || ''; myLocation = standupProfile.location || '';
  } else if (typeof artistProfile !== 'undefined' && artistProfile) {
    myName = artistProfile.djName || artistProfile.name || ''; myGenre = artistProfile.genreString || ''; myAvatar = artistProfile.avatar || ''; mySound = artistProfile.sound || ''; myLocation = artistProfile.location || '';
  }

  const avatarHtml = myAvatar
    ? `<img src="${myAvatar}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;border:2px solid ${accent};flex-shrink:0;">`
    : `<div style="width:48px;height:48px;border-radius:8px;background:rgba(${rgb},.12);border:2px solid rgba(${rgb},.4);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:20px;">🎵</div>`;

  const profilePreview = myName ? `
    <div style="display:flex;gap:12px;align-items:center;background:rgba(255,255,255,.05);border:1px solid rgba(${rgb},.25);border-radius:12px;padding:12px;margin-bottom:16px;">
      ${avatarHtml}
      <div style="flex:1;min-width:0;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:1px;">${myName}</div>
        ${myLocation ? `<div style="font-size:11px;color:var(--muted);">${myLocation}</div>` : ''}
        ${myGenre ? `<div style="font-size:11px;color:${accent};margin-top:2px;">${myGenre.split(' · ').slice(0,3).join(' · ')}</div>` : ''}
        ${mySound ? `<div style="font-size:11px;color:var(--muted);font-style:italic;margin-top:2px;">${mySound.slice(0,60)}${mySound.length>60?'…':''}</div>` : ''}
      </div>
    </div>` : '';

  const old = document.getElementById('_vpEnquirySheet');
  if (old) old.remove();

  const sheet = document.createElement('div');
  sheet.id = '_vpEnquirySheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;justify-content:flex-end;';
  sheet.innerHTML = `
    <div onclick="_vpCloseEnquiry()" style="position:absolute;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);"></div>
    <div style="position:relative;background:#13131f;border-radius:20px 20px 0 0;padding:24px 20px 36px;max-width:520px;width:100%;margin:0 auto;max-height:85dvh;overflow-y:auto;">
      <div style="width:36px;height:4px;background:rgba(255,255,255,.2);border-radius:2px;margin:0 auto 20px;"></div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:2px;color:${accent};margin-bottom:4px;">ENQUIRE ABOUT THIS DATE</div>
      <div style="font-size:20px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;margin-bottom:16px;">${pretty}</div>
      ${profilePreview}
      <textarea id="_vpEnquiryNote" placeholder="Add a message — anything extra the venue should know…" style="width:100%;min-height:90px;background:rgba(255,255,255,.06);border:1px solid rgba(${rgb},.35);border-radius:12px;color:#e8e8f0;font-size:14px;padding:12px;resize:none;font-family:inherit;box-sizing:border-box;"></textarea>
      <button id="_vpEnquirySubmitBtn" onclick="_vpSendEnquiry('${dateStr}')"
        style="margin-top:12px;width:100%;background:linear-gradient(135deg,${accent},#00B4D8);color:#0a0a14;font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:2px;padding:16px;border:none;border-radius:12px;cursor:pointer;font-weight:700;">
        SEND ENQUIRY →
      </button>
      <button onclick="_vpCloseEnquiry()" style="margin-top:8px;width:100%;background:none;border:none;color:var(--muted);font-size:13px;cursor:pointer;padding:8px;">Cancel</button>
    </div>`;
  document.body.appendChild(sheet);
}

function _vpCloseEnquiry() {
  const sheet = document.getElementById('_vpEnquirySheet');
  if (sheet) sheet.remove();
}

async function _vpSendEnquiry(dateStr) {
  if (!currentUser?.id || !_vpVenueUserId) { showToast('Unable to send — please try again', 'error'); return; }
  const note = (document.getElementById('_vpEnquiryNote')?.value || '').trim();
  const btn  = document.getElementById('_vpEnquirySubmitBtn');

  const mode = typeof currentMode !== 'undefined' ? currentMode : 'artist';
  const applicantType = ['band','standup','artist','host','punter'].includes(mode) ? mode : 'artist';

  if (btn) { btn.disabled = true; btn.textContent = 'SENDING…'; }

  try {
    await sbRest('venue_enquiries', {
      method: 'POST',
      body: JSON.stringify({
        venue_user_id:     _vpVenueUserId,
        applicant_user_id: currentUser.id,
        applicant_type:    applicantType,
        date_requested:    dateStr,
        note:              note || null,
        status:            'pending'
      }),
      prefer: 'resolution=merge-duplicates,return=minimal'
    }, currentSession?.access_token);
    _vpCloseEnquiry();
    showToast('Enquiry sent! The venue will be in touch.', 'success');
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'SEND ENQUIRY →'; }
    if (e.message?.includes('duplicate') || e.message?.includes('unique')) {
      showToast('You\'ve already enquired about this date', 'error');
      _vpCloseEnquiry();
    } else {
      showToast('Failed to send — please try again', 'error');
    }
  }
}
