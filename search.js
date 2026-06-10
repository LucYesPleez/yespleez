// ═══════════════════════════════════════════════════
//  search.js — YesPleez Search Module
//  Handles event + profile search and results rendering
//  Depends on: state.js, profiles.js, events.js, navigation.js
// ═══════════════════════════════════════════════════

// ── Event search ───────────────────────────────────

async function searchEvents(query) {
  try {
    let path = `events?select=*&status=eq.live&is_public=neq.false`;
    if (query && query.trim()) {
      const q = encodeURIComponent(`%${query.trim()}%`);
      path += `&or=(name.ilike.${q},config->>venue.ilike.${q},config->>postcode.ilike.${q},config->>genres.ilike.${q})`;
    }
    path += `&order=created_at.desc&limit=50`;
    const rows = await sbRest(path, { method: 'GET' }, currentSession?.access_token || null);
    return rows || [];
  } catch(e) {
    console.warn('Event search failed:', e.message);
    return [];
  }
}

// ── Artist assignment search (host assigning to slot) ─

async function searchArtistsForAssign(q) {
  const resultsEl = document.getElementById('hostArtistResults');
  if (!q || q.length < 2) { resultsEl.style.display = 'none'; return; }
  try {
    const enc = encodeURIComponent(`%${q}%`);
    const rows = await sbRest(
      `profiles?type=eq.artist&or=(dj_name.ilike.${enc},name.ilike.${enc})&limit=10`,
      { method: 'GET' },
      currentSession?.access_token || null
    );
    if (!rows || !rows.length) { resultsEl.style.display = 'none'; return; }
    resultsEl.innerHTML = rows.map(r => `
      <div onclick="selectArtistForAssign(${JSON.stringify(r).replace(/"/g,'&quot;')})"
        style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;"
        onmouseenter="this.style.background='rgba(0,229,255,.08)'" onmouseleave="this.style.background=''">
        ${r.avatar ? `<img src="${r.avatar}" style="width:32px;height:32px;border-radius:4px;object-fit:cover;">` : `<div style="width:32px;height:32px;border-radius:4px;background:var(--card);display:flex;align-items:center;justify-content:center;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg></div>`}
        <div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:1px;">${r.dj_name || r.name}</div>
          ${r.genre_string ? `<div style="font-size:11px;color:var(--muted);">${r.genre_string.split(' · ').slice(0,3).join(' · ')}</div>` : ''}
        </div>
      </div>
    `).join('');
    resultsEl.style.display = '';
  } catch(e) {
    resultsEl.style.display = 'none';
  }
}

function selectArtistForAssign(row) {
  document.getElementById('hostArtistResults').style.display = 'none';
  document.getElementById('hostArtistSearch').value = '';
  const nameEl  = document.getElementById('hostArtistSelectedName');
  const genreEl = document.getElementById('hostArtistSelectedGenre');
  const selEl   = document.getElementById('hostArtistSelected');
  if (nameEl)  nameEl.textContent  = row.dj_name || row.name;
  if (genreEl) genreEl.textContent = row.genre_string ? row.genre_string.split(' · ').slice(0,3).join(' · ') : '';
  if (selEl)   selEl.style.display = 'flex';
  // Pre-fill the manual name + genre fields
  document.getElementById('inputName').value = row.dj_name || row.name || '';
  const genreMain = document.getElementById('inputGenreMain');
  if (genreMain && row.genre_string) {
    const firstGenre = row.genre_string.split(' · ')[0];
    for (let opt of genreMain.options) {
      if (opt.value === firstGenre) { genreMain.value = firstGenre; updateSubgenres(); break; }
    }
  }
  // Store mix link for potential use
  if (row.mix_link) window._assignMixLink = row.mix_link;
}

function clearArtistSelection() {
  const selEl = document.getElementById('hostArtistSelected');
  if (selEl) selEl.style.display = 'none';
  window._assignMixLink = null;
}

// ── Open public event view (from discover) ─────────

async function openPublicEvent(ev) {
  const ok = await loadPublicEvent(ev.id);
  if (!ok) return;
  showSignup();
}

// ── Full unified search (events + profiles) ────────

// ── Availability date filter toggle ───────────────
function toggleAvailFilter() {
  const dateEl   = document.getElementById('searchAvailDate');
  const toggleEl = document.getElementById('searchAvailToggle');
  const isOpen   = dateEl.style.display !== 'none';
  if (isOpen) {
    dateEl.style.display = 'none';
    dateEl.value = '';
    toggleEl.style.color = 'var(--muted)';
    toggleEl.style.borderColor = 'var(--border)';
    runSearch();
  } else {
    dateEl.style.display = '';
    toggleEl.style.color = 'var(--neon2)';
    toggleEl.style.borderColor = 'var(--neon2)';
    dateEl.focus();
  }
}

async function runSearch() {
  const query       = document.getElementById('searchInput').value.trim();
  const typeFilter  = document.getElementById('searchTypeFilter').value;
  const stateFilter = document.getElementById('searchStateFilter').value;
  const availDate   = document.getElementById('searchAvailDate')?.value || ''; // 'YYYY-MM-DD' or ''
  const resultsEl   = document.getElementById('searchResults');
  const placeholder = document.getElementById('searchPlaceholder');

  placeholder.style.display = 'none';
  resultsEl.innerHTML = '';
  resultsEl.insertAdjacentHTML('beforeend', '<div class="search-card" id="searchLoading" style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Loading…</div>');

  // Normalise type filter — dropdown may say 'dj' but DB stores 'artist'
  const typeMap = { dj: 'artist', DJ: 'artist', artist: 'artist', host: 'host', promoter: 'host', band: 'band', muso: 'band', standup: 'standup', comedy: 'standup', venue: 'venue' };
  const normType = typeMap[typeFilter] || typeFilter;

  const searchingProfiles = normType !== 'event';
  const searchingEvents   = normType === 'all' || normType === 'event';
  // If filtering by availability, only show artists
  const effectiveProfileType = availDate
    ? 'artist'
    : ((normType && normType !== 'all' && normType !== 'event') ? normType : '');

  let [profileRows, eventRows] = await Promise.all([
    searchingProfiles ? searchProfiles(query, effectiveProfileType, stateFilter === 'all' ? '' : stateFilter) : [],
    (searchingEvents && !availDate) ? searchEvents(query) : []
  ]);

  // Filter profiles by availability date
  if (availDate && profileRows.length) {
    try {
      const availRows = await sbRest(
        `artist_availability?available_date=eq.${availDate}&select=user_id`,
        { method: 'GET' }, currentSession?.access_token || null
      );
      const availableIds = new Set((availRows || []).map(r => r.user_id));
      profileRows = profileRows.filter(p => availableIds.has(p.user_id));
    } catch(e) { console.warn('avail filter:', e); }
  }

  document.getElementById('searchLoading')?.remove();

  if (!profileRows.length && !eventRows.length) {
    const msg = availDate
      ? `No artists marked available on ${new Date(availDate + 'T12:00:00').toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long'})}.<br><span style="font-size:11px;">Try a different date or remove the availability filter.</span>`
      : 'No results found.<br><span style="font-size:11px;">Try a different search or filter.</span>';
    resultsEl.insertAdjacentHTML('beforeend', `<div class="search-card" style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">${msg}</div>`);
    return;
  }

  const allItems = [
    ...eventRows.map(ev => ({ _type: 'event', _ts: ev.created_at || ev.updated_at || '', ...ev })),
    ...profileRows.map(row => ({ _type: 'profile', _ts: row.updated_at || row.created_at || '', ...row }))
  ].sort((a, b) => (b._ts > a._ts ? 1 : -1));

  if (availDate) {
    const dateLabel = new Date(availDate + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
    resultsEl.insertAdjacentHTML('afterbegin', `<div style="font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:2px;color:var(--neon2);padding:0 0 12px;">AVAILABLE ON ${dateLabel.toUpperCase()} · ${profileRows.length} ARTIST${profileRows.length!==1?'S':''}</div>`);
  } else if (!query && normType === 'all' && stateFilter === 'all') {
    resultsEl.insertAdjacentHTML('afterbegin', '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:11px;letter-spacing:2px;color:var(--muted);padding:0 0 12px;">RECENTLY ADDED</div>');
  }

  allItems.forEach(item => {
    const card = item._type === 'event'
      ? buildEventCardEl(item, 'discover')
      : buildProfileCardEl(item);
    resultsEl.appendChild(card);
  });
}

// ── Apply to event modal ───────────────────────────

let _applyEventId   = null;
let _applyEventName = '';

// ── Email helper (calls Supabase Edge Function) ────
async function sendEmail(type, data) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/rapid-responder`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ type, data })
    });
    if (!res.ok) console.warn('sendEmail response:', res.status, await res.text());
  } catch(e) { console.warn('sendEmail failed:', e.message); }
}

// ── Apply modal state ──────────────────────────────
let _applyGuestData = null; // stores guest form data after submit, for profile save

function _applyShowPanel(name) {
  ['applyFormPanel','applySavePanel','applyBrowsePanel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === name ? '' : 'none';
  });
}

function openApplyModalForEvent(eventId, eventName) {
  _applyEventId   = eventId;
  _applyEventName = eventName;
  _applyGuestData = null;

  document.getElementById('applyEventName').textContent = eventName || '';
  document.getElementById('applyModalHeading').textContent = 'APPLY TO PLAY';
  document.getElementById('applyNote').value = '';
  _applyShowPanel('applyFormPanel');

  const isLoggedIn = currentUser?.id && currentUser.id !== 'guest';

  if (isLoggedIn && (artistProfile?.djName || artistProfile?.name)) {
    // ── One-click: show saved profile preview ──
    const p = artistProfile || {};
    const name     = p.djName || p.name || '';
    const genres   = (p.genreString || '').split(' · ').filter(Boolean).slice(0, 5);
    const pillsHtml = genres.map(g => `<span class="dj-pill">${g}</span>`).join('');
    const avatarHtml = p.avatar
      ? `<img src="${p.avatar}" style="width:48px;height:48px;border-radius:6px;object-fit:cover;border:2px solid var(--neon2);flex-shrink:0;">`
      : `<div style="width:48px;height:48px;border-radius:6px;background:var(--card);border:2px solid var(--neon2);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--neon2);"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg></div>`;
    document.getElementById('applyProfilePreview').innerHTML = `
      <div style="display:flex;gap:12px;align-items:flex-start;">
        ${avatarHtml}
        <div style="flex:1;min-width:0;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1px;">${esc(name)}</div>
          ${p.location ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${esc(p.location)}</div>` : ''}
          ${pillsHtml ? `<div class="dj-pills" style="margin-top:6px;">${pillsHtml}</div>` : ''}
          ${p.sound ? `<div style="font-size:12px;color:var(--neon2);font-style:italic;margin-top:6px;">${esc(p.sound)}</div>` : ''}
          ${p.mixLink ? `<div style="font-size:11px;color:var(--neon2);margin-top:4px;display:flex;align-items:center;gap:4px;"><svg viewBox="0 0 24 24" width="11" height="11" fill="var(--neon2)"><polygon points="6,3 20,12 6,21"/></svg>Mix included</div>` : ''}
        </div>
      </div>`;
    document.getElementById('applyProfilePreview').style.display = '';
    document.getElementById('applyGuestForm').style.display = 'none';
  } else {
    // ── Guest: show fill-in form ──
    document.getElementById('applyProfilePreview').style.display = 'none';
    document.getElementById('applyGuestForm').style.display = '';
    // Clear guest fields
    ['applyGuestName','applyGuestEmail','applyGuestGenre','applyGuestSound','applyGuestMixLink'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  }

  document.getElementById('applyOverlay').classList.add('open');
}

function closeApplyModal() {
  document.getElementById('applyOverlay').classList.remove('open');
  _applyEventId = null;
  _applyGuestData = null;
}

async function submitApplication() {
  if (!_applyEventId) return;
  const btn  = document.getElementById('applySubmitBtn');
  const note = document.getElementById('applyNote')?.value.trim() || '';
  const isLoggedIn = currentUser?.id && currentUser.id !== 'guest';

  // Guest validation
  if (!isLoggedIn) {
    const name  = document.getElementById('applyGuestName')?.value.trim() || '';
    const email = document.getElementById('applyGuestEmail')?.value.trim() || '';
    if (!name)  { showToast('Please enter your DJ name', 'error'); document.getElementById('applyGuestName')?.focus(); return; }
    if (!email) { showToast('Please enter your email', 'error'); document.getElementById('applyGuestEmail')?.focus(); return; }
  }

  btn.disabled = true; btn.textContent = 'SUBMITTING...';

  try {
    let body;
    if (isLoggedIn) {
      body = { event_id: _applyEventId, artist_id: currentUser.id, note, status: 'pending' };
    } else {
      const gName     = document.getElementById('applyGuestName')?.value.trim() || '';
      const gEmail    = document.getElementById('applyGuestEmail')?.value.trim() || '';
      const gGenre    = document.getElementById('applyGuestGenre')?.value.trim() || '';
      const gSound    = document.getElementById('applyGuestSound')?.value.trim() || '';
      const gMixLink  = document.getElementById('applyGuestMixLink')?.value.trim() || '';
      _applyGuestData = { name: gName, email: gEmail, genre: gGenre, sound: gSound, mixLink: gMixLink };
      body = { event_id: _applyEventId, artist_id: null, note, status: 'pending',
               guest_name: gName, guest_email: gEmail, guest_genre: gGenre || null,
               guest_sound: gSound || null, guest_mix_link: gMixLink || null };
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/applications`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${currentSession?.access_token || SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(body)
    });

    console.log('[apply] POST status:', res.status);
    if (res.ok || res.status === 201) {
      _hasApplied = true;
      if (typeof updateApplyBarState === 'function') updateApplyBarState();
      if (typeof renderAll === 'function') renderAll();

      if (isLoggedIn) {
        const p = artistProfile || {};
        const artistName = p.djName || p.name || currentUser?.email || 'Artist';
        const artistEmail = p.email || currentUser?.email || '';
        console.log('[apply] sending logged-in emails for', artistName);
        sendEmail('application_received', { artistName, eventName: _applyEventName });
        sendEmail('new_application', { artistName, artistEmail, eventName: _applyEventName, note });
        closeApplyModal();
        showToast('Application sent! ✓', 'success');
      } else {
        console.log('[apply] sending guest emails for', _applyGuestData?.name);
        sendEmail('application_received', { artistName: _applyGuestData.name, eventName: _applyEventName });
        sendEmail('new_application', { artistName: _applyGuestData.name, artistEmail: _applyGuestData.email, eventName: _applyEventName, note });
        // Show save profile prompt
        _applyShowPanel('applySavePanel');
        document.getElementById('applyModalHeading').textContent = 'ONE MORE THING';
        const saveEventEl = document.getElementById('applySaveEventName');
        if (saveEventEl) saveEventEl.textContent = `You've applied to ${_applyEventName || 'the event'} ✓`;
        document.getElementById('applySavePassword').value = '';
        const errEl = document.getElementById('applySaveErr'); if (errEl) errEl.style.display = 'none';
      }
    } else {
      const errText = await res.text().catch(() => '');
      console.error('[apply] POST failed:', res.status, errText);
      try {
        const err = JSON.parse(errText);
        if (err.code === '23505') showToast('You\'ve already applied to this event', 'error');
        else showToast(`Error: ${err.message || res.status}`, 'error');
      } catch { showToast(`Error ${res.status}`, 'error'); }
    }
  } catch(e) {
    showToast(`Failed: ${e.message}`, 'error');
  }
  btn.disabled = false; btn.textContent = 'SEND APPLICATION →';
}

async function saveGuestProfile() {
  if (!_applyGuestData) return;
  const password = document.getElementById('applySavePassword')?.value.trim() || '';
  const errEl    = document.getElementById('applySaveErr');
  if (password.length < 6) {
    if (errEl) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = ''; }
    return;
  }
  const btn = document.getElementById('applySaveBtn');
  btn.disabled = true; btn.textContent = 'SAVING...';

  const { name, email, genre, sound, mixLink } = _applyGuestData;
  try {
    // Create Supabase auth account
    const authRes = await sbAuthPost('signup', { email, password });
    if (authRes.error || !authRes.access_token) {
      const msg = authRes.error_description || authRes.msg || 'Signup failed — try again.';
      if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
      btn.disabled = false; btn.textContent = 'SAVE MY PROFILE →';
      return;
    }
    currentSession = authRes;
    currentUser    = authRes.user;
    localStorage.setItem('yp_session', JSON.stringify(authRes));

    // Create profile row from guest data
    await sbRest('profiles', {
      method: 'POST',
      body: JSON.stringify({ user_id: authRes.user.id, email, dj_name: name, genre_string: genre || null, sound: sound || null, mix_link: mixLink || null, type: 'artist' }),
      prefer: 'resolution=merge-duplicates,return=minimal'
    }, authRes.access_token).catch(() => {});

    // Link the application to the new account
    await fetch(`${SUPABASE_URL}/rest/v1/applications?event_id=eq.${_applyEventId}&guest_email=eq.${encodeURIComponent(email)}&artist_id=is.null`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${authRes.access_token}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ artist_id: authRes.user.id })
    }).catch(() => {});

    // Load the new profile into app state
    artistProfile = { djName: name, genreString: genre || '', sound: sound || '', mixLink: mixLink || '' };
    currentMode = 'artist';

    closeApplyModal();
    showToast(`Welcome to YesPleez, ${name}! 🎧`, 'success', 5000);
  } catch(e) {
    if (errEl) { errEl.textContent = 'Something went wrong — try again.'; errEl.style.display = ''; }
  }
  btn.disabled = false; btn.textContent = 'SAVE MY PROFILE →';
}

function skipSaveProfile() {
  _applyShowPanel('applyBrowsePanel');
  document.getElementById('applyModalHeading').textContent = "YOU'RE IN";
}
