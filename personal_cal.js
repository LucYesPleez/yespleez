// ═══════════════════════════════════════════════════
//  personal_cal.js — MY SCENE personal calendar
//  Depends on: state.js, navigation.js, follows.js
// ═══════════════════════════════════════════════════

let _peCache       = {};   // dateStr → [event]
let _peSheetDate   = null;
let _peInvited     = [];   // [{user_id, name, type}]
let _peSearchTimer = null;

// ── Load ──────────────────────────────────────────

async function loadPersonalEventsForDate(dateStr) {
  if (!currentUser?.id || DEMO) return [];
  if (_peCache[dateStr]) return _peCache[dateStr];
  try {
    const rows = await sbRest(
      `personal_events?user_id=eq.${currentUser.id}&event_date=eq.${dateStr}&order=created_at.asc`,
      { method: 'GET' }, currentSession?.access_token
    );
    _peCache[dateStr] = Array.isArray(rows) ? rows : [];
  } catch(e) {
    _peCache[dateStr] = [];
  }
  return _peCache[dateStr];
}

// ── Open / close sheet ────────────────────────────

function openAddEventSheet(dateStr) {
  _peSheetDate = dateStr;
  _peInvited   = [];

  const d = new Date(dateStr + 'T12:00:00');
  const dateLabel = d.toLocaleDateString('en-AU', {
    weekday:'long', day:'numeric', month:'long', year:'numeric'
  });

  const lbl = document.getElementById('peSheetDateLabel');
  if (lbl) lbl.textContent = dateLabel.toUpperCase();

  const titleEl = document.getElementById('peSheetTitle');
  const timeEl  = document.getElementById('peSheetTime');
  const notesEl = document.getElementById('peSheetNotes');
  const privEl  = document.getElementById('peSheetPrivate');
  if (titleEl) titleEl.value  = '';
  if (timeEl)  timeEl.value   = '';
  if (notesEl) notesEl.value  = '';
  if (privEl)  privEl.checked = true;

  const invSec = document.getElementById('peInviteSection');
  const invList = document.getElementById('peInviteList');
  const srchIn  = document.getElementById('peSheetSearchInput');
  const srchRes = document.getElementById('peSheetSearchResults');
  if (invSec)  invSec.style.display  = 'none';
  if (invList) invList.innerHTML = '';
  if (srchIn)  srchIn.value  = '';
  if (srchRes) { srchRes.innerHTML = ''; srchRes.style.display = 'none'; }

  _syncPrivateToggle(true);

  const overlay = document.getElementById('peOverlay');
  const sheet   = document.getElementById('peSheet');
  if (!overlay || !sheet) return;
  overlay.style.display = 'block';
  sheet.style.display   = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    sheet.style.transform = 'translateX(-50%) translateY(0)';
  }));
  setTimeout(() => document.getElementById('peSheetTitle')?.focus(), 350);
}

function closePeSheet() {
  const overlay = document.getElementById('peOverlay');
  const sheet   = document.getElementById('peSheet');
  if (sheet)   sheet.style.transform = 'translateX(-50%) translateY(100%)';
  setTimeout(() => {
    if (overlay) overlay.style.display = 'none';
    if (sheet)   sheet.style.display   = 'none';
  }, 300);
}

// ── Private toggle ────────────────────────────────

function peTogglePrivate() {
  const isPrivate = document.getElementById('peSheetPrivate')?.checked ?? true;
  _syncPrivateToggle(isPrivate);
  const invSec = document.getElementById('peInviteSection');
  if (invSec) invSec.style.display = isPrivate ? 'none' : '';
}

function _syncPrivateToggle(isPrivate) {
  const slider = document.getElementById('pePrivateSlider');
  const knob   = document.getElementById('pePrivateKnob');
  if (slider) slider.style.background = isPrivate ? '#BF5FFF' : 'rgba(255,255,255,.15)';
  if (knob)   knob.style.transform    = isPrivate ? 'translateX(0px)' : 'translateX(20px)';
}

// ── Invite search ─────────────────────────────────

function peSearchUsers() {
  clearTimeout(_peSearchTimer);
  const q = document.getElementById('peSheetSearchInput')?.value.trim() || '';
  const resultsEl = document.getElementById('peSheetSearchResults');
  if (!resultsEl) return;

  if (q.length < 2) {
    resultsEl.innerHTML = '';
    resultsEl.style.display = 'none';
    return;
  }

  _peSearchTimer = setTimeout(async () => {
    try {
      const enc  = encodeURIComponent(q);
      const rows = await sbRest(
        `profiles?or=(name.ilike.*${enc}*,dj_name.ilike.*${enc}*)&limit=8&select=user_id,name,dj_name,type`,
        { method: 'GET' }, currentSession?.access_token
      );
      const filtered = (rows || []).filter(r =>
        r.user_id &&
        r.user_id !== currentUser?.id &&
        !_peInvited.some(inv => inv.user_id === r.user_id)
      );

      if (!filtered.length) {
        resultsEl.innerHTML = '<div style="padding:10px 12px;font-size:12px;color:var(--muted);">No results found</div>';
        resultsEl.style.display = '';
        return;
      }

      const typeLabels = {
        artist:'ARTIST', band:'BAND', venue:'VENUE',
        standup:'COMEDY', host:'HOST', punter:'MEMBER'
      };
      resultsEl.innerHTML = filtered.map(r => {
        const name  = r.dj_name || r.name || 'Unknown';
        const tl    = typeLabels[r.type] || 'MEMBER';
        const safeId   = (r.user_id || '').replace(/'/g, "\\'");
        const safeName = name.replace(/'/g, "\\'");
        return `<div onclick="peAddInvite('${safeId}','${safeName}','${r.type || ''}')"
          style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);"
          onmouseenter="this.style.background='rgba(255,255,255,.04)'" onmouseleave="this.style.background=''">
          <div style="flex:1;font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:.5px;color:var(--text);">${name}</div>
          <div style="font-size:10px;color:var(--muted);letter-spacing:1px;">${tl}</div>
        </div>`;
      }).join('');
      resultsEl.style.display = '';
    } catch(e) {
      resultsEl.innerHTML = '';
      resultsEl.style.display = 'none';
    }
  }, 300);
}

function peAddInvite(userId, name, type) {
  if (_peInvited.some(i => i.user_id === userId)) return;
  _peInvited.push({ user_id: userId, name, type });

  const srchIn  = document.getElementById('peSheetSearchInput');
  const srchRes = document.getElementById('peSheetSearchResults');
  if (srchIn)  srchIn.value  = '';
  if (srchRes) { srchRes.innerHTML = ''; srchRes.style.display = 'none'; }

  _renderPeInviteList();
}

function peRemoveInvite(userId) {
  _peInvited = _peInvited.filter(i => i.user_id !== userId);
  _renderPeInviteList();
}

function _renderPeInviteList() {
  const el = document.getElementById('peInviteList');
  if (!el) return;
  if (!_peInvited.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">` +
    _peInvited.map(inv => {
      const safeId   = (inv.user_id || '').replace(/'/g, "\\'");
      const safeName = (inv.name    || '').replace(/'/g, "\\'");
      return `<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(191,95,255,.12);border:1px solid rgba(191,95,255,.3);border-radius:20px;padding:5px 10px 5px 12px;">
        <span style="font-family:'Bebas Neue',sans-serif;font-size:13px;color:#BF5FFF;">${inv.name}</span>
        <button onclick="peRemoveInvite('${safeId}')" style="background:none;border:none;color:rgba(191,95,255,.6);font-size:16px;cursor:pointer;line-height:1;padding:0;">×</button>
      </div>`;
    }).join('') + `</div>`;
}

// ── Save ──────────────────────────────────────────

async function savePeEvent() {
  const titleEl = document.getElementById('peSheetTitle');
  const title   = titleEl?.value.trim() || '';
  if (!title) { showToast('Add a title first', 'error'); titleEl?.focus(); return; }
  if (!currentUser?.id) { showToast('Sign in to save events', 'error'); return; }

  const isPrivate = document.getElementById('peSheetPrivate')?.checked ?? true;
  const time      = document.getElementById('peSheetTime')?.value.trim()  || null;
  const notes     = document.getElementById('peSheetNotes')?.value.trim() || null;

  const saveBtn = document.querySelector('#peSheet button[onclick*="savePeEvent"]');
  if (saveBtn) { saveBtn.textContent = 'SAVING...'; saveBtn.disabled = true; }

  try {
    const rows = await sbRest('personal_events', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        user_id:    currentUser.id,
        title,
        event_date: _peSheetDate,
        time_start: time,
        notes,
        is_private: isPrivate
      })
    }, currentSession?.access_token);

    const saved = Array.isArray(rows) ? rows[0] : rows;

    // Save invites
    if (!isPrivate && _peInvited.length && saved?.id) {
      await sbRest('personal_event_invites', {
        method: 'POST',
        body: JSON.stringify(_peInvited.map(inv => ({
          personal_event_id: saved.id,
          invitee_id:        inv.user_id,
          invitee_name:      inv.name
        })))
      }, currentSession?.access_token);
    }

    // Update cache
    delete _peCache[_peSheetDate]; // force reload next time

    const inviteCount = _peInvited.length;
    closePeSheet();
    showToast(
      isPrivate
        ? `Added to your private calendar`
        : inviteCount
          ? `Saved & ${inviteCount} invite${inviteCount > 1 ? 's' : ''} sent`
          : 'Saved to your scene',
      'success'
    );

    // Re-render day view
    if (typeof _punterSelDate !== 'undefined' && _punterSelDate === _peSheetDate) {
      _renderPunterDayView(_peSheetDate);
    }

  } catch(e) {
    showToast('Could not save — try again', 'error');
    if (saveBtn) { saveBtn.textContent = 'SAVE TO YOUR SCENE →'; saveBtn.disabled = false; }
  }
}

// ── Delete ────────────────────────────────────────

function deletePeEvent(id, dateStr) {
  showToast('Removing…', 'success', 1500, 'UNDO', async () => {
    // They hit undo — do nothing (item not yet deleted at toast time)
  });

  // Optimistic remove from cache immediately
  if (_peCache[dateStr]) {
    _peCache[dateStr] = _peCache[dateStr].filter(ev => ev.id !== id);
  }
  if (typeof _punterSelDate !== 'undefined' && _punterSelDate === dateStr) {
    _renderPunterDayView(dateStr);
  }

  // Then actually delete after undo window
  setTimeout(async () => {
    try {
      await sbRest(
        `personal_events?id=eq.${id}&user_id=eq.${currentUser.id}`,
        { method: 'DELETE' }, currentSession?.access_token
      );
    } catch(e) {
      // Re-load to restore if delete failed
      delete _peCache[dateStr];
      if (typeof _punterSelDate !== 'undefined' && _punterSelDate === dateStr) {
        _renderPunterDayView(dateStr);
      }
    }
  }, 3400);
}

// ── Render personal event cards ───────────────────

function renderPersonalEventCards(events, dateStr) {
  if (!events || !events.length) return '';
  return events.map(ev => {
    const timeStr = ev.time_start
      ? _formatTime(ev.time_start)
      : '';
    const privacy = ev.is_private
      ? `<span style="font-size:9px;color:var(--muted);background:rgba(255,255,255,.06);border-radius:4px;padding:2px 7px;letter-spacing:.8px;font-family:'Bebas Neue',sans-serif;">PRIVATE</span>`
      : `<span style="font-size:9px;color:#BF5FFF;background:rgba(191,95,255,.1);border:1px solid rgba(191,95,255,.25);border-radius:4px;padding:2px 7px;letter-spacing:.8px;font-family:'Bebas Neue',sans-serif;">SHARED</span>`;
    const safeId      = (ev.id || '').replace(/'/g, "\\'");
    const safeDateStr = (dateStr || '').replace(/'/g, "\\'");
    return `<div style="background:rgba(191,95,255,.06);border:1.5px solid rgba(191,95,255,.22);border-radius:12px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:flex-start;gap:10px;">
      <div style="flex:1;min-width:0;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:.5px;color:var(--text);margin-bottom:5px;">${ev.title}</div>
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
          ${timeStr ? `<span style="font-size:12px;color:#BF5FFF;">⏰ ${timeStr}</span>` : ''}
          ${privacy}
        </div>
        ${ev.notes ? `<div style="font-size:12px;color:var(--muted);line-height:1.5;margin-top:7px;">${ev.notes}</div>` : ''}
      </div>
      <button onclick="deletePeEvent('${safeId}','${safeDateStr}')"
        ontouchend="event.preventDefault();deletePeEvent('${safeId}','${safeDateStr}');"
        style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1;padding:0 2px;flex-shrink:0;opacity:.45;touch-action:manipulation;" title="Remove">×</button>
    </div>`;
  }).join('');
}

function _formatTime(t) {
  // Converts "14:30" → "2:30 PM"
  if (!t || !t.includes(':')) return t;
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}
