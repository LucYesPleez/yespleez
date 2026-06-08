// ═══════════════════════════════════════════════════
//  search.js — YesPleez Search Module
//  Handles event + profile search and results rendering
//  Depends on: state.js, profiles.js, events.js, navigation.js
// ═══════════════════════════════════════════════════

// ── Event search ───────────────────────────────────

async function searchEvents(query) {
  try {
    let path = `events?select=*`;
    if (query && query.trim()) {
      const q = encodeURIComponent(`%${query.trim()}%`);
      path += `&or=(name.ilike.${q},config->>venue.ilike.${q})`;
    } else {
      path += `&status=eq.live`;
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
        ${r.avatar ? `<img src="${r.avatar}" style="width:32px;height:32px;border-radius:4px;object-fit:cover;">` : `<div style="width:32px;height:32px;border-radius:4px;background:var(--card);display:flex;align-items:center;justify-content:center;font-size:16px;">🎧</div>`}
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

async function runSearch() {
  const query       = document.getElementById('searchInput').value.trim();
  const typeFilter  = document.getElementById('searchTypeFilter').value;
  const stateFilter = document.getElementById('searchStateFilter').value;
  const resultsEl   = document.getElementById('searchResults');
  const placeholder = document.getElementById('searchPlaceholder');

  placeholder.style.display = 'none';
  resultsEl.innerHTML = '';
  resultsEl.insertAdjacentHTML('beforeend', '<div class="search-card" id="searchLoading" style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Loading…</div>');

  // Normalise type filter — dropdown may say 'dj' but DB stores 'artist'
  const typeMap = { dj: 'artist', DJ: 'artist', artist: 'artist', host: 'host', promoter: 'host' };
  const normType = typeMap[typeFilter] || typeFilter;

  const searchingProfiles = normType !== 'event';
  const searchingEvents   = normType === 'all' || normType === 'event';
  const profileType       = (normType && normType !== 'all' && normType !== 'event') ? normType : '';

  const [profileRows, eventRows] = await Promise.all([
    searchingProfiles ? searchProfiles(query, profileType, stateFilter === 'all' ? '' : stateFilter) : [],
    searchingEvents   ? searchEvents(query) : []
  ]);

  document.getElementById('searchLoading')?.remove();

  if (!profileRows.length && !eventRows.length) {
    resultsEl.insertAdjacentHTML('beforeend', '<div class="search-card" style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">No results found.<br><span style="font-size:11px;">Try a different search or filter.</span></div>');
    return;
  }

  const allItems = [
    ...eventRows.map(ev => ({ _type: 'event', _ts: ev.created_at || ev.updated_at || '', ...ev })),
    ...profileRows.map(row => ({ _type: 'profile', _ts: row.updated_at || row.created_at || '', ...row }))
  ].sort((a, b) => (b._ts > a._ts ? 1 : -1));

  if (!query && normType === 'all' && stateFilter === 'all') {
    resultsEl.insertAdjacentHTML('afterbegin', '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:11px;letter-spacing:2px;color:var(--muted);padding:0 0 12px;">RECENTLY ADDED</div>');
  }

  allItems.forEach(item => {
    const card = document.createElement('div');

    if (item._type === 'event') {
      // ── Event card: exact same structure as host dashboard renderEventList ──
      const ev = item;
      const cfg = ev.config || {};
      const slotCount = (cfg.days || []).reduce((n, d) => n + d.slots.length, 0);
      const isLive = ev.status === 'live';
      const poster = cfg.poster || ev.poster || '';
      const focal  = cfg.poster_focal || '50% 50%';
      card.className = 'event-card' + (isLive ? ' active-event' : '');
      card.style.overflow = 'hidden';
      card.style.padding = '0';
      card.style.display = 'block';
      card.style.marginBottom = '12px';
      card.innerHTML = `
        <div style="position:relative;min-height:90px;overflow:hidden;border-radius:inherit;width:100%;">
          ${poster ? `
            <div style="position:absolute;inset:0;background:url(${poster}) ${focal}/cover no-repeat;"></div>
            <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(10,10,20,.92) 0%,rgba(10,10,20,.55) 50%,rgba(10,10,20,.80) 100%);"></div>
          ` : ''}
          <div style="position:relative;display:flex;align-items:stretch;min-height:90px;">
            <div class="event-card-info" style="min-width:0;flex:1;padding:14px 12px;display:flex;flex-direction:column;justify-content:center;">
              <div class="event-card-name">${ev.name || 'Untitled Event'}</div>
              <div class="event-card-meta">${[cfg.date, cfg.venue].filter(Boolean).join(' · ')}${slotCount ? ' · ' + slotCount + ' slots' : ''}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:8px;flex-shrink:0;padding:14px 12px;">
              <span class="event-card-status ${isLive ? 'live' : 'draft'}">${isLive ? 'LIVE' : 'UPCOMING'}</span>
              <button class="btn-signout" style="font-size:10px;padding:4px 12px;">VIEW →</button>
            </div>
          </div>
        </div>`;
      card.onclick = (e) => { if (!e.target.closest('button')) openPublicEvent(ev); };
      card.querySelector('.btn-signout').onclick = (e) => { e.stopPropagation(); openPublicEvent(ev); };

    } else {
      // ── Profile card: exact same structure as dash-profile-card ──
      const row = item;
      const isHostRow = row.type === 'host';
      const name     = row.dj_name || row.name || 'Unknown';
      const location = [row.location, row.state].filter(Boolean).join(', ');
      const genres   = row.genre_string ? row.genre_string.split(' · ').slice(0, 4).join(' · ') : '';
      const sound    = row.sound || '';
      const bio      = row.bio ? row.bio.substring(0, 80) + (row.bio.length > 80 ? '…' : '') : '';
      const accentCol = isHostRow ? 'var(--neon)' : 'var(--neon2)';
      const accentRgb = isHostRow ? '255,45,120'  : '0,229,255';
      const emoji     = isHostRow ? '🎛️' : '🎧';
      const badge = isHostRow
        ? `<span style="background:rgba(255,45,120,.15);color:var(--neon);border:1px solid rgba(255,45,120,.3);border-radius:20px;font-size:10px;padding:2px 8px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">HOST</span>`
        : `<span style="background:rgba(0,229,255,.12);color:var(--neon2);border:1px solid rgba(0,229,255,.25);border-radius:20px;font-size:10px;padding:2px 8px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">ARTIST</span>`;
      const avatarHtml = row.avatar
        ? `<img src="${row.avatar}" style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid var(--border);flex-shrink:0;" onerror="this.outerHTML='<div class=\\'dash-profile-avatar\\'>${emoji}</div>'">`
        : `<div class="dash-profile-avatar">${emoji}</div>`;
      card.className = 'dash-profile-card';
      card.style.marginBottom = '12px';
      card.innerHTML = `
        ${avatarHtml}
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px;">
            <span style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</span>
            ${badge}
          </div>
          ${location ? `<div style="font-size:12px;color:var(--muted);margin-bottom:3px;">📍 ${location}</div>` : ''}
          ${sound    ? `<div style="font-size:12px;color:${accentCol};margin-bottom:3px;">${sound}</div>` : genres ? `<div style="font-size:12px;color:${accentCol};margin-bottom:3px;">${genres}</div>` : ''}
          ${bio      ? `<div style="font-size:12px;color:var(--muted);line-height:1.5;">${bio}</div>` : ''}
        </div>`;
      card.onclick = () => openPublicProfile(row);
      card.onmouseenter = () => { card.style.borderColor = accentCol; };
      card.onmouseleave = () => { card.style.borderColor = ''; };
    }

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
    : `<div style="width:52px;height:52px;border-radius:6px;background:var(--card);border:2px solid var(--neon2);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">🎧</div>`;
  document.getElementById('applyProfilePreview').innerHTML = `
    <div style="display:flex;gap:12px;align-items:flex-start;">
      ${avatarHtml}
      <div style="flex:1;min-width:0;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;">${name}</div>
        ${p.location ? `<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">📍 ${p.location}</div>` : ''}
        ${pillsHtml ? `<div class="dj-pills" style="margin-top:4px;">${pillsHtml}</div>` : ''}
        ${p.sound ? `<div style="font-size:12px;color:var(--neon2);font-style:italic;margin-top:6px;">${p.sound}</div>` : ''}
        ${p.mixLink ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">▶ Mix link included</div>` : ''}
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
