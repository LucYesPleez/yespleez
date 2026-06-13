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
    btn.style.background   = 'rgba(217,255,79,.15)';
    btn.style.borderColor  = '#D9FF4F';
    btn.style.color        = '#D9FF4F';
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
  const bg    = following ? 'rgba(217,255,79,.15)' : 'rgba(255,255,255,.06)';
  const bc    = following ? '#D9FF4F' : 'rgba(255,255,255,.18)';
  const col   = following ? '#D9FF4F' : 'var(--text)';
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
      bg = 'background:#D9FF4F;';
      textCol = 'color:#0a0a0f;';
    } else if (isToday) {
      bg = 'background:rgba(217,255,79,.12);border:1.5px solid #D9FF4F;';
      textCol = 'color:#D9FF4F;';
    } else {
      bg = 'background:var(--card2);';
      textCol = 'color:var(--text);';
    }

    // Dot: neon yellow for YOUR PICKS days, neon green for regular event days
    const dotColor = isSel ? '#0a0a0f' : isScene ? '#D9FF4F' : 'var(--neon)';
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

// ── Following strip (horizontal chips for each followed entity) ──
function _punterFollowingStrip() {
  if (!_followsCache.length) return '';

  const typeMap = {
    artist:  { color: 'var(--neon2)', rgb: '0,229,255',   label: 'ARTIST'   },
    band:    { color: '#FF8C42',      rgb: '255,140,66',   label: 'BAND'     },
    venue:   { color: '#00E5A0',      rgb: '0,229,160',    label: 'VENUE'    },
    standup: { color: '#FF88AA',      rgb: '255,136,170',  label: 'COMEDY'   },
    host:    { color: '#FF3399',      rgb: '255,51,153',   label: 'PROMOTER' },
  };

  const count = _followsCache.length;
  const chips = _followsCache.map(f => {
    const tc     = typeMap[f.entity_type] || typeMap.artist;
    const safeId = (f.entity_id || '').replace(/'/g, "\\'");
    return `<div style="flex-shrink:0;background:rgba(255,255,255,.04);border:1px solid rgba(${tc.rgb},.3);border-radius:12px;padding:10px 14px;min-width:110px;max-width:140px;cursor:pointer;touch-action:manipulation;">
      <div style="font-size:9px;color:${tc.color};letter-spacing:1.5px;font-family:'Bebas Neue',sans-serif;margin-bottom:4px;">${tc.label}</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.entity_name || 'Unknown'}</div>
      <div style="margin-top:6px;">
        <button onclick="unfollowEntity('${safeId}','${(f.entity_name||'').replace(/'/g,"\\'")}')"
          ontouchend="event.preventDefault();unfollowEntity('${safeId}','${(f.entity_name||'').replace(/'/g,"\\'")}');"
          style="background:none;border:1px solid rgba(255,255,255,.12);color:var(--muted);border-radius:6px;font-family:'Bebas Neue',sans-serif;font-size:10px;letter-spacing:.8px;padding:3px 8px;cursor:pointer;touch-action:manipulation;">
          UNFOLLOW
        </button>
      </div>
    </div>`;
  }).join('');

  return `<div id="punterFollowingStrip" style="padding:20px 16px 0;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;">FOLLOWING</div>
        <div style="background:rgba(217,255,79,.15);border:1px solid rgba(217,255,79,.4);border-radius:20px;padding:3px 10px;font-size:10px;letter-spacing:1px;color:#D9FF4F;font-family:'DM Sans',sans-serif;font-weight:600;">${count} ${count === 1 ? 'ARTIST' : 'ARTISTS & VENUES'}</div>
      </div>
    </div>
    <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">${chips}</div>
  </div>`;
}

// ── Main feed render ──────────────────────────────
function renderPunterFeed() {
  const el = document.getElementById('punterFeedContent');
  if (!el) return;

  // Init month to current if not set
  if (!_punterViewMonth) _punterViewMonth = new Date();

  renderPunterDateStrip();

  // Update weekend sub-label
  const now = new Date();
  const dow = now.getDay();
  // If already in the weekend (Fri/Sat/Sun), anchor to this Friday; otherwise forward to next Friday
  const daysToFri = dow === 5 ? 0 : dow === 6 ? -1 : dow === 0 ? -2 : (5 - dow);
  const fri = new Date(now); fri.setDate(now.getDate() + daysToFri); fri.setHours(0,0,0,0);
  const sun = new Date(fri); sun.setDate(fri.getDate() + 2); sun.setHours(23,59,59,999);
  const wkSub = document.getElementById('punterTabWeekendSub');
  if (wkSub) wkSub.textContent = `${fri.toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'})} – ${sun.toLocaleDateString('en-AU',{day:'numeric',month:'short'})}`;

  const todayStr  = now.toISOString().split('T')[0];
  const twoWeeks  = new Date(now); twoWeeks.setDate(now.getDate() + 14);

  if (typeof calParseDate !== 'function') {
    el.innerHTML = '<div style="text-align:center;padding:60px 16px;color:var(--muted);font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:2px;">LOADING YOUR PICKS...</div>';
    return;
  }

  const all = _calEvents || [];

  // ── YOUR PICKS events ──
  const sceneAll  = all.filter(ev => _isPunterSceneEvent(ev));
  const sceneSoon = sceneAll.filter(ev => {
    const d = calParseDate(ev);
    return d && d >= now;
  }).sort((a,b) => calParseDate(a) - calParseDate(b));

  // Featured = first upcoming scene event (or first upcoming event overall if no follows)
  const featuredEv = sceneSoon[0] || all.filter(ev => {
    const d = calParseDate(ev);
    return d && d >= now && ev.config?._featured;
  })[0];

  // ── Standard buckets ──
  const tonight  = all.filter(ev => {
    const d = calParseDate(ev);
    return d && d.toISOString().split('T')[0] === todayStr;
  });
  const weekend  = all.filter(ev => {
    const d = calParseDate(ev);
    return d && d >= fri && d <= sun && d.toISOString().split('T')[0] !== todayStr;
  });
  const comingUp = all.filter(ev => {
    const d = calParseDate(ev);
    if (!d) return false;
    if (d.toISOString().split('T')[0] === todayStr) return false;
    if (d >= fri && d <= sun) return false;
    return d > now && d <= twoWeeks;
  }).sort((a,b) => calParseDate(a) - calParseDate(b));

  const todayBadge   = now.toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'long' }).toUpperCase();
  const weekendBadge = `${fri.toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'})} – ${sun.toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'})}`.toUpperCase();

  let html = '';

  // ── YOUR PICKS section ──
  if (_followsCache.length && sceneSoon.length) {
    // Featured hero card for first scene event
    if (featuredEv && typeof calFeaturedCard === 'function') {
      html += `<div id="punterSecScene">`;
      html += `<div style="display:flex;align-items:center;gap:8px;padding:20px 16px 0;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;">YOUR PICKS</div>
        <div style="background:rgba(217,255,79,.15);border:1px solid rgba(217,255,79,.4);border-radius:20px;padding:3px 10px;font-size:10px;letter-spacing:1px;color:#D9FF4F;font-family:'DM Sans',sans-serif;font-weight:600;">ARTISTS YOU FOLLOW</div>
      </div>`;
      html += calFeaturedCard(featuredEv);
      if (sceneSoon.length > 1) {
        html += `<div style="display:flex;gap:12px;overflow-x:auto;padding:12px 16px 4px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">
          ${sceneSoon.slice(1, 6).map(ev => typeof calWhatsOnCard === 'function' ? calWhatsOnCard(ev, 'sm') : '').join('')}
        </div>`;
      }
      html += `</div>`;
    }
  } else if (_followsCache.length && !sceneSoon.length) {
    // User has follows but no matching events
    html += `<div id="punterSecScene" style="margin:20px 16px 0;padding:20px;background:rgba(217,255,79,.05);border:1px dashed rgba(217,255,79,.2);border-radius:16px;text-align:center;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:2px;color:#D9FF4F;margin-bottom:6px;">YOUR PICKS</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.6;">No upcoming gigs from your followed artists yet.<br>Check back soon or explore below.</div>
    </div>`;
  } else {
    // No follows yet — prompt
    html += `<div id="punterSecScene" style="margin:20px 16px 0;padding:20px 20px 18px;background:rgba(217,255,79,.05);border:1px dashed rgba(217,255,79,.2);border-radius:16px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:2px;color:#D9FF4F;margin-bottom:6px;">YOUR PICKS</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:14px;">Follow artists, bands and venues to see their upcoming gigs here first.</div>
      <button onclick="showSearchScreen()" ontouchend="event.preventDefault();showSearchScreen();" style="background:rgba(217,255,79,.12);border:1px solid rgba(217,255,79,.3);color:#D9FF4F;border-radius:10px;padding:10px 18px;font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:1.5px;cursor:pointer;touch-action:manipulation;">DISCOVER ARTISTS →</button>
    </div>`;
  }

  // ── SUGGESTED FOR YOU ──
  const interestGenres = (window._punterProfile?.genre_string || '').toLowerCase().split(/[,·]/).map(s => s.trim()).filter(Boolean);
  const userPostcode   = parseInt(window._punterProfile?.postcode || '0', 10);
  if (userPostcode || interestGenres.length) {
    const alreadyShown = new Set(sceneSoon.map(e => e.id));
    const suggestedEvs = all.filter(ev => {
      if (alreadyShown.has(ev.id)) return false;
      const d = calParseDate(ev);
      if (!d || d < now) return false;
      const evPostcode = parseInt(ev.config?.postcode || '0', 10);
      const nearbyPc = userPostcode && evPostcode ? evPostcode === userPostcode : true;
      if (!nearbyPc) return false;
      if (!interestGenres.length) return true;
      const evText = ((ev.name || '') + ' ' + (ev.config?.genres || '')).toLowerCase();
      return interestGenres.some(g => g.length > 2 && evText.includes(g));
    }).sort((a,b) => calParseDate(a) - calParseDate(b)).slice(0, 8);

    html += `<div id="punterSuggestSection" style="display:none;">
      <div style="padding:20px 16px 4px;display:flex;align-items:center;gap:8px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;">IN YOUR AREA</div>
        <div style="background:rgba(0,229,255,.12);border:1px solid rgba(0,229,255,.3);border-radius:20px;padding:3px 10px;font-size:10px;letter-spacing:1px;color:var(--neon2);font-family:'DM Sans',sans-serif;font-weight:600;">NEAR YOU</div>
      </div>
      ${suggestedEvs.length ? `<div style="display:flex;gap:12px;overflow-x:auto;padding:4px 16px 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">
        ${suggestedEvs.map(ev => typeof calWhatsOnCard === 'function' ? calWhatsOnCard(ev, 'sm') : '').join('')}
      </div>` : ''}
      <div id="punterNearbyProfiles" style="padding:0 16px 12px;"></div>
    </div>`;

    // Show section immediately if there are events, then async-fill profiles
    if (suggestedEvs.length) {
      const sec = document.getElementById('punterSuggestSection');
      if (sec) sec.style.display = '';
    }
    if (userPostcode) setTimeout(() => _loadNearbyProfiles(userPostcode), 0);
  }

  // ── Standard sections ──
  html += _punterSection('punterSecTonight',  'TONIGHT',      todayBadge,    '#FF2D78', tonight,  'sm');
  html += _punterSection('punterSecWeekend',  'THIS WEEKEND', weekendBadge,  '#9D4EDD', weekend,  'lg');
  html += _punterSection('punterSecUpcoming', 'COMING UP',    'NEXT 2 WEEKS','#D9FF4F', comingUp, 'list');

  // ── Following strip ──
  html += _punterFollowingStrip();

  // ── Nothing at all ──
  const total = tonight.length + weekend.length + comingUp.length;
  if (total === 0 && !sceneSoon.length) {
    html += `<div style="text-align:center;padding:40px 16px 20px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:3px;color:var(--muted);margin-bottom:10px;">QUIET OUT THERE</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:20px;">No upcoming events right now.<br>Check back soon.</div>
      <button onclick="showCalendar()" ontouchend="event.preventDefault();showCalendar();" style="background:none;border:1px solid var(--border);color:var(--text);border-radius:20px;padding:10px 24px;font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:1px;cursor:pointer;">EXPLORE ALL EVENTS</button>
    </div>`;
  }

  el.innerHTML = html;
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
    <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1.5px;color:#D9FF4F;line-height:1;flex:1;text-align:center;">${dayLabel}</div>
    <button onclick="openAddEventSheet('${safeDate}')" ontouchend="event.preventDefault();openAddEventSheet('${safeDate}');" style="background:#D9FF4F;color:#0a0a0f;border:none;border-radius:20px;padding:7px 14px;font-size:12px;letter-spacing:1px;font-family:'Bebas Neue',sans-serif;cursor:pointer;touch-action:manipulation;flex-shrink:0;font-weight:700;">+ ADD</button>
  </div>`;

  // ── Personal events (async load) ──
  html += `<div id="peDayEventsWrap"></div>`;

  // ── Platform events as horizontal scroll ──
  if (!evs.length) {
    html += `<div style="text-align:center;padding:40px 0 20px;color:var(--muted);">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:2px;margin-bottom:8px;">QUIET NIGHT</div>
      <div style="font-size:13px;line-height:1.6;">No YesPleez events on this date.</div>
    </div>`;
  } else {
    const sceneEvs = evs.filter(ev => _isPunterSceneEvent(ev));
    const otherEvs = evs.filter(ev => !_isPunterSceneEvent(ev));
    const allEvs   = [...sceneEvs, ...otherEvs];

    if (sceneEvs.length) {
      html += `<div style="font-family:'Bebas Neue',sans-serif;font-size:12px;letter-spacing:2px;color:#D9FF4F;padding:0 16px 8px;">YOUR PICKS</div>`;
    }
    // All events in a horizontal scroll using the same card style as calendar
    html += `<div style="display:flex;gap:12px;overflow-x:auto;padding:4px 16px 12px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">
      ${allEvs.map(ev => typeof calWhatsOnCard === 'function' ? calWhatsOnCard(ev, 'lg') : '').join('')}
    </div>`;
  }

  // ── Placeholder for artists / hosts / venues on this day ──
  html += `<div id="peDayPeopleWrap"></div>`;

  el.innerHTML = html;

  // Load personal events
  const peEvs  = await (typeof loadPersonalEventsForDate === 'function'
    ? loadPersonalEventsForDate(dateStr) : Promise.resolve([]));
  const peWrap = document.getElementById('peDayEventsWrap');
  if (peWrap && peEvs.length) {
    peWrap.innerHTML =
      `<div style="font-family:'Bebas Neue',sans-serif;font-size:12px;letter-spacing:2px;color:#D9FF4F;padding:0 16px 10px;border-bottom:1px solid rgba(217,255,79,.2);margin-bottom:10px;">ON YOUR CALENDAR</div>` +
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
