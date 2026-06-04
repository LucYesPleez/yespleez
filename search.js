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

function openPublicEvent(ev) {
  const cfg = ev.config || {};
  const venue = cfg.venue || '';
  const date = cfg.date || '';
  const genres = cfg.genres || '';
  const isOpen = ev.status === 'live';
  const canApply = currentMode === 'artist' && currentUser?.id && currentUser.id !== 'guest';
  const poster = cfg.poster || ev.poster || '';

  const slotRowsHtml = (cfg.days || []).map(day => {
    const slots = day.slots || [];
    if (!slots.length) return '';
    return `
      <div style="margin-bottom:20px;">
        ${day.label || day.name ? `<div style="font-family:'Bebas Neue',sans-serif;font-size:12px;letter-spacing:3px;color:var(--neon);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border);">${day.label || day.name}</div>` : ''}
        ${slots.map(slot => {
          const claimed = slot.artistName || null;
          const genre = slot.genre || '';
          const isSpecial = slot.label && !slot.label.toLowerCase().includes('lounge');
          const isLounge = slot.label?.toLowerCase().includes('lounge');
          const borderCol = claimed ? (isLounge ? 'var(--neon2)' : isSpecial ? 'var(--gold)' : 'var(--neon)') : 'var(--border)';
          const bgCol = claimed ? (isLounge ? 'rgba(0,229,255,.05)' : isSpecial ? 'rgba(255,184,48,.05)' : 'rgba(255,45,120,.05)') : 'rgba(255,255,255,.02)';
          return `
          <div style="display:flex;align-items:stretch;border:1px solid ${borderCol};border-radius:10px;margin-bottom:8px;overflow:hidden;background:${bgCol};">
            <div style="background:${claimed ? borderCol : 'var(--card2)'};padding:10px 12px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:60px;flex-shrink:0;">
              <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;line-height:1;color:${claimed ? '#0a0a0f' : 'var(--muted)'};">${slot.time || '--'}</div>
              <div style="font-size:9px;color:${claimed ? 'rgba(10,10,15,.7)' : 'var(--muted)'};letter-spacing:1px;">${slot.ampm || ''}</div>
              <div style="font-size:9px;color:${claimed ? 'rgba(10,10,15,.6)' : 'var(--muted)'};margin-top:2px;">${slot.dur || slot.duration || ''}</div>
            </div>
            <div style="flex:1;padding:10px 12px;min-width:0;">
              ${claimed
                ? `<div style="font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:.5px;">🎧 ${claimed}</div>${genre ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;line-height:1.4;">${genre}</div>` : ''}`
                : `<div style="font-size:13px;color:var(--muted);font-style:italic;">Open slot</div>`}
              ${slot.label ? `<div style="margin-top:4px;display:inline-block;font-size:10px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:${isLounge ? 'var(--neon2)' : 'var(--gold)'};border:1px solid ${isLounge ? 'var(--neon2)' : 'var(--gold)'};border-radius:20px;padding:2px 8px;">${slot.label}</div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }).join('');

  document.getElementById('publicEventContent').innerHTML = `
    ${poster ? `<div style="width:100%;aspect-ratio:1;background:url(${poster}) center/cover no-repeat;border-radius:12px;margin-bottom:16px;"></div>` : ''}
    <div style="margin-bottom:16px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:36px;letter-spacing:2px;line-height:1;margin-bottom:8px;">${ev.name}</div>
      ${venue ? `<div style="font-size:13px;color:var(--muted);margin-bottom:3px;">📍 ${venue}</div>` : ''}
      ${date ? `<div style="font-size:13px;color:var(--muted);margin-bottom:3px;">📅 ${date}</div>` : ''}
      ${genres ? `<div style="font-size:12px;color:var(--neon2);margin-top:6px;">${genres}</div>` : ''}
      <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;">
        <span style="background:rgba(255,184,48,.12);border:1px solid var(--gold);color:var(--gold);border-radius:20px;font-size:10px;padding:3px 12px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">${isOpen ? 'LIVE' : 'UPCOMING'}</span>
      </div>
    </div>
    ${isOpen && canApply ? `
    <button onclick="openApplyModalForEvent('${ev.id}','${ev.name.replace(/'/g,"\\'")}',this)"
      style="background:var(--neon2);color:#0a0a0f;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:2px;padding:14px;border:none;border-radius:12px;cursor:pointer;width:100%;margin-bottom:20px;font-weight:700;">
      APPLY FOR THIS EVENT →
    </button>` : ''}
    <div style="font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:2px;color:var(--muted);margin-bottom:12px;">LINEUP</div>
    ${slotRowsHtml || '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">No set times published yet</div>'}
  `;
  show('publicEventScreen');
  _currentPublicEvent = ev;
}

let _currentPublicEvent = null;

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
    card.className = 'search-card';

    if (item._type === 'event') {
      const ev = item;
      const cfg = ev.config || {};
      const slots = (cfg.days || []).reduce((a, d) => a + (d.slots || []).length, 0);
      const isLive = ev.status === 'live';
      const borderCol = isLive ? 'rgba(0,196,90,.35)'   : 'rgba(0,180,200,.25)';
      const bgCol     = isLive ? 'rgba(0,196,90,.04)'   : 'rgba(0,180,200,.03)';
      const labelCol  = isLive ? '#00c45a'               : 'rgba(0,200,220,.8)';
      const labelBg   = isLive ? 'rgba(0,196,90,.12)'   : 'rgba(0,180,200,.1)';
      const labelBdr  = isLive ? 'rgba(0,196,90,.35)'   : 'rgba(0,180,200,.3)';
      const glowRgb   = isLive ? '0,196,90'             : '0,180,200';
      const hoverBorder = isLive ? 'rgba(0,196,90,.7)'  : 'rgba(0,180,200,.6)';
      const statusTxt = isLive ? 'LIVE' : 'UPCOMING';
      const poster = cfg.poster || ev.poster || '';
      card.style.cssText = `background:${bgCol};border:1px solid ${borderCol};border-radius:12px;overflow:hidden;margin-bottom:10px;cursor:pointer;transition:border-color .2s,box-shadow .2s;`;
      card.onmouseenter = () => { card.style.borderColor = hoverBorder; card.style.boxShadow = `0 0 16px rgba(${glowRgb},.15)`; };
      card.onmouseleave = () => { card.style.borderColor = borderCol; card.style.boxShadow = ''; };
      card.onclick = () => openPublicEvent(ev);
      card.innerHTML = `
        ${poster ? `<div style="width:100%;height:120px;background:url(${poster}) center/cover no-repeat;border-bottom:1px solid ${borderCol};position:relative;">
          <div style="position:absolute;inset:0;background:linear-gradient(to bottom,transparent 40%,${bgCol} 100%);"></div>
        </div>` : ''}
        <div style="padding:14px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
              <span style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1px;">${ev.name}</span>
              <span style="background:${labelBg};color:${labelCol};border:1px solid ${labelBdr};border-radius:20px;font-size:10px;padding:2px 8px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">${statusTxt}</span>
            </div>
            ${cfg.venue ? `<div style="font-size:12px;color:var(--muted);">📍 ${cfg.venue}</div>` : ''}
            ${cfg.date  ? `<div style="font-size:12px;color:var(--muted);">📅 ${cfg.date}</div>` : ''}
            ${cfg.genres ? `<div style="font-size:11px;color:${labelCol};margin-top:4px;">${cfg.genres}</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">${slots} slots</div>
          </div>
        </div>
        </div>`;

    } else {
      const row = item;
      const isHostRow = row.type === 'host';
      const name      = row.dj_name || row.name || 'Unknown';
      const location  = [row.location, row.state].filter(Boolean).join(', ');
      const genres    = row.genre_string ? row.genre_string.split(' · ').slice(0,4).join(' · ') : '';
      const bio       = row.bio ? row.bio.substring(0,80) + (row.bio.length > 80 ? '…' : '') : '';
      const accentCol = isHostRow ? 'var(--neon)' : 'var(--neon2)';
      const accentRgb = isHostRow ? '255,45,120' : '0,229,255';
      const badge = isHostRow
        ? `<span style="background:rgba(255,45,120,.15);color:var(--neon);border:1px solid rgba(255,45,120,.3);border-radius:20px;font-size:10px;padding:2px 8px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">HOST</span>`
        : `<span style="background:rgba(0,229,255,.12);color:var(--neon2);border:1px solid rgba(0,229,255,.25);border-radius:20px;font-size:10px;padding:2px 8px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">ARTIST</span>`;
      const avatarHtml = row.avatar
        ? `<img src="${row.avatar}" style="width:52px;height:52px;border-radius:6px;object-fit:cover;border:2px solid ${accentCol};flex-shrink:0;" onerror="this.outerHTML='<div style=\\'width:52px;height:52px;border-radius:6px;background:var(--card2);border:2px solid ${accentCol};display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;\\'>${isHostRow ? '🎛️' : '🎧'}</div>'">`
        : `<div style="width:52px;height:52px;border-radius:6px;background:var(--card2);border:2px solid ${accentCol};display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${isHostRow ? '🎛️' : '🎧'}</div>`;
      const mixIcon = row.mix_link || row.soundcloud || row.mixcloud ? `<span style="font-size:13px;opacity:.7;margin-left:4px;" title="Has mix">▶</span>` : '';
      card.style.cssText = `background:rgba(${accentRgb},.04);border:1px solid rgba(${accentRgb},.35);border-radius:12px;padding:14px;margin-bottom:10px;display:flex;gap:12px;align-items:flex-start;cursor:pointer;transition:border-color .2s,box-shadow .2s;`;
      card.onmouseenter = () => { card.style.borderColor = accentCol; card.style.boxShadow = `0 0 16px rgba(${accentRgb},.15)`; };
      card.onmouseleave = () => { card.style.borderColor = `rgba(${accentRgb},.35)`; card.style.boxShadow = ''; };
      card.onclick = () => openPublicProfile(row);
      card.innerHTML = `
        ${avatarHtml}
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <span style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1px;">${name}</span>
            ${badge}${mixIcon}
          </div>
          ${location ? `<div style="font-size:12px;color:var(--muted);margin-bottom:4px;">📍 ${location}</div>` : ''}
          ${genres ? `<div style="font-size:11px;color:${accentCol};margin-bottom:4px;line-height:1.5;">${genres}</div>` : ''}
          ${bio ? `<div style="font-size:12px;color:var(--muted);line-height:1.5;">${bio}</div>` : ''}
        </div>`;
    }

    resultsEl.appendChild(card);
  });
}

// ── Apply to event modal ───────────────────────────

let _applyEventId   = null;
let _applyEventName = '';

function openApplyModalForEvent(eventId, eventName, btn) {
  if (!currentUser?.id || currentUser.id === 'guest') {
    showToast('Sign in to apply for events', 'error'); return;
  }
  _applyEventId = eventId;
  _applyEventName = eventName;
  document.getElementById('applyEventName').textContent = eventName;
  document.getElementById('applyNote').value = '';
  document.getElementById('applyNoteCount').textContent = '0 / 250';
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
  const note = document.getElementById('applyNote').value.trim();
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
      showToast('Application submitted! ✓', 'success');
      const applyBtn = document.querySelector('#publicEventContent button');
      if (applyBtn) {
        applyBtn.textContent = 'APPLICATION SENT ✓';
        applyBtn.style.background = 'var(--card2)';
        applyBtn.style.color = 'var(--neon2)';
        applyBtn.disabled = true;
      }
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
  btn.disabled = false; btn.textContent = 'SUBMIT APPLICATION →';
}
