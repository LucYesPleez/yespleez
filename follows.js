// ═══════════════════════════════════════════════════
//  follows.js — YesPleez Follow System
//  Depends on: state.js, navigation.js
// ═══════════════════════════════════════════════════

let _followsCache  = [];
let _followsLoaded = false;

async function loadFollows() {
  if (!currentUser?.id || DEMO) {
    _followsCache  = [];
    _followsLoaded = true;
    renderPunterFeed();
    return;
  }
  try {
    const rows = await sbRest(
      `follows?user_id=eq.${currentUser.id}&order=created_at.desc`,
      { method: 'GET' }, currentSession?.access_token
    );
    _followsCache = Array.isArray(rows) ? rows : [];
  } catch(e) {
    _followsCache = [];
  }

  // Fetch updated_at for non-event follows so we can show notification dots
  const profileFollows = _followsCache.filter(f => f.entity_type !== 'event' && f.entity_id);
  if (profileFollows.length) {
    try {
      const ids = profileFollows.map(f => f.entity_id).join(',');
      const profiles = await sbRest(
        `profiles?user_id=in.(${ids})&select=user_id,updated_at`,
        { method: 'GET' }, currentSession?.access_token
      );
      if (Array.isArray(profiles)) {
        const map = {};
        profiles.forEach(p => { map[p.user_id] = p.updated_at; });
        _followsCache.forEach(f => {
          if (f.entity_type !== 'event') f._profileUpdatedAt = map[f.entity_id] || null;
        });
      }
    } catch(e) {}
  }

  _followsLoaded = true;
  renderPunterFeed();
}

function isFollowing(entityId) {
  return _followsCache.some(f => f.entity_id === entityId);
}

async function followEntity(entityType, entityId, entityName) {
  if (!currentUser?.id) { showToast('Sign in to follow', 'error'); return; }
  if (isFollowing(entityId)) return;
  try {
    await sbRest('follows', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id:     currentUser.id,
        entity_type: entityType,
        entity_id:   entityId,
        entity_name: entityName || ''
      })
    }, currentSession?.access_token);
    _followsCache.unshift({
      entity_id:   entityId,
      entity_type: entityType,
      entity_name: entityName || '',
      created_at:  new Date().toISOString()
    });
    showToast(`Following ${entityName || 'them'}`, 'success');
    renderPunterFeed();
    _syncFollowBtn(entityId, true, entityType, entityName);
  } catch(e) {
    showToast('Could not follow — try again', 'error');
  }
}

async function unfollowEntity(entityId, entityName) {
  if (!currentUser?.id) return;
  try {
    await sbRest(
      `follows?user_id=eq.${currentUser.id}&entity_id=eq.${entityId}`,
      { method: 'DELETE' }, currentSession?.access_token
    );
    _followsCache = _followsCache.filter(f => f.entity_id !== entityId);
    showToast(`Unfollowed ${entityName || 'them'}`, 'success');
    renderPunterFeed();
    _syncFollowBtn(entityId, false);
  } catch(e) {
    showToast('Could not unfollow — try again', 'error');
  }
}

function toggleFollowEvent(eventId, eventName) {
  if (isFollowing(eventId)) unfollowEntity(eventId, eventName);
  else followEntity('event', eventId, eventName);
}

function heartToggle(btn, eventId, eventName) {
  const svg = btn.querySelector('svg');
  const nowFollowing = !btn.classList.contains('active');
  if (nowFollowing) {
    btn.classList.add('active', 'popping');
    if (svg) { svg.setAttribute('fill','#FF2D78'); svg.setAttribute('stroke','#FF2D78'); }
    btn.addEventListener('animationend', () => btn.classList.remove('popping'), { once: true });
    followEntity('event', eventId, eventName);
  } else {
    btn.classList.remove('active');
    if (svg) { svg.setAttribute('fill','none'); svg.setAttribute('stroke','white'); }
    unfollowEntity(eventId, eventName);
  }
}

// Delegated follow handler — called by data-follow buttons anywhere in the feed
function handleFollowBtn(btn) {
  const id   = btn.dataset.followId;
  const name = btn.dataset.followName || '';
  const type = btn.dataset.followType || 'profile';
  if (!id) return;
  if (isFollowing(id)) unfollowEntity(id, name);
  else followEntity(type, id, name);
}

function _followBtnHtml(id, name, type, color) {
  if (!id) return '';
  const followed = isFollowing(id);
  const safeName = (name || '').replace(/"/g, '&quot;');
  return `<button
    onclick="event.stopPropagation();handleFollowBtn(this)"
    ontouchend="event.preventDefault();event.stopPropagation();handleFollowBtn(this)"
    data-follow-id="${id}"
    data-follow-name="${safeName}"
    data-follow-type="${type || 'profile'}"
    style="margin-top:6px;width:100%;padding:4px 0;background:${followed?'rgba(255,255,255,.07)':(color||'#FF2D78')+'22'};border:1px solid ${followed?'var(--border)':(color||'#FF2D78')+'66'};border-radius:8px;font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:1px;color:${followed?'var(--muted)':(color||'#FF2D78')};cursor:pointer;touch-action:manipulation;">
    ${followed ? 'FOLLOWING' : '+ FOLLOW'}
  </button>`;
}

function toggleFollowProfile(entityId, entityType, entityName) {
  if (isFollowing(entityId)) {
    unfollowEntity(entityId, entityName);
  } else {
    followEntity(entityType, entityId, entityName);
  }
}

function _syncFollowBtn(entityId, following, entityType, entityName) {
  const btn = document.getElementById(`followBtn_${entityId}`);
  if (!btn) return;
  _applyFollowBtnState(btn, following, entityId, entityType, entityName);
}

function _applyFollowBtnState(btn, following, entityId, entityType, entityName) {
  const safeId   = (entityId   || '').replace(/'/g, "\\'");
  const safeName = (entityName || '').replace(/'/g, "\\'");
  const safeType = (entityType || '').replace(/'/g, "\\'");
  if (following) {
    btn.textContent = 'FOLLOWING ✓';
    btn.style.background   = 'rgba(191,95,255,.15)';
    btn.style.borderColor  = '#BF5FFF';
    btn.style.color        = '#BF5FFF';
  } else {
    btn.textContent = '+ FOLLOW';
    btn.style.background   = 'rgba(255,255,255,.06)';
    btn.style.borderColor  = 'rgba(255,255,255,.18)';
    btn.style.color        = 'var(--text)';
  }
  btn.setAttribute('onclick', `toggleFollowProfile('${safeId}','${safeType}','${safeName}')`);
}

// Builds the follow button HTML to embed in publicProfileContent
function buildFollowBtn(entityId, entityType, entityName) {
  const following = isFollowing(entityId);
  const safeId   = (entityId   || '').replace(/'/g, "\\'");
  const safeName = (entityName || '').replace(/'/g, "\\'");
  const safeType = (entityType || '').replace(/'/g, "\\'");
  const label = following ? 'FOLLOWING ✓' : '+ FOLLOW';
  const bg    = following ? 'rgba(191,95,255,.15)' : 'rgba(255,255,255,.06)';
  const bc    = following ? '#BF5FFF' : 'rgba(255,255,255,.18)';
  const col   = following ? '#BF5FFF' : 'var(--text)';
  return `<button id="followBtn_${entityId}"
    onclick="toggleFollowProfile('${safeId}','${safeType}','${safeName}')"
    style="width:100%;background:${bg};border:1px solid ${bc};color:${col};border-radius:12px;font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:2px;padding:14px;cursor:pointer;touch-action:manipulation;margin-bottom:12px;transition:background .15s,border-color .15s,color .15s;"
    ontouchend="event.preventDefault();toggleFollowProfile('${safeId}','${safeType}','${safeName}');">${label}</button>`;
}

function renderFollowingSection() {
  const el = document.getElementById('punterDashFollowing');
  if (!el) return;

  if (!_followsCache.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:8px 0 20px;">Follow artists and venues from their profiles — you\'ll get notified when they play.</div>';
    return;
  }

  const typeMap = {
    artist:  { color: 'var(--neon2)', label: 'ARTIST' },
    band:    { color: '#FF8C42',      label: 'BAND'   },
    venue:   { color: '#00E5A0',      label: 'VENUE'  },
    standup: { color: '#FF88AA',      label: 'COMEDY' },
    host:    { color: '#FF3399',      label: 'PROMOTER' },
  };

  const cards = _followsCache.map(f => {
    const tc       = typeMap[f.entity_type] || typeMap.artist;
    const safeId   = (f.entity_id   || '').replace(/'/g, "\\'");
    const safeName = (f.entity_name || '').replace(/'/g, "\\'");
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;margin-bottom:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.entity_name || 'Unknown'}</div>
          <div style="font-size:10px;color:${tc.color};letter-spacing:1.5px;font-family:'Bebas Neue',sans-serif;">${tc.label}</div>
        </div>
        <button onclick="unfollowEntity('${safeId}','${safeName}')"
          ontouchend="event.preventDefault();unfollowEntity('${safeId}','${safeName}');"
          style="background:none;border:1px solid rgba(255,255,255,.15);color:var(--muted);border-radius:8px;font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:1px;padding:5px 10px;cursor:pointer;touch-action:manipulation;flex-shrink:0;">
          UNFOLLOW
        </button>
      </div>`;
  }).join('');

  el.innerHTML = `<div style="padding-bottom:20px;">${cards}</div>`;
}

// ═══════════════════════════════════════════════════
//  Punter Feed — date strip + sections
// ═══════════════════════════════════════════════════

let _punterViewMonth = new Date();
let _punterSelDate   = null;

function punterScrollToSection(id) {
  // If a day view is open, close it first then scroll
  if (_punterSelDate) {
    punterClearDate();
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    return;
  }
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function punterOpenMonthPicker() {
  // Set context so calPickerSelectDay routes back to the punter feed
  _calPickerContext = 'punter';
  _calPickerMonth   = new Date(_punterViewMonth);
  if (typeof _calPickerPopulateYears === 'function') _calPickerPopulateYears();
  const mSel = document.getElementById('calPickerMonth');
  const ySel = document.getElementById('calPickerYear');
  if (mSel) mSel.value = _punterViewMonth.getMonth();
  if (ySel) ySel.value = _punterViewMonth.getFullYear();
  if (typeof calPickerRenderGrid === 'function') calPickerRenderGrid();
  const ov = document.getElementById('calMonthPickerOverlay');
  const mo = document.getElementById('calMonthPickerModal');
  if (ov) ov.style.display = 'block';
  if (mo) mo.style.display = 'block';
}

function punterPrevMonth() {
  _punterViewMonth = new Date(_punterViewMonth.getFullYear(), _punterViewMonth.getMonth() - 1, 1);
  renderPunterDateStrip();
}

function punterNextMonth() {
  _punterViewMonth = new Date(_punterViewMonth.getFullYear(), _punterViewMonth.getMonth() + 1, 1);
  renderPunterDateStrip();
}

function punterSelectDate(ds) {
  _punterSelDate = ds;
  renderPunterDateStrip();
  // Hide main feed, show day view
  const feed    = document.getElementById('punterFeedContent');
  const dayView = document.getElementById('punterDayContent');
  if (feed)    feed.style.display    = 'none';
  if (dayView) dayView.style.display = '';
  _renderPunterDayView(ds);
  if (dayView) dayView.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function punterClearDate() {
  _punterSelDate = null;
  renderPunterDateStrip();
  const feed    = document.getElementById('punterFeedContent');
  const dayView = document.getElementById('punterDayContent');
  if (feed)    feed.style.display    = '';
  if (dayView) { dayView.style.display = 'none'; dayView.innerHTML = ''; }
}

function renderPunterDateStrip() {
  const strip    = document.getElementById('punterDateStrip');
  const labelEl  = document.getElementById('punterDateMonthLabelText');
  if (!strip) return;

  const y     = _punterViewMonth.getFullYear();
  const m     = _punterViewMonth.getMonth();
  const total = new Date(y, m + 1, 0).getDate();
  const today = new Date().toISOString().split('T')[0];

  if (labelEl) labelEl.textContent = _punterViewMonth.toLocaleString('en-AU', { month:'long', year:'numeric' }).toUpperCase();

  // Which days in this month have events
  const eventDays = new Set();
  (_calEvents || []).forEach(ev => {
    if (typeof calParseDate !== 'function') return;
    const d = calParseDate(ev);
    if (d && d.getFullYear() === y && d.getMonth() === m) eventDays.add(d.getDate());
  });

  // Which days have YOUR PICKS events
  const sceneDays = new Set();
  (_calEvents || []).forEach(ev => {
    if (typeof calParseDate !== 'function') return;
    const d = calParseDate(ev);
    if (d && d.getFullYear() === y && d.getMonth() === m && _isPunterSceneEvent(ev)) sceneDays.add(d.getDate());
  });

  const DAY_NAMES = ['S','M','T','W','T','F','S'];
  let html = '';

  for (let day = 1; day <= total; day++) {
    const ds      = `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = ds === today;
    const isSel   = ds === _punterSelDate;
    const hasEvs  = eventDays.has(day);
    const isScene = sceneDays.has(day);
    const dow     = new Date(ds).getDay();

    let bg, textCol;
    if (isSel) {
      bg = 'background:linear-gradient(135deg,#00E5FF,#BF5FFF);';
      textCol = 'color:#fff;';
    } else if (isToday) {
      bg = 'background:rgba(191,95,255,.12);border:1.5px solid #BF5FFF;';
      textCol = 'color:#BF5FFF;';
    } else {
      bg = 'background:var(--card2);';
      textCol = 'color:var(--text);';
    }

    // Dot: neon yellow for YOUR PICKS days, neon green for regular event days
    const dotColor = isSel ? '#fff' : isScene ? '#BF5FFF' : 'var(--neon)';
    const dot = (hasEvs || isScene)
      ? `<div style="width:5px;height:5px;border-radius:50%;background:${dotColor};margin:2px auto 0;flex-shrink:0;"></div>`
      : `<div style="height:7px;"></div>`;

    html += `<div onclick="punterSelectDate('${ds}')" ontouchend="event.preventDefault();punterSelectDate('${ds}');" style="flex-shrink:0;width:40px;text-align:center;cursor:pointer;border-radius:10px;padding:6px 4px 4px;${bg}${textCol}transition:all .15s;box-sizing:border-box;touch-action:manipulation;">
      <div style="font-size:9px;opacity:.55;margin-bottom:2px;font-family:'DM Sans',sans-serif;">${DAY_NAMES[dow]}</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:.5px;line-height:1;">${day}</div>
      ${dot}
    </div>`;
  }

  strip.innerHTML = html;

  // Scroll selected date or today into view
  const target = _punterSelDate || today;
  if (target.startsWith(`${y}-${String(m+1).padStart(2,'0')}`)) {
    const dayIdx = parseInt(target.split('-')[2]) - 1;
    setTimeout(() => {
      const pills = strip.children;
      if (pills[dayIdx]) pills[dayIdx].scrollIntoView({ behavior:'smooth', inline:'center', block:'nearest' });
    }, 60);
  }
}

// Returns true if an event has an artist or venue that the user follows
function _isPunterSceneEvent(ev) {
  if (!_followsCache.length) return false;
  if (typeof calGetArtists !== 'function') return false;
  const artists = calGetArtists(ev).map(n => n.toLowerCase());
  const venue   = (ev.config?.venue || '').toLowerCase();
  return _followsCache.some(f => {
    const name = (f.entity_name || '').toLowerCase().trim();
    if (!name) return false;
    if (f.entity_type === 'venue') {
      const v0 = venue.split(',')[0].toLowerCase().trim();
      return venue.includes(name) || name.includes(v0);
    }
    return artists.some(a => a.includes(name) || name.includes(a));
  });
}

// ── Punter section card builder (reuses calendar functions) ──
function _punterSection(sectionId, label, badgeText, badgeColor, evs, style) {
  if (!evs.length) return '';
  const header = `<div id="${sectionId}" style="display:flex;align-items:center;justify-content:space-between;padding:20px 16px 12px;">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;">${label}</div>
      ${badgeText ? `<div style="background:${badgeColor}22;border:1px solid ${badgeColor}66;border-radius:20px;padding:3px 10px;font-size:10px;letter-spacing:1px;color:${badgeColor};font-family:'DM Sans',sans-serif;font-weight:600;white-space:nowrap;">${badgeText}</div>` : ''}
    </div>
    <div style="font-size:12px;color:var(--neon);cursor:pointer;display:flex;align-items:center;gap:3px;white-space:nowrap;" onclick="showCalendar()" ontouchend="event.preventDefault();showCalendar();">See all <svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5'><path d='M9 18l6-6-6-6'/></svg></div>
  </div>`;

  let content;
  if (style === 'list') {
    content = `<div>${evs.map(ev => typeof calListCard === 'function' ? calListCard(ev) : '').join('')}</div>`;
  } else {
    content = `<div style="display:flex;gap:12px;overflow-x:auto;padding:0 16px 16px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">
      ${evs.map(ev => typeof calWhatsOnCard === 'function' ? calWhatsOnCard(ev, style) : '').join('')}
    </div>`;
  }
  return header + content;
}

// ── Following strip — vertical list with notification dots ──
function _punterFollowingStrip() {
  const profileFollows = _followsCache.filter(f => f.entity_type !== 'event');
  if (!profileFollows.length) return '';

  const typeMap = {
    artist:  { color: 'var(--neon2)', label: 'ARTIST'   },
    band:    { color: '#FF8C42',      label: 'BAND'     },
    venue:   { color: '#00E5A0',      label: 'VENUE'    },
    standup: { color: '#FF88AA',      label: 'COMEDY'   },
    host:    { color: '#FF3399',      label: 'PROMOTER' },
    event:   { color: '#BF5FFF',      label: 'EVENT'    },
  };

  const lastVisited = window._mySceneLastVisited || new Date(0).toISOString();

  // Only show profiles with updates since last visit
  const withNotif = profileFollows.filter(f =>
    f._profileUpdatedAt && f._profileUpdatedAt > lastVisited
  );
  const showList = withNotif.length ? withNotif : [];

  if (!showList.length) {
    return `<div id="punterFollowingStrip" style="padding:20px 16px 8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;">FOLLOWING</div>
        <button onclick="openFollowingEditSheet()" ontouchend="event.preventDefault();openFollowingEditSheet();"
          style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:var(--text);border-radius:8px;font-family:'Bebas Neue',sans-serif;font-size:12px;letter-spacing:1px;padding:5px 14px;cursor:pointer;touch-action:manipulation;">
          EDIT (${profileFollows.length})
        </button>
      </div>
      <div style="font-size:13px;color:var(--muted);padding:4px 0 8px;">No new updates from who you follow.</div>
    </div>`;
  }

  const rows = showList.map(f => {
    const tc     = typeMap[f.entity_type] || typeMap.artist;
    const safeF  = JSON.stringify(f).replace(/"/g, '&quot;');
    return `<div onclick="openFollowedProfile('${(f.entity_id||'').replace(/'/g,"\\'")}','${f.entity_type||''}','${(f.entity_name||'').replace(/'/g,"\\'")}',this)"
      ontouchend="event.preventDefault();openFollowedProfile('${(f.entity_id||'').replace(/'/g,"\\'")}','${f.entity_type||''}','${(f.entity_name||'').replace(/'/g,"\\'")}',this)"
      style="display:flex;align-items:center;gap:12px;padding:11px 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:12px;margin-bottom:8px;cursor:pointer;touch-action:manipulation;position:relative;">
      <div style="width:38px;height:38px;border-radius:50%;background:rgba(${tc.color === 'var(--neon2)' ? '0,229,255' : tc.color.replace('#','').match(/../g)?.map(h=>parseInt(h,16)).join(',') || '200,200,200'},.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:'Bebas Neue',sans-serif;font-size:14px;color:${tc.color};">
        ${(f.entity_name||'?')[0].toUpperCase()}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:.5px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.entity_name||'Unknown'}</div>
        <div style="font-size:10px;color:${tc.color};letter-spacing:1.5px;font-family:'Bebas Neue',sans-serif;margin-top:1px;">${tc.label}</div>
      </div>
      <div style="width:8px;height:8px;border-radius:50%;background:#FF2D78;box-shadow:0 0 6px rgba(255,45,120,.6);flex-shrink:0;" title="New update"></div>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--muted);flex-shrink:0;"><path d="M9 18l6-6-6-6"/></svg>
    </div>`;
  }).join('');

  return `<div id="punterFollowingStrip" style="padding:20px 16px 8px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;">FOLLOWING</div>
      <button onclick="openFollowingEditSheet()" ontouchend="event.preventDefault();openFollowingEditSheet();"
        style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:var(--text);border-radius:8px;font-family:'Bebas Neue',sans-serif;font-size:12px;letter-spacing:1px;padding:5px 14px;cursor:pointer;touch-action:manipulation;">
        EDIT (${profileFollows.length})
      </button>
    </div>
    ${rows}
  </div>`;
}

// ── Open a followed profile (fetch then display) ──
async function openFollowedProfile(entityId, entityType, entityName, tappedEl) {
  if (tappedEl) tappedEl.style.opacity = '.6';
  try {
    const rows = await sbRest(
      `profiles?user_id=eq.${entityId}&limit=1`,
      { method: 'GET' }, currentSession?.access_token
    );
    if (rows && rows.length) {
      if (typeof openPublicProfile === 'function') openPublicProfile(rows[0]);
    } else {
      showToast(`${entityName || 'Profile'} not found`, 'error');
    }
  } catch(e) {
    showToast('Could not load profile', 'error');
  } finally {
    if (tappedEl) tappedEl.style.opacity = '';
  }
}

// ── Following edit sheet ──
function openFollowingEditSheet() {
  const overlay = document.getElementById('followingEditOverlay');
  const sheet   = document.getElementById('followingEditSheet');
  if (!overlay || !sheet) return;
  overlay.style.display = 'block';
  sheet.style.display   = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    sheet.style.transform = 'translateX(-50%) translateY(0)';
  }));
  const search = document.getElementById('followingEditSearch');
  if (search) search.value = '';
  _renderFollowingEditList('');
}

function closeFollowingEditSheet() {
  const overlay = document.getElementById('followingEditOverlay');
  const sheet   = document.getElementById('followingEditSheet');
  if (!sheet) return;
  sheet.style.transform = 'translateX(-50%) translateY(100%)';
  if (overlay) overlay.style.display = 'none';
  setTimeout(() => { if (sheet) sheet.style.display = 'none'; }, 300);
}

function _filterFollowingEditList(query) {
  _renderFollowingEditList(query);
}

function _renderFollowingEditList(query) {
  const el = document.getElementById('followingEditList');
  if (!el) return;

  const typeMap = {
    artist:  { color: 'var(--neon2)', label: 'ARTIST'   },
    band:    { color: '#FF8C42',      label: 'BAND'     },
    venue:   { color: '#00E5A0',      label: 'VENUE'    },
    standup: { color: '#FF88AA',      label: 'COMEDY'   },
    host:    { color: '#FF3399',      label: 'PROMOTER' },
    event:   { color: '#BF5FFF',      label: 'EVENT'    },
  };

  // Read active type filters from checkboxes
  const activeTypes = new Set();
  document.querySelectorAll('#followFilterChips input[data-filter-type]').forEach(cb => {
    if (cb.checked) activeTypes.add(cb.dataset.filterType);
  });

  const q = (query || '').toLowerCase().trim();
  const filtered = _followsCache.filter(f => {
    if (activeTypes.size && !activeTypes.has(f.entity_type)) return false;
    return !q || (f.entity_name || '').toLowerCase().includes(q);
  });

  if (!filtered.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--muted);font-size:14px;">No matches</div>';
    return;
  }

  el.innerHTML = filtered.map(f => {
    const tc     = typeMap[f.entity_type] || typeMap.artist;
    const safeId   = (f.entity_id   || '').replace(/'/g, "\\'");
    const safeName = (f.entity_name || '').replace(/'/g, "\\'");
    const isEvent  = f.entity_type === 'event';
    return `<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.06);">
      <div style="flex:1;min-width:0;${isEvent ? '' : 'cursor:pointer;'}" ${isEvent ? '' : `onclick="closeFollowingEditSheet();setTimeout(()=>openFollowedProfile('${safeId}','${f.entity_type||''}','${safeName}'),300)"`}>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:.5px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.entity_name||'Unknown'}</div>
        <div style="font-size:10px;color:${tc.color};letter-spacing:1.5px;font-family:'Bebas Neue',sans-serif;">${tc.label}</div>
      </div>
      <button onclick="unfollowEntity('${safeId}','${safeName}');_renderFollowingEditList(document.getElementById('followingEditSearch')?.value||'')"
        ontouchend="event.preventDefault();unfollowEntity('${safeId}','${safeName}');_renderFollowingEditList(document.getElementById('followingEditSearch')?.value||'')"
        style="background:none;border:1px solid rgba(255,255,255,.15);color:var(--muted);border-radius:8px;font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:1px;padding:5px 12px;cursor:pointer;touch-action:manipulation;flex-shrink:0;">
        UNFOLLOW
      </button>
    </div>`;
  }).join('');
}

// ── Main feed render ──────────────────────────────
function renderPunterFeed() {
  const el = document.getElementById('punterFeedContent');
  if (!el) return;

  if (!_punterViewMonth) _punterViewMonth = new Date();
  renderPunterDateStrip();

  // Show FAB
  const fab = document.getElementById('mySceneFab');
  if (fab) fab.style.display = '';

  const now = new Date();
  const all = _calEvents || [];
  if (typeof calParseDate !== 'function') {
    el.innerHTML = '<div style="text-align:center;padding:60px 16px;color:var(--muted);font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:2px;">LOADING...</div>';
    return;
  }

  let html = '';
  html += _upcomingForYouSection(all, now);
  html += _savedEventsSection(all, now);
  html += _followingUpdatesSection();

  el.innerHTML = html;
}

// ── UPCOMING FOR YOU ──────────────────────────────
function _upcomingForYouSection(all, now) {
  const upcoming = [];
  const seen = new Set();

  // ATTENDING: saved events
  const savedIds = new Set(_followsCache.filter(f => f.entity_type === 'event').map(f => f.entity_id));
  all.forEach(ev => {
    const d = calParseDate(ev);
    if (savedIds.has(ev.id) && d && d >= now && !seen.has(ev.id)) {
      seen.add(ev.id);
      upcoming.push({ ev, badge: 'ATTENDING', badgeColor: '#FF2D78' });
    }
  });

  // MY EVENT: events the current user created as host
  if (typeof currentUser !== 'undefined' && currentUser?.id) {
    all.forEach(ev => {
      const hostId = ev.userId || ev.config?.userId || ev.user_id;
      const d = calParseDate(ev);
      if (hostId === currentUser.id && d && d >= now && !seen.has(ev.id)) {
        seen.add(ev.id);
        upcoming.push({ ev, badge: 'MY EVENT', badgeColor: '#9D4EDD' });
      }
    });
  }

  // PLAYING: events where user's artist name appears in a slot
  if (typeof currentUser !== 'undefined' && currentUser?.id && typeof artistProfile !== 'undefined' && artistProfile?.djName) {
    const djLower = (artistProfile.djName || '').toLowerCase();
    all.forEach(ev => {
      const slots = ev.slots || ev.config?.slots || [];
      const d = calParseDate(ev);
      const hasSlot = Array.isArray(slots) && slots.some(s =>
        s.user_id === currentUser.id || (s.name || '').toLowerCase() === djLower
      );
      if (hasSlot && d && d >= now && !seen.has(ev.id)) {
        seen.add(ev.id);
        upcoming.push({ ev, badge: 'PLAYING', badgeColor: '#BF5FFF' });
      }
    });
  }

  if (!upcoming.length) {
    // Demo cards so layout is always visible
    const demoCards = [
      { name:'Friends of Owl', venue:'Bellingen Brewery', badge:'ATTENDING', badgeColor:'#FF2D78', textCol:'white', dayName:'SUN', dayNum:14, mon:'JUN', timeStr:'8:00 PM', img:'' },
      { name:'Subsonic Sessions', venue:'The Loft',          badge:'MY EVENT',  badgeColor:'#9D4EDD', textCol:'white', dayName:'FRI', dayNum:20, mon:'JUN', timeStr:'10:00 PM', img:'' },
      { name:'Lucious',           venue:'The Basement',       badge:'PLAYING',   badgeColor:'#BF5FFF', textCol:'#0a0a0f', dayName:'SAT', dayNum:28, mon:'JUN', timeStr:'11:30 PM', img:'' },
    ].map(d => `<div style="flex-shrink:0;width:195px;border-radius:16px;overflow:hidden;background:var(--card2);border:1px solid rgba(255,255,255,.08);position:relative;opacity:.55;">
      <div style="height:120px;background:linear-gradient(135deg,rgba(255,45,120,.2),rgba(157,78,221,.2));position:relative;">
        <div style="position:absolute;top:8px;left:8px;">
          <span style="background:${d.badgeColor};color:${d.textCol};font-family:'Bebas Neue',sans-serif;font-size:10px;letter-spacing:1px;padding:3px 8px;border-radius:6px;">${d.badge}</span>
        </div>
        <div style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.65);border-radius:8px;padding:4px 8px;text-align:center;min-width:36px;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:9px;color:rgba(255,255,255,.7);">${d.dayName}</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:white;line-height:1;">${d.dayNum}</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:9px;color:rgba(255,255,255,.7);">${d.mon}</div>
        </div>
      </div>
      <div style="padding:10px 12px 12px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.5px;margin-bottom:5px;">${d.name}</div>
        <div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px;margin-bottom:3px;">
          <svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/><circle cx='12' cy='10' r='3'/></svg>${d.venue}
        </div>
        <div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px;">
          <svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><circle cx='12' cy='12' r='10'/><polyline points='12 6 12 12 16 14'/></svg>${d.timeStr}
        </div>
      </div>
    </div>`).join('');
    return `<div id="punterSecUpcoming" style="padding:20px 0 4px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;padding:0 16px;margin-bottom:4px;">
        <div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;">UPCOMING FOR YOU</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Events you're attending or involved in</div>
        </div>
        <div onclick="showCalendar()" ontouchend="event.preventDefault();showCalendar();" style="font-size:12px;color:#FF2D78;cursor:pointer;white-space:nowrap;touch-action:manipulation;">See all</div>
      </div>
      <div style="display:flex;gap:12px;overflow-x:auto;padding:12px 16px 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">${demoCards}</div>
    </div>`;
  }
  upcoming.sort((a, b) => calParseDate(a.ev) - calParseDate(b.ev));

  const cards = upcoming.slice(0, 6).map(({ ev, badge, badgeColor }) => {
    const d       = calParseDate(ev);
    const dayName = d ? d.toLocaleDateString('en-AU', { weekday:'short' }).toUpperCase() : '';
    const dayNum  = d ? d.getDate() : '';
    const mon     = d ? d.toLocaleDateString('en-AU', { month:'short' }).toUpperCase() : '';
    const timeStr = d ? d.toLocaleTimeString('en-AU', { hour:'numeric', minute:'2-digit', hour12:true }) : '';
    const img     = ev.config?.image || ev.image || '';
    const name    = ev.name || ev.config?.name || 'Event';
    const venue   = (ev.config?.venue || ev.venue || '').split(',')[0];
    const textCol = badge === 'PLAYING' ? '#0a0a0f' : 'white';
    const evJson  = JSON.stringify(ev).replace(/"/g, '&quot;');

    return `<div onclick="if(typeof openPublicEvent==='function')openPublicEvent(${evJson})"
      ontouchend="event.preventDefault();if(typeof openPublicEvent==='function')openPublicEvent(${evJson})"
      style="flex-shrink:0;width:195px;border-radius:16px;overflow:hidden;background:var(--card2);border:1px solid rgba(255,255,255,.08);cursor:pointer;position:relative;touch-action:manipulation;">
      <div style="height:120px;background:${img ? `url('${img.replace(/'/g,"\\'")}') center/cover no-repeat` : 'linear-gradient(135deg,rgba(255,45,120,.25),rgba(157,78,221,.25))'};position:relative;">
        <div style="position:absolute;top:8px;left:8px;">
          <span style="background:${badgeColor};color:${textCol};font-family:'Bebas Neue',sans-serif;font-size:10px;letter-spacing:1px;padding:3px 8px;border-radius:6px;">${badge}</span>
        </div>
        <div style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.65);backdrop-filter:blur(4px);border-radius:8px;padding:4px 8px;text-align:center;min-width:36px;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:9px;color:rgba(255,255,255,.7);letter-spacing:.5px;">${dayName}</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:white;line-height:1;">${dayNum}</div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:9px;color:rgba(255,255,255,.7);letter-spacing:.5px;">${mon}</div>
        </div>
      </div>
      <div style="padding:10px 12px 12px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.5px;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
        ${venue ? `<div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px;margin-bottom:3px;">
          <svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/><circle cx='12' cy='10' r='3'/></svg>
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${venue}</span>
        </div>` : ''}
        ${timeStr ? `<div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px;">
          <svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><circle cx='12' cy='12' r='10'/><polyline points='12 6 12 12 16 14'/></svg>
          ${timeStr}
        </div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `<div id="punterSecUpcoming" style="padding:20px 0 4px;">
    <div style="display:flex;align-items:baseline;justify-content:space-between;padding:0 16px;margin-bottom:4px;">
      <div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;">UPCOMING FOR YOU</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">Events you're attending or involved in</div>
      </div>
      <div onclick="showCalendar()" ontouchend="event.preventDefault();showCalendar();"
        style="font-size:12px;color:#FF2D78;cursor:pointer;white-space:nowrap;touch-action:manipulation;">See all</div>
    </div>
    <div style="display:flex;gap:12px;overflow-x:auto;padding:12px 16px 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">${cards}</div>
  </div>`;
}

// ── SAVED EVENTS ──────────────────────────────────
function _savedEventsSection(all, now) {
  const savedIds = new Set(_followsCache.filter(f => f.entity_type === 'event').map(f => f.entity_id));
  if (!savedIds.size) {
    // Demo saved event card
    const demoCard = `<div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--card2);border:1px solid rgba(255,255,255,.08);border-radius:14px;margin-bottom:8px;opacity:.55;">
      <div style="width:64px;height:64px;border-radius:10px;background:linear-gradient(135deg,rgba(0,229,160,.2),rgba(0,229,255,.2));flex-shrink:0;"></div>
      <div style="flex:1;min-width:0;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.5px;margin-bottom:4px;">Jazz in the Garden</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:3px;">Sun, 22 Jun · 2:00 PM</div>
        <div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px;">
          <svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/><circle cx='12' cy='10' r='3'/></svg>Never Never Garden
        </div>
      </div>
    </div>`;
    return `<div id="punterSecSaved" style="padding:20px 16px 4px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;">
        <div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;">SAVED EVENTS</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Events you've saved</div>
        </div>
        <div onclick="showCalendar()" ontouchend="event.preventDefault();showCalendar();" style="font-size:12px;color:#FF2D78;cursor:pointer;white-space:nowrap;touch-action:manipulation;">See all</div>
      </div>
      <div style="margin-top:10px;">${demoCard}</div>
    </div>`;
  }
  const fourWeeks = new Date(now); fourWeeks.setDate(now.getDate() + 28);
  const savedEvs = all.filter(ev => {
    const d = calParseDate(ev);
    return savedIds.has(ev.id) && d && d >= now && d <= fourWeeks;
  }).sort((a, b) => calParseDate(a) - calParseDate(b));

  return `<div id="punterSecSaved" style="padding:20px 16px 4px;">
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;">
      <div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;">SAVED EVENTS</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">Events you've saved</div>
      </div>
      <div onclick="showCalendar()" ontouchend="event.preventDefault();showCalendar();"
        style="font-size:12px;color:#FF2D78;cursor:pointer;white-space:nowrap;touch-action:manipulation;">See all</div>
    </div>
    <div style="margin-top:10px;">
      ${savedEvs.length
        ? savedEvs.slice(0, 4).map(ev => typeof calListCard === 'function' ? calListCard(ev) : '').join('')
        : '<div style="font-size:13px;color:var(--muted);padding:4px 0 12px;">No upcoming saved events in the next 4 weeks.</div>'
      }
    </div>
  </div>`;
}

// ── FOLLOWING UPDATES ─────────────────────────────
function _followingUpdatesSection() {
  const profileFollows = _followsCache.filter(f => f.entity_type !== 'event');
  if (!profileFollows.length) return '';

  const typeMap = {
    artist:  { color: 'var(--neon2)', label: 'ARTIST',   update: 'Updated their profile'  },
    band:    { color: '#FF8C42',      label: 'BAND',     update: 'Updated their profile'  },
    venue:   { color: '#00E5A0',      label: 'VENUE',    update: 'Updated event listings' },
    standup: { color: '#FF88AA',      label: 'COMEDY',   update: 'Updated their profile'  },
    host:    { color: '#FF3399',      label: 'PROMOTER', update: 'Updated their events'   },
  };

  function _timeAgo(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return 'just now';
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  const lastVisited = window._mySceneLastVisited || new Date(0).toISOString();
  const withUpdates = profileFollows.filter(f =>
    f._profileUpdatedAt && f._profileUpdatedAt > lastVisited
  );

  if (!withUpdates.length) {
    // Demo rows so layout is always visible
    const demoRows = [
      { name:'Lucious',             label:'ARTIST',   color:'var(--neon2)', update:'Added a new show',      ago:'2h ago' },
      { name:'Bellingen Brewery',   label:'VENUE',    color:'#00E5A0',      update:'Updated their event',   ago:'6h ago' },
      { name:'Deliverance Festival',label:'FESTIVAL', color:'#9D4EDD',      update:'Released set times',    ago:'12h ago' },
    ].map(d => `<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;margin-bottom:8px;opacity:.55;">
      <div style="position:relative;flex-shrink:0;">
        <div style="width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:18px;color:${d.color};">${d.name[0]}</div>
        <div style="position:absolute;bottom:0;left:0;width:11px;height:11px;border-radius:50%;background:#00E5A0;border:2px solid var(--bg);"></div>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
          <span style="font-family:'Bebas Neue',sans-serif;font-size:15px;color:var(--text);">${d.name}</span>
          <span style="background:rgba(255,255,255,.08);border-radius:6px;font-size:9px;letter-spacing:1px;color:${d.color};font-family:'Bebas Neue',sans-serif;padding:2px 6px;">${d.label}</span>
        </div>
        <div style="font-size:12px;color:var(--muted);">${d.update}</div>
        <div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:2px;">${d.ago}</div>
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--muted);flex-shrink:0;"><path d="M9 18l6-6-6-6"/></svg>
    </div>`).join('');
    return `<div id="punterFollowingStrip" style="padding:20px 16px 24px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;">
        <div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;">FOLLOWING UPDATES</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Recent updates from artists, venues &amp; events you follow</div>
        </div>
        <button onclick="openFollowingEditSheet()" ontouchend="event.preventDefault();openFollowingEditSheet();"
          style="background:none;border:none;color:#FF2D78;font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1px;cursor:pointer;touch-action:manipulation;padding:0;">EDIT</button>
      </div>
      <div style="margin-top:12px;">${demoRows}</div>
    </div>`;
  }

  const rows = withUpdates.map(f => {
    const tc       = typeMap[f.entity_type] || typeMap.artist;
    const initial  = (f.entity_name || '?')[0].toUpperCase();
    const ago      = _timeAgo(f._profileUpdatedAt);
    const safeId   = (f.entity_id   || '').replace(/'/g, "\\'");
    const safeName = (f.entity_name || '').replace(/'/g, "\\'");
    const safeType = (f.entity_type || '').replace(/'/g, "\\'");

    return `<div onclick="openFollowedProfile('${safeId}','${safeType}','${safeName}',this)"
      ontouchend="event.preventDefault();openFollowedProfile('${safeId}','${safeType}','${safeName}',this)"
      style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;margin-bottom:8px;cursor:pointer;touch-action:manipulation;">
      <div style="position:relative;flex-shrink:0;">
        <div style="width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:18px;color:${tc.color};">${initial}</div>
        <div style="position:absolute;bottom:0;left:0;width:11px;height:11px;border-radius:50%;background:#00E5A0;border:2px solid var(--bg);"></div>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap;">
          <span style="font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:.5px;color:var(--text);">${f.entity_name || 'Unknown'}</span>
          <span style="background:rgba(255,255,255,.08);border-radius:6px;font-size:9px;letter-spacing:1px;color:${tc.color};font-family:'Bebas Neue',sans-serif;padding:2px 6px;">${tc.label}</span>
        </div>
        <div style="font-size:12px;color:var(--muted);">${tc.update}</div>
        <div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:2px;">${ago}</div>
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--muted);flex-shrink:0;"><path d="M9 18l6-6-6-6"/></svg>
    </div>`;
  }).join('');

  return `<div id="punterFollowingStrip" style="padding:20px 16px 24px;">
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;">
      <div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;">FOLLOWING UPDATES</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">Recent updates from artists, venues &amp; events you follow</div>
      </div>
      <button onclick="openFollowingEditSheet()" ontouchend="event.preventDefault();openFollowingEditSheet();"
        style="background:none;border:none;color:#FF2D78;font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1px;cursor:pointer;touch-action:manipulation;flex-shrink:0;padding:0;">
        EDIT
      </button>
    </div>
    <div style="margin-top:12px;">${rows}</div>
  </div>`;
}



async function _loadNearbyProfiles(userPostcode) {
  const section     = document.getElementById('punterSuggestSection');
  const profilesEl  = document.getElementById('punterNearbyProfiles');
  if (!section || !profilesEl || !userPostcode) return;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?postcode=eq.${userPostcode}&type=in.(artist,host,band,venue,standup)&select=user_id,dj_name,name,type,genre_string,avatar,postcode,location&limit=16`,
      { headers: { 'apikey': SUPABASE_KEY } }
    );
    if (!res.ok) return;
    const profiles = await res.json();
    const myId = (typeof currentUser !== 'undefined' && currentUser?.id) || null;
    const filtered = profiles.filter(p => p.user_id !== myId && (p.dj_name || p.name));
    if (!filtered.length && !section.querySelector('.calWhatsOnCard')) { section.style.display = 'none'; return; }
    section.style.display = '';

    const typeLabel = { artist:'ARTIST', host:'PROMOTER', band:'BAND', venue:'VENUE', standup:'COMEDY' };
    const typeColor = { artist:'#FF2D78', host:'#9D4EDD', band:'#FF2D78', venue:'#00E5FF', standup:'#FF8C42' };

    profilesEl.innerHTML = `<div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:2px;color:var(--muted);margin-bottom:10px;">ARTISTS · PROMOTERS · VENUES</div>
      <div style="display:flex;gap:10px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding-bottom:4px;">
        ${filtered.map(p => {
          const name    = esc(p.dj_name || p.name || '');
          const type    = p.type || 'artist';
          const label   = typeLabel[type] || 'ARTIST';
          const color   = typeColor[type] || '#FF2D78';
          const genres  = (p.genre_string || '').split('·').map(g => g.trim()).filter(Boolean).slice(0,2);
          const loc     = esc(p.location || '');
          const avatar  = p.avatar
            ? `<img src="${p.avatar}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid ${color}33;">`
            : `<div style="width:56px;height:56px;border-radius:50%;background:var(--card);border:2px solid ${color}33;display:flex;align-items:center;justify-content:center;color:${color};font-family:'Bebas Neue',sans-serif;font-size:18px;">${name.charAt(0)}</div>`;
          return `<div onclick="openPublicProfile(${JSON.stringify(p)})" style="flex-shrink:0;width:130px;background:var(--card2);border:1px solid var(--border);border-radius:14px;padding:14px 10px 12px;text-align:center;cursor:pointer;">
            <div style="display:flex;justify-content:center;margin-bottom:8px;">${avatar}</div>
            <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px;">${name}</div>
            <div style="display:inline-block;background:${color}22;color:${color};border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700;letter-spacing:.8px;margin-bottom:6px;">${label}</div>
            ${loc ? `<div style="font-size:10px;color:var(--muted);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${loc}</div>` : ''}
            ${genres.length ? `<div style="font-size:9px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${genres.join(' · ')}</div>` : ''}
            ${_followBtnHtml(p.user_id, name, 'profile', color)}
          </div>`;
        }).join('')}
      </div>`;
  } catch(e) {}
}

// ── Discover profile cards for empty states ───────
async function _loadSceneDiscoverProfiles(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?avatar=not.is.null&type=in.(artist,host,band,venue,standup)&select=user_id,dj_name,name,type,avatar,location,sound&limit=12&order=created_at.desc`,
      { headers: { 'apikey': SUPABASE_KEY } }
    );
    if (!res.ok) return;
    const profiles = await res.json();
    const myId = currentUser?.id || null;
    const filtered = profiles.filter(p => p.user_id !== myId);
    if (!filtered.length) return;
    el.innerHTML = filtered.map(p => typeof _calProfileCard === 'function' ? _calProfileCard(p) : '').join('');
  } catch(e) {}
}

// ── Day view (punter version) ─────────────────────
async function _renderPunterDayView(dateStr) {
  const el = document.getElementById('punterDayContent');
  if (!el || typeof calParseDate !== 'function') return;

  const evs = (_calEvents || []).filter(ev => {
    const d = calParseDate(ev);
    return d && d.toISOString().split('T')[0] === dateStr;
  });

  const d        = new Date(dateStr + 'T12:00:00');
  const dayLabel = d.toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long' }).toUpperCase();
  const safeDate = dateStr.replace(/'/g, "\\'");

  // ── Back bar + ADD button ──
  let html = `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 16px;margin:16px 0 20px;">
    <button onclick="punterClearDate()" ontouchend="event.preventDefault();punterClearDate();" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:20px;padding:7px 16px;font-size:12px;letter-spacing:1px;font-family:'Bebas Neue',sans-serif;cursor:pointer;touch-action:manipulation;flex-shrink:0;">← BACK</button>
    <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1.5px;color:#BF5FFF;line-height:1;flex:1;text-align:center;">${dayLabel}</div>
    <button onclick="openAddEventSheet('${safeDate}')" ontouchend="event.preventDefault();openAddEventSheet('${safeDate}');" style="background:linear-gradient(135deg,#00E5FF,#BF5FFF);color:#fff;border:none;border-radius:20px;padding:7px 14px;font-size:12px;letter-spacing:1px;font-family:'Bebas Neue',sans-serif;cursor:pointer;touch-action:manipulation;flex-shrink:0;font-weight:700;">+ ADD</button>
  </div>`;

  // ── Personal events (async load) ──
  html += `<div id="peDayEventsWrap"></div>`;

  // ── Platform events as horizontal scroll ──
  if (!evs.length) {
    const selD = new Date(dateStr + 'T12:00:00');
    const nearby = (_calEvents || []).filter(ev => {
      const evD = calParseDate(ev);
      if (!evD) return false;
      const diff = Math.abs(evD - selD) / 86400000;
      return diff > 0 && diff <= 21;
    }).sort((a, b) => Math.abs(calParseDate(a) - selD) - Math.abs(calParseDate(b) - selD)).slice(0, 6);

    html += `<div style="text-align:center;padding:24px 16px 14px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:2px;color:var(--muted);">NOTHING ANNOUNCED YET</div>
    </div>`;

    if (nearby.length) {
      html += `<div style="padding:0 16px 14px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:2px;background:linear-gradient(135deg,#00E5FF,#BF5FFF);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">NEARBY NIGHTS</div>
          <div style="flex:1;height:1px;background:linear-gradient(to right,rgba(0,229,255,.5),rgba(191,95,255,.3),transparent);"></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;height:calc((100dvh - 300px) / 2);overflow-y:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;flex-shrink:0;">
          ${nearby.map(ev => typeof calSlimDayCard === 'function' ? calSlimDayCard(ev) : '').join('')}
        </div>
      </div>`;
    }

    html += `<div style="padding:0 16px 0;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:2px;background:linear-gradient(135deg,#00E5FF,#BF5FFF);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">DISCOVER</div>
        <div style="flex:1;height:1px;background:linear-gradient(to right,rgba(0,229,255,.5),rgba(191,95,255,.3),transparent);"></div>
      </div>
      <div id="sceneDayDiscoverProfiles" style="display:flex;gap:12px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding-bottom:8px;min-height:160px;"></div>
    </div>`;
  } else {
    const sceneEvs = evs.filter(ev => _isPunterSceneEvent(ev));
    const otherEvs = evs.filter(ev => !_isPunterSceneEvent(ev));
    const allEvs   = [...sceneEvs, ...otherEvs];

    if (sceneEvs.length) {
      html += `<div style="font-family:'Bebas Neue',sans-serif;font-size:12px;letter-spacing:2px;color:#BF5FFF;padding:0 16px 8px;">YOUR PICKS</div>`;
    }
    // All events in a horizontal scroll using the same card style as calendar
    html += `<div style="display:flex;gap:12px;overflow-x:auto;padding:4px 16px 12px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">
      ${allEvs.map(ev => typeof calWhatsOnCard === 'function' ? calWhatsOnCard(ev, 'lg') : '').join('')}
    </div>`;
  }

  // ── Placeholder for artists / hosts / venues on this day ──
  html += `<div id="peDayPeopleWrap"></div>`;

  el.innerHTML = html;
  if (!evs.length) _loadSceneDiscoverProfiles('sceneDayDiscoverProfiles');

  // Load personal events
  const peEvs  = await (typeof loadPersonalEventsForDate === 'function'
    ? loadPersonalEventsForDate(dateStr) : Promise.resolve([]));
  const peWrap = document.getElementById('peDayEventsWrap');
  if (peWrap && peEvs.length) {
    peWrap.innerHTML =
      `<div style="font-family:'Bebas Neue',sans-serif;font-size:12px;letter-spacing:2px;color:#BF5FFF;padding:0 16px 10px;border-bottom:1px solid rgba(191,95,255,.2);margin-bottom:10px;">ON YOUR CALENDAR</div>` +
      (typeof renderPersonalEventCards === 'function' ? renderPersonalEventCards(peEvs, dateStr) : '');
  }

  // Load artists / hosts / venues for the events on this day
  if (evs.length) _loadDayPeople(evs);
}

async function _loadDayPeople(evs) {
  const wrap = document.getElementById('peDayPeopleWrap');
  if (!wrap) return;

  const realEvs = evs.filter(e => !e._isDemo);
  if (!realEvs.length) return;

  try {
    // Fetch claims (artists playing) for these events
    const evIds = realEvs.map(e => e.id).join(',');
    const claimsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/claims?event_id=in.(${evIds})&select=user_id,name,genre,event_id`,
      { headers: { 'apikey': SUPABASE_KEY } }
    );
    const claims = claimsRes.ok ? await claimsRes.json() : [];

    // Fetch host profiles for these events
    const hostIds = [...new Set(realEvs.map(e => e.host_id).filter(Boolean))];
    const artistUserIds = [...new Set(claims.map(c => c.user_id).filter(Boolean))];
    const allIds = [...new Set([...artistUserIds, ...hostIds])];

    let profileMap = {};
    if (allIds.length) {
      const profRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?user_id=in.(${allIds.join(',')})&select=user_id,dj_name,name,type,genre_string,avatar,location`,
        { headers: { 'apikey': SUPABASE_KEY } }
      );
      if (profRes.ok) (await profRes.json()).forEach(p => { profileMap[p.user_id] = p; });
    }

    // Build artist cards from claims (include unlinked claims by name)
    const artistCards = claims.map(c => {
      const prof = profileMap[c.user_id] || {};
      const name = esc(prof.dj_name || prof.name || c.name || '');
      if (!name) return '';
      const avatar = prof.avatar
        ? `<img src="${prof.avatar}" style="width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,45,120,.4);">`
        : `<div style="width:52px;height:52px;border-radius:50%;background:var(--card);border:2px solid rgba(255,45,120,.3);display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:20px;color:#FF2D78;">${name.charAt(0)}</div>`;
      const genre = esc((prof.genre_string || c.genre || '').split('·')[0].trim());
      return `<div onclick="${c.user_id ? `openPublicProfile(${JSON.stringify(prof)})` : ''}" style="flex-shrink:0;width:120px;background:var(--card2);border:1px solid var(--border);border-radius:14px;padding:14px 10px 12px;text-align:center;${c.user_id?'cursor:pointer;':''}">
        <div style="display:flex;justify-content:center;margin-bottom:8px;">${avatar}</div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
        ${genre ? `<div style="font-size:9px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${genre}</div>` : ''}
        ${_followBtnHtml(c.user_id, name, 'profile', '#FF2D78')}
      </div>`;
    }).filter(Boolean);

    // Build host/venue cards
    const hostCards = hostIds.map(hid => {
      const prof = profileMap[hid];
      if (!prof) return '';
      const name = esc(prof.dj_name || prof.name || '');
      if (!name) return '';
      const type = prof.type === 'venue' ? 'VENUE' : 'PROMOTER';
      const color = prof.type === 'venue' ? '#00E5FF' : '#9D4EDD';
      const avatar = prof.avatar
        ? `<img src="${prof.avatar}" style="width:52px;height:52px;border-radius:50%;object-fit:cover;border:2px solid ${color}44;">`
        : `<div style="width:52px;height:52px;border-radius:50%;background:var(--card);border:2px solid ${color}33;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:20px;color:${color};">${name.charAt(0)}</div>`;
      return `<div onclick="openPublicProfile(${JSON.stringify(prof)})" style="flex-shrink:0;width:120px;background:var(--card2);border:1px solid var(--border);border-radius:14px;padding:14px 10px 12px;text-align:center;cursor:pointer;">
        <div style="display:flex;justify-content:center;margin-bottom:8px;">${avatar}</div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
        <div style="display:inline-block;background:${color}22;color:${color};border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700;letter-spacing:.8px;margin-top:3px;">${type}</div>
        ${_followBtnHtml(hid, name, 'profile', color)}
      </div>`;
    }).filter(Boolean);

    if (!artistCards.length && !hostCards.length) return;

    let html = '';
    if (artistCards.length) {
      html += `<div style="padding:16px 16px 6px;font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:2px;color:#FF2D78;">ARTISTS PLAYING</div>
        <div style="display:flex;gap:10px;overflow-x:auto;padding:4px 16px 12px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">${artistCards.join('')}</div>`;
    }
    if (hostCards.length) {
      html += `<div style="padding:4px 16px 6px;font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:2px;color:#9D4EDD;">HOSTED BY</div>
        <div style="display:flex;gap:10px;overflow-x:auto;padding:4px 16px 16px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">${hostCards.join('')}</div>`;
    }
    wrap.innerHTML = html;
  } catch(e) {}
}
