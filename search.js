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
      const { data } = await supabase
        .from('artist_availability')
        .select('user_id')
        .eq('available_date', availDate);
      const availableIds = new Set((data || []).map(r => r.user_id));
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

function openApplyModalForEvent(eventId, eventName) {
  if (!currentUser?.id || currentUser.id === 'guest') {
    showToast('Sign in to apply for events', 'error'); return;
  }
  _applyEventId = eventId;
  _applyEventName = eventName;
  document.getElementById('applyEventName').textContent = eventName;

  // Build profile preview
  const p = artistProfile || {};
  const name     = p.djName || p.name || 'Your DJ name';
  const genres   = (p.genreString || '').split(' · ').filter(Boolean).slice(0, 5);
  const pillsHtml = genres.map(g => `<span class="dj-pill">${g}</span>`).join('');
  const avatarHtml = p.avatar
    ? `<img src="${p.avatar}" style="width:52px;height:52px;border-radius:6px;object-fit:cover;border:2px solid var(--neon2);flex-shrink:0;">`
    : `<div style="width:52px;height:52px;border-radius:6px;background:var(--card);border:2px solid var(--neon2);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg></div>`;
  document.getElementById('applyProfilePreview').innerHTML = `
    <div style="display:flex;gap:12px;align-items:flex-start;">
      ${avatarHtml}
      <div style="flex:1;min-width:0;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;">${name}</div>
        ${p.location ? `<div style="font-size:11px;color:var(--muted);margin-bottom:4px;"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px;"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>${p.location}</div>` : ''}
        ${pillsHtml ? `<div class="dj-pills" style="margin-top:4px;">${pillsHtml}</div>` : ''}
        ${p.sound ? `<div style="font-size:12px;color:var(--neon2);font-style:italic;margin-top:6px;">${p.sound}</div>` : ''}
        ${p.mixLink ? `<div style="font-size:11px;color:var(--neon2);margin-top:4px;display:flex;align-items:center;gap:4px;"><svg viewBox="0 0 24 24" width="11" height="11" fill="var(--neon2)"><polygon points="6,3 20,12 6,21"/></svg>Mix link included</div>` : ''}
      </div>
    </div>`;

  document.getElementById('applyOverlay').classList.add('open');
}

function closeApplyModal() {
  document.getElementById('applyOverlay').classList.remove('open');
  _applyEventId = null;
}

async function submitApplication() {
  if (!_applyEventId) return;
  const btn = document.getElementById('applySubmitBtn');
  btn.disabled = true; btn.textContent = 'SUBMITTING...';
  const noteEl = document.getElementById('applyNote');
  const note = noteEl ? noteEl.value.trim() : '';
  try {
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${currentSession.access_token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/applications`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event_id:  _applyEventId,
        artist_id: currentUser.id,
        note:      note,
        status:    'pending'
      })
    });
    if (res.ok || res.status === 201) {
      closeApplyModal();
      showToast('Application sent! The promoter will be in touch ✓', 'success');
      _hasApplied = true;
      if (typeof updateApplyBarState === 'function') updateApplyBarState();
      if (typeof renderAll === 'function') renderAll();
    } else {
      const err = await res.json().catch(() => ({}));
      if (err.code === '23505') {
        showToast('You\'ve already applied to this event', 'error');
      } else {
        showToast(`Error: ${err.message || res.status}`, 'error');
      }
    }
  } catch(e) {
    showToast(`Failed: ${e.message}`, 'error');
  }
  btn.disabled = false; btn.textContent = 'SEND APPLICATION →';
}
