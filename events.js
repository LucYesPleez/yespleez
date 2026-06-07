// ═══════════════════════════════════════════════════
//  events.js — YesPleez Events Module
//  Covers: event CRUD, slot management, claims, manage screen,
//          genre/vibe pickers, profile UI, applications, poster upload,
//          nominatim location search, artist event view, demo overrides
//  Depends on: state.js, auth.js (sbRest, sbFetch), navigation.js,
//              notifications.js (pushNotif), audio.js (openMiniPlayer)
// ═══════════════════════════════════════════════════

// ── Starred slots (host pin) ───────────────────────
let _starredSlots = {};
let lockedSlots   = {};

// ── Event list ─────────────────────────────────────

async function loadUserEvents() {
  const listEl = document.getElementById('eventList');
  listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">Loading...</div>';
  try {
    const rows = await sbRest(
      `events?host_id=eq.${currentUser.id}&order=created_at.desc`,
      {}, currentSession.access_token
    );
    allEvents = rows;
    renderEventList();
  } catch(e) {
    listEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--neon);font-size:13px;">Could not load events ${e.message}</div>`;
  }
}

function renderEventList() {
  const listEl = document.getElementById('eventList');
  listEl.innerHTML = '';
  if (!allEvents.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:13px;">No events yet. Create your first one below.</div>';
    return;
  }
  allEvents.forEach(ev => {
    const card = document.createElement('div');
    card.className = 'event-card' + (ev.status==='live' ? ' active-event' : '');
    const cfg = ev.config || {};
    const slotCount = (cfg.days||[]).reduce((n,d)=>n+d.slots.length,0);
    const isLive = ev.status === 'live';
    card.innerHTML = `
      <div class="event-card-info" style="min-width:0;flex:1;">
        <div class="event-card-name">${esc(ev.name || 'Untitled Event')}</div>
        <div class="event-card-meta">${esc([cfg.date, cfg.venue].filter(Boolean).join(' · '))} · ${slotCount} slots</div>
        ${isLive ? `<div style="margin-top:8px;">
          <button class="btn-ghost" style="font-size:11px;padding:5px 12px;border-color:var(--gold);color:var(--gold);" id="ac-${ev.id}">ALL CLAIMS</button>
        </div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
        <span class="event-card-status ${isLive?'live':'draft'}">${isLive?'LIVE':'DRAFT'}</span>
        <button class="btn-signout" style="font-size:10px;padding:4px 12px;" id="edit-${ev.id}">EDIT →</button>
      </div>
    `;
    card.onclick = (e) => {
      if (!e.target.closest('button')) {
        if (isLive) openAllClaims(ev);
        else openEvent(ev);
      }
    };
    if (isLive) {
      card.querySelector('#ac-' + ev.id).onclick = (e) => { e.stopPropagation(); openAllClaims(ev); };
    }
    card.querySelector('#edit-' + ev.id).onclick = (e) => { e.stopPropagation(); openEvent(ev); };
    listEl.appendChild(card);
  });
}

// ── Event navigation ───────────────────────────────

function openEventSetTimes(ev) {
  currentEventId = ev.id;
  eventData = ev.config || {};
  eventData.id = ev.id;
  currentEventHostId = ev.host_id || null;
  isHost = true;
  hostControls = ev.host_controls || { artistRemove: true, rankedBackups: true, genrePicker: true };
  document.getElementById('shareLinkBtn').style.display = '';
  loadClaims().then(() => showSignup());
}

function openAllClaims(ev) {
  currentEventId = ev.id;
  eventData = ev.config || {};
  eventData.id = ev.id;
  // Ensure name and poster are available from top-level event fields if not in config
  if (!eventData.name && ev.name) eventData.name = ev.name;
  if (!eventData.poster && ev.poster) eventData.poster = ev.poster;
  currentEventHostId = ev.host_id || null;
  isHost = true;
  hostControls = ev.host_controls || { artistRemove: true, rankedBackups: true, genrePicker: true };
  setTimesLocked = ev.host_controls?.setTimesLocked || false;
  loadClaims().then(() => {
    show('manageScreen');
    renderManage();
    const btn = document.getElementById('lockTimesBtn');
    if (btn) { btn.textContent = setTimesLocked ? '🔒 SET TIMES LOCKED' : '🔒 LOCK SET TIMES'; btn.classList.toggle('locked', setTimesLocked); }
  });
}

function openEvent(ev) {
  currentEventId = ev.id;
  eventData = ev.config || {};
  eventData.id = ev.id;
  currentEventHostId = ev.host_id || null;
  isHost = true;
  hostControls = ev.host_controls || { artistRemove: true, rankedBackups: true, genrePicker: true };
  document.getElementById('shareLinkBtn').style.display = ev.status === 'live' ? '' : 'none';
  if (ev.status === 'live') {
    showSignup();
  } else {
    buildTemplate(eventData);
    show('templateScreen');
    document.getElementById('templateH1').textContent = 'EDIT\nEVENT';
  }
}

function startNewEvent() {
  currentEventId = null;
  eventData = {};
  isHost = true;
  buildTemplate({});
  document.getElementById('templateH1').textContent = 'SET UP\nYOUR EVENT';
  show('templateScreen');
}

// ── Template builder ───────────────────────────────

function buildTemplate(ev) {
  document.getElementById('inEventName').value = ev?.name   || '';
  document.getElementById('inDate').value      = ev?.date   || '';
  const parsed = parseDateToInput(ev?.date || '');
  const startEl = document.getElementById('inDateStart');
  const endEl   = document.getElementById('inDateEnd');
  if (startEl) startEl.value = parsed.start;
  if (endEl)   endEl.value   = parsed.end;
  document.getElementById('inVenue').value     = ev?.venue  || '';
  document.getElementById('inGenres').value    = ev?.genres || '';
  const poster = ev?.poster || '';
  document.getElementById('inPoster').value = poster;
  if (poster) {
    document.getElementById('posterPreview').src = poster;
    document.getElementById('posterPreviewWrap').style.display = 'block';
    document.getElementById('posterPlaceholder').style.display = 'none';
  } else {
    document.getElementById('posterPreviewWrap').style.display = 'none';
    document.getElementById('posterPlaceholder').style.display = 'flex';
  }
  const hc = ev?.host_controls || hostControls;
  document.getElementById('toggleArtistRemove').checked  = hc.artistRemove  !== false;
  document.getElementById('toggleRankedBackups').checked = hc.rankedBackups !== false;
  document.getElementById('toggleGenrePicker').checked   = hc.genrePicker   !== false;
  document.getElementById('togglePrivateSetTimes').checked = hc.privateSetTimes === true;
  document.getElementById('toggleSlipMode').checked = hc.slipMode === true;
  const builder = document.getElementById('daysBuilder');
  builder.innerHTML = '';
  (ev?.days || []).forEach(d => addDayCard(d));
  document.getElementById('saveStatus').textContent = '';
  const delWrap = document.getElementById('deleteEventWrap');
  if (delWrap) delWrap.style.display = (currentEventId && isHost) ? 'block' : 'none';
}

function validateQGTimes() {
  const startEl = document.getElementById('qgStart');
  const endEl   = document.getElementById('qgEnd');
  if (!startEl || !endEl || !startEl.value || !endEl.value) return;
  const [sh, sm] = startEl.value.split(':').map(Number);
  const [eh, em] = endEl.value.split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins   = eh * 60 + em;
  if (startMins === endMins) showToast('Start and end time can\'t be the same.', 'error');
}

function toggleCustomLen(sel) {
  document.getElementById('qgCustomField').style.display = sel.value === 'custom' ? '' : 'none';
}

function drumStep(id, dir) {
  const el = document.getElementById(id + 'Val');
  if (!el) return;
  if (id.endsWith('H')) {
    let v = parseInt(el.textContent) + dir;
    if (v < 1) v = 12; if (v > 12) v = 1;
    el.textContent = v;
  } else if (id.endsWith('OM')) {
    let v = parseInt(el.textContent) + dir * 5;
    if (v < 5) v = 5; if (v > 360) v = 360;
    el.textContent = v;
  } else {
    const mins = [0,5,10,15,20,25,30,35,40,45,50,55];
    let idx = mins.indexOf(parseInt(el.textContent));
    if (idx === -1) idx = 0;
    idx = (idx + dir + mins.length) % mins.length;
    el.textContent = String(mins[idx]).padStart(2,'0');
  }
}

function drumToggleAMPM(id) {
  const el = document.getElementById(id + 'Val');
  if (el) el.textContent = el.textContent.trim() === 'AM' ? 'PM' : 'AM';
}

function drumKey(e, id) {
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown') { e.preventDefault(); drumStep(id, -1); }
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp')   { e.preventDefault(); drumStep(id,  1); }
  if (e.key === ' ' && id.endsWith('AP')) { e.preventDefault(); drumToggleAMPM(id); }
}

function validateDates() {
  const today = new Date().toISOString().split('T')[0];
  const startEl = document.getElementById('inDateStart');
  const endEl   = document.getElementById('inDateEnd');
  if (!startEl || !endEl) return;
  startEl.min = today;
  if (startEl.value && startEl.value < today) {
    startEl.value = today;
    showToast('Start date can\'t be in the past.', 'error');
  }
  if (startEl.value) endEl.min = startEl.value;
  if (endEl.value && startEl.value && endEl.value < startEl.value) {
    endEl.value = startEl.value;
    showToast('End date can\'t be before start date.', 'error');
  }
  updateDateField();
}

document.addEventListener('DOMContentLoaded', () => {
  const today = new Date().toISOString().split('T')[0];
  const s = document.getElementById('inDateStart');
  const e = document.getElementById('inDateEnd');
  if (s) s.min = today;
  if (e) e.min = today;
});

function updateDateField() {
  const start = document.getElementById('inDateStart')?.value;
  const end   = document.getElementById('inDateEnd')?.value;
  const hidden = document.getElementById('inDate');
  if (!hidden) return;
  if (start && end && end !== start) {
    const s = new Date(start + 'T12:00:00');
    const e = new Date(end   + 'T12:00:00');
    const sMonth = s.toLocaleString('en-AU', { month: 'long' });
    const eMonth = e.toLocaleString('en-AU', { month: 'long' });
    const sDay   = s.getDate();
    const eDay   = e.getDate();
    hidden.value = sMonth === eMonth
      ? `${sMonth} ${sDay} / ${eDay}`
      : `${sMonth} ${sDay} / ${eMonth} ${eDay}`;
  } else if (start) {
    const s = new Date(start + 'T12:00:00');
    hidden.value = s.toLocaleString('en-AU', { month: 'long', day: 'numeric' });
  } else {
    hidden.value = '';
  }
}

function parseDateToInput(dateStr) {
  if (!dateStr) return { start: '', end: '' };
  const year = new Date().getFullYear();
  const months = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
  const parts = dateStr.toLowerCase().split('/').map(s => s.trim());
  function parseOne(str, fallbackMonth) {
    const words = str.split(' ').filter(Boolean);
    let month = fallbackMonth, day = null;
    words.forEach(w => {
      if (months[w]) month = months[w];
      if (/^\d+$/.test(w)) day = parseInt(w);
    });
    if (!day) return '';
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  const startDate = parseOne(parts[0], 1);
  const m = startDate ? parseInt(startDate.split('-')[1]) : 1;
  const endDate = parts[1] ? parseOne(parts[1], m) : '';
  return { start: startDate, end: endDate };
}

function generateSlots() {
  const numDays  = parseInt(document.getElementById('qgDays').value) || 1;
  const startStr = document.getElementById('qgStart').value || '16:00';
  const endStr   = document.getElementById('qgEnd').value   || '23:30';
  const lenVal   = document.getElementById('qgLen').value;
  const slotMin  = lenVal === 'custom'
    ? (parseInt(document.getElementById('qgCustomMins').value) || 60)
    : (parseInt(lenVal) || 90);
  const [sh, sm] = startStr.split(':').map(Number);
  const [eh, em] = endStr.split(':').map(Number);
  let startMins = sh * 60 + sm;
  let endMins   = eh * 60 + em;
  if (endMins <= startMins) endMins += 24 * 60;
  const slots = [];
  let cur = startMins;
  while (cur + slotMin <= endMins) {
    const h24  = Math.floor(cur / 60) % 24;
    const mm   = cur % 60;
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    const h12  = h24 % 12 || 12;
    const dur  = slotMin === 60 ? '1 hr' : slotMin === 90 ? '1.5 hrs' : slotMin === 120 ? '2 hrs' : slotMin + ' mins';
    slots.push({ time: `${h12}:${mm.toString().padStart(2,'0')}`, ampm, dur, label: '' });
    cur += slotMin;
  }
  if (!slots.length) { showToast('No slots fit in that time range.', 'error'); return; }
  const builder = document.getElementById('daysBuilder');
  builder.innerHTML = '';
  for (let d = 0; d < numDays; d++) {
    addDayCard({ name: numDays > 1 ? `Day ${d+1}` : '', slots });
  }
  showToast(`✅ Generated ${slots.length} slots × ${numDays} day${numDays>1?'s':''}`, 'success');
}

function addDayCard(prefill) {
  const n = document.querySelectorAll('.day-card').length + 1;
  const builder = document.getElementById('daysBuilder');
  const card = document.createElement('div');
  card.className = 'day-card';
  card.innerHTML = `
    <div class="day-card-header">
      <div class="day-num">DAY ${n}</div>
      <input class="day-name-input" type="text" placeholder="e.g. Saturday June 20" value="${esc(prefill?.name||'')}">
      <button class="btn-remove-day" onclick="this.closest('.day-card').remove();renumberDays()">✕</button>
    </div>
    <div class="slots-inner"></div>
    <button class="btn-add-slot" onclick="addSlotRow(this.previousElementSibling)">+ Add Slot</button>
  `;
  builder.appendChild(card);
  const inner = card.querySelector('.slots-inner');
  if (prefill?.slots?.length) prefill.slots.forEach(s => addSlotRow(inner, s));
  else addSlotRow(inner);
}

function renumberDays() {
  document.querySelectorAll('.day-card').forEach((c,i) => c.querySelector('.day-num').textContent = 'DAY '+(i+1));
}

function addSlotRow(container, prefill) {
  const wrap = document.createElement('div');
  wrap.className = 'slot-row-wrap';
  const timeVal  = prefill?.time  || '';
  const ampmVal  = prefill?.ampm  || 'PM';
  const durVal   = prefill?.dur   || '';
  const labelVal = prefill?.label || '';
  let h = 8, m = 0;
  if (timeVal) {
    const parts = timeVal.split(':');
    h = parseInt(parts[0]) || 8;
    m = parseInt(parts[1]) || 0;
  }
  const durMap = { '1 hr': '60', '1.5 hrs': '90', '2 hrs': '120' };
  const chipVal = durMap[durVal] || 'other';
  const otherMins = chipVal === 'other' ? (parseInt(durVal) || 45) : 45;
  const uid = 'sr' + Math.random().toString(36).slice(2,8);
  const hourOpts = [1,2,3,4,5,6,7,8,9,10,11,12]
    .map(v => `<option value="${v}"${v===h?' selected':''}>${v}</option>`).join('');
  const minOpts = [0,5,10,15,20,25,30,35,40,45,50,55]
    .map(v => `<option value="${v}"${v===m?' selected':''}>${String(v).padStart(2,'0')}</option>`).join('');
  const otherOpts = Array.from({length:71},(_,i)=>(i+1)*5)
    .map(v => `<option value="${v}"${v===otherMins?' selected':''}>${v} mins</option>`).join('');
  const selStyle = `background:var(--dark);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:14px;padding:8px 6px;outline:none;appearance:none;-webkit-appearance:none;width:100%;text-align:center;cursor:pointer;`;
  wrap.innerHTML = `
    <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;">
      <div style="flex:1;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px;">
          <div>
            <div style="font-size:9px;letter-spacing:2px;color:var(--muted);font-family:'Bebas Neue',sans-serif;margin-bottom:3px;text-align:center;">HR</div>
            <select id="${uid}H" style="${selStyle}">${hourOpts}</select>
          </div>
          <div>
            <div style="font-size:9px;letter-spacing:2px;color:var(--muted);font-family:'Bebas Neue',sans-serif;margin-bottom:3px;text-align:center;">MIN</div>
            <select id="${uid}M" style="${selStyle}">${minOpts}</select>
          </div>
          <div>
            <div style="font-size:9px;letter-spacing:2px;color:var(--muted);font-family:'Bebas Neue',sans-serif;margin-bottom:3px;text-align:center;">AM/PM</div>
            <select id="${uid}AP" style="${selStyle}">
              <option value="AM"${ampmVal==='AM'?' selected':''}>AM</option>
              <option value="PM"${ampmVal==='PM'?' selected':''}>PM</option>
            </select>
          </div>
        </div>
        <div class="dur-chips" style="margin-bottom:6px;">
          <button type="button" class="dur-chip${chipVal==='60'?' selected':''}" data-val="60" onclick="selectSlotDurChip(this,'${uid}')">1 HR</button>
          <button type="button" class="dur-chip${chipVal==='90'?' selected':''}" data-val="90" onclick="selectSlotDurChip(this,'${uid}')">1.5 HRS</button>
          <button type="button" class="dur-chip${chipVal==='120'?' selected':''}" data-val="120" onclick="selectSlotDurChip(this,'${uid}')">2 HRS</button>
          <button type="button" class="dur-chip${chipVal==='other'?' selected':''}" data-val="other" onclick="selectSlotDurChip(this,'${uid}')">OTHER</button>
        </div>
        <div id="${uid}OtherWrap" style="display:${chipVal==='other'?'block':'none'};margin-bottom:6px;">
          <select id="${uid}OM" style="${selStyle};max-width:140px;">${otherOpts}</select>
        </div>
        <input class="sr-label-input" type="text" placeholder='Special label e.g. "Sunset Set 🌅" (optional)' value="${esc(labelVal)}">
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;margin-top:22px;">
        <button class="btn-remove-slot" onclick="askRemoveSlot(this.closest('.slot-row-wrap'))">✕</button>
        <button class="btn-add-slot-inline" onclick="saveSlotHistory();insertSlotAfter(this.closest('.slot-row-wrap'))">＋</button>
      </div>
    </div>
  `;
  wrap.dataset.uid = uid;
  if (prefill?.id) wrap.dataset.slotId = prefill.id;
  const insertBtn = document.createElement('button');
  insertBtn.className = 'btn-insert-slot';
  insertBtn.textContent = '＋ insert slot here';
  insertBtn.onclick = () => openInsertSlot(wrap);
  wrap.insertBefore(insertBtn, wrap.firstChild);
  container.appendChild(wrap);
  requestAnimationFrame(() => {
    const card = container.closest('.day-card');
    if (card) {
      attachConflictCheck(wrap, card);
      initSlotDrag(wrap, card);
    }
  });
}

function insertSlotAfter(wrap) {
  const container  = wrap.parentNode;
  const card       = container.closest('.day-card');
  const nextSib    = wrap.nextElementSibling;
  addSlotRow(container);
  const newRow = container.lastElementChild;
  if (newRow && newRow !== wrap) container.insertBefore(newRow, nextSib);
  if (card) setTimeout(() => checkSlotConflicts(card, null), 200);
}

function selectSlotDurChip(btn, uid) {
  const wrap = btn.closest('.slot-row-wrap');
  wrap.querySelectorAll('.dur-chip').forEach(c => c.classList.remove('selected'));
  btn.classList.add('selected');
  const val = btn.dataset.val;
  const ow = document.getElementById(uid + 'OtherWrap');
  if (ow) ow.style.display = val === 'other' ? 'block' : 'none';
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function readForm() {
  const days = [];
  document.querySelectorAll('.day-card').forEach((card, di) => {
    const name = card.querySelector('.day-name-input').value.trim();
    const slots = [];
    card.querySelectorAll('.slot-row-wrap').forEach((wrap, si) => {
      const uid = wrap.dataset.uid;
      let time = '', ampm = '', dur = '';
      if (uid) {
        const hEl  = document.getElementById(uid + 'H');
        const mEl  = document.getElementById(uid + 'M');
        const apEl = document.getElementById(uid + 'AP');
        if (hEl && mEl && apEl) {
          time = hEl.value + ':' + String(mEl.value).padStart(2,'0');
          ampm = apEl.value;
        }
        const chip = wrap.querySelector('.dur-chip.selected');
        const val  = chip?.dataset?.val || '90';
        if (val === '60') dur = '1 hr';
        else if (val === '90') dur = '1.5 hrs';
        else if (val === '120') dur = '2 hrs';
        else { const om = document.getElementById(uid + 'OM'); dur = (om?.value || '45') + ' mins'; }
      } else {
        time  = wrap.querySelector('.sr-time')?.value.trim() || '';
        ampm  = wrap.querySelector('.sr-ampm')?.value.trim() || '';
        dur   = wrap.querySelector('.sr-dur')?.value.trim()  || '';
      }
      const label = wrap.querySelector('.sr-label-input')?.value.trim() || '';
      const slotId = wrap.dataset.slotId || `d${di}s${si}`;
      if (time) slots.push({ id: slotId, time, ampm, dur, label });
    });
    if (name || slots.length) days.push({ name, slots });
  });
  return {
    name:   document.getElementById('inEventName').value.trim(),
    date:   document.getElementById('inDate').value.trim(),
    venue:  document.getElementById('inVenue').value.trim(),
    genres: document.getElementById('inGenres').value.trim(),
    poster: document.getElementById('inPoster').value || '',
    days,
    host_controls: {
      artistRemove:  document.getElementById('toggleArtistRemove').checked,
      rankedBackups: document.getElementById('toggleRankedBackups').checked,
      genrePicker:   document.getElementById('toggleGenrePicker').checked,
      privateSetTimes: document.getElementById('togglePrivateSetTimes').checked,
      slipMode: document.getElementById('toggleSlipMode').checked,
    }
  };
}

// ── Launch / save event ────────────────────────────

async function launchEvent() {
  const cfg = readForm();
  if (!cfg.name) { document.getElementById('inEventName').focus(); showToast('Please enter an event name.', 'error'); return; }
  const total = cfg.days.reduce((n,d) => n+d.slots.length, 0);
  if (!total) { showToast('Please add at least one time slot.', 'error'); return; }
  const existingClaims = Object.keys(claims || {}).length;
  if (existingClaims > 0 && !window._launchConfirmed) {
    window._launchConfirmed = false;
    document.getElementById('editEventOverlay').classList.add('open');
    return;
  }
  window._launchConfirmed = false;
  const btn = document.getElementById('launchBtn');
  btn.disabled = true; btn.textContent = 'SAVING...';
  const statusEl = document.getElementById('saveStatus');
  statusEl.textContent = '';
  try {
    const token = currentSession.access_token;
    let ev;
    if (currentEventId) {
      const rows = await sbRest(
        `events?id=eq.${currentEventId}`,
        { method: 'PATCH', body: JSON.stringify({ name: cfg.name, config: cfg, host_controls: cfg.host_controls, status: 'live', updated_at: new Date().toISOString() }) },
        token
      );
      ev = rows[0] || rows;
    } else {
      const rows = await sbRest(
        'events',
        { method: 'POST', body: JSON.stringify({ name: cfg.name, config: cfg, host_controls: cfg.host_controls, host_id: currentUser.id, status: 'live' }) },
        token
      );
      ev = rows[0] || rows;
      currentEventId = ev.id;
    }
    hostControls = cfg.host_controls;
    eventData = cfg;
    eventData.id = currentEventId;
    btn.disabled = false; btn.textContent = 'GO LIVE →';
    showToast('🎉 Event live!', 'success');
    document.getElementById('shareLinkBtn').style.display = '';
    if (typeof notifyMatchingArtists === 'function') {
      notifyMatchingArtists({ id: currentEventId, name: cfg.name, config: cfg });
    }
    showSignup();
  } catch(e) {
    btn.disabled = false; btn.textContent = 'GO LIVE →';
    statusEl.textContent = `Error: ${e.message}`;
    showToast('Save failed ' + e.message, 'error');
  }
}

function goToTemplate() { buildTemplate(eventData); show('templateScreen'); }
function confirmEditEvent() { closeEditEventModal(); window._launchConfirmed = true; launchEvent(); }
function confirmNewEvent()  { closeEditEventModal(); startNewEvent(); }
function closeEditEventModal() { document.getElementById('editEventOverlay').classList.remove('open'); window._launchConfirmed = false; }

// ── Public event load ──────────────────────────────

async function loadPublicEvent(eventId) {
  try {
    const rows = await sbRest(`events?id=eq.${eventId}&status=eq.live`, {});
    if (!rows.length) { showToast('Event not found or not live.', 'error'); return false; }
    const ev = rows[0];
    currentEventId = ev.id;
    eventData = ev.config || {};
    eventData.id = ev.id;
    if (!eventData.name && ev.name) eventData.name = ev.name;
    if (!eventData.poster && ev.poster) eventData.poster = ev.poster;
    currentEventHostId = ev.host_id || null;
    hostControls = ev.host_controls || { artistRemove: true, rankedBackups: true, genrePicker: true };
    isHost = false;    // public path is always view-only — host must use their dashboard
    isReadOnly = true;
    return true;
  } catch(e) {
    showToast('Could not load event.', 'error'); return false;
  }
}

function showSignupDirect() {
  const eventId = new URLSearchParams(location.search).get('event');
  if (eventId) {
    loadPublicEvent(eventId).then(ok => { if (ok) showSignup(); });
  } else {
    currentUser = { id: 'guest', email: 'guest' };
    currentSession = { access_token: 'guest' };
    currentMode = 'artist';
    enterArtistDashboard();
  }
}

// ── Signup/slot screen ─────────────────────────────

function showSignup() {
  show('signupScreen');
  document.getElementById('eventTitle').textContent  = eventData.name  || '';
  document.getElementById('eventMeta').textContent   = [eventData.date, eventData.venue].filter(Boolean).join(' · ');
  document.getElementById('eventGenres').textContent = eventData.genres || '';
  document.getElementById('manageBtn').style.display    = isHost ? 'inline-block' : 'none';
  const canEdit = isHost && !isReadOnly && currentUser?.id && currentUser.id === currentEventHostId;
  document.getElementById('editBtn').style.display      = canEdit ? 'inline-block' : 'none';
  const posterSrc = eventData.poster || '';
  const posterWrap = document.getElementById('signupPosterWrap');
  const posterImg  = document.getElementById('signupPoster');
  if (posterWrap && posterImg) {
    if (posterSrc) { posterImg.src = posterSrc; posterWrap.style.display = ''; }
    else { posterWrap.style.display = 'none'; }
  }
  document.getElementById('hostPanel').style.display    = isHost ? '' : 'none';

  // Apply bar — shown for non-hosts on non-read-only events
  const applyBar = document.getElementById('applyBar');
  if (applyBar) {
    const showApplyBar = !isHost && currentUser?.id && currentUser.id !== 'guest' && (hostControls.applicationsOpen === true);
    applyBar.style.display = showApplyBar ? '' : 'none';
    if (showApplyBar) {
      // Restore saved code from localStorage
      _eventCode = null;
      _hasApplied = false;
      try {
        const saved = localStorage.getItem(`yp_code_${currentEventId}`);
        if (saved) _eventCode = JSON.parse(saved);
      } catch(e) {}
      updateApplyBarState();
      // Check if already applied
      checkAlreadyApplied();
    }
  }

  if (pollTimer) clearInterval(pollTimer);
  loadClaims();
  pollTimer = setInterval(loadClaims, 5000);
}

function updateApplyBarState() {
  const btn = document.getElementById('applyTopBtn');
  if (!btn) return;
  if (_eventCode) {
    btn.textContent = 'CODE ACCEPTED ✓';
    btn.style.background = 'rgba(0,229,255,.15)';
    btn.style.color = 'var(--neon2)';
    btn.style.border = '1px solid var(--neon2)';
    btn.onclick = null;
    btn.style.cursor = 'default';
    document.getElementById('codeEntryWrap').style.display = 'none';
    document.querySelector('#applyBar button[onclick*="codeEntryWrap"]').style.display = 'none';
  } else if (_hasApplied) {
    btn.textContent = 'APPLICATION SENT ✓';
    btn.style.background = 'rgba(0,229,255,.1)';
    btn.style.color = 'var(--neon2)';
    btn.style.border = '1px solid var(--neon2)';
    btn.onclick = null;
    btn.style.cursor = 'default';
  } else {
    btn.textContent = 'APPLY TO PLAY';
    btn.style.background = 'linear-gradient(135deg,var(--neon2),#00a8ff)';
    btn.style.color = '#0a0a0f';
    btn.style.border = 'none';
    btn.style.cursor = 'pointer';
    btn.onclick = () => openApplyModalForEvent(currentEventId, eventData.name || '');
  }
}

async function checkAlreadyApplied() {
  if (!currentUser?.id || currentUser.id === 'guest' || !currentEventId) return;
  try {
    const rows = await sbRest(
      `applications?event_id=eq.${currentEventId}&artist_id=eq.${currentUser.id}&select=id`,
      { method: 'GET' },
      currentSession?.access_token || null
    );
    if (rows && rows.length) {
      _hasApplied = true;
      updateApplyBarState();
      renderAll();
    }
  } catch(e) {}
}

async function validateEventCode(code) {
  if (!code || !code.trim()) { showToast('Enter a code first', 'error'); return; }
  const clean = code.trim().toUpperCase();
  try {
    const rows = await sbRest(
      `approval_codes?event_id=eq.${currentEventId}&code=eq.${encodeURIComponent(clean)}&select=*`,
      { method: 'GET' },
      currentSession?.access_token || null
    );
    if (!rows || !rows.length) { showToast('Code not recognised', 'error'); return; }
    _eventCode = { code: clean, slotIds: rows[0].slot_ids || null };
    localStorage.setItem(`yp_code_${currentEventId}`, JSON.stringify(_eventCode));
    showToast('Code accepted — slots unlocked ✓', 'success');
    updateApplyBarState();
    renderAll();
  } catch(e) {
    showToast('Could not validate code', 'error');
  }
}

function renderHostSummary() {
  const el = document.getElementById('hostSummary');
  if (!el || !isHost) return;
  const allSlots = [];
  (eventData.days || []).forEach(day => {
    day.slots.forEach(s => allSlots.push({ slot: s, dayName: day.name, claim: claims[s.id] }));
  });
  const filled = allSlots.filter(x => x.claim);
  const empty  = allSlots.filter(x => !x.claim);
  let html = '<div class="host-summary-row header-row"><span>Time</span><span>Artist</span><span>Backups</span><span></span></div>';
  if (!filled.length) {
    html += '<div class="host-summary-row empty-row" style="grid-column:1/-1;padding:14px 16px;">No claims yet — share the artist link to get started.</div>';
  } else {
    filled.forEach(({ slot: s, dayName, claim }) => {
      const locked = lockedSlots[s.id];
      html += `
        <div class="host-summary-row">
          <div><div class="hs-time">${s.time} ${s.ampm}</div><div style="font-size:10px;color:var(--muted);">${dayName||''}</div></div>
          <div><div class="hs-artist">🎧 ${claim.name}</div><div class="hs-genre">${claim.genre||''}</div></div>
          <div class="hs-backups">${(claim.backups||[]).length ? (claim.backups||[]).length + ' backup' + ((claim.backups||[]).length>1?'s':'') : ' '}</div>
          <button class="btn-lock ${locked?'locked':''}" onclick="toggleLock('${s.id}')">${locked ? '📌 ARTIST PINNED' : 'PIN ARTIST'}</button>
        </div>`;
    });
  }
  if (empty.length) html += `<div class="host-summary-row empty-row" style="padding:10px 16px;font-size:11px;">${empty.length} slot${empty.length>1?'s':''} still open</div>`;
  el.innerHTML = html;
}

function toggleLock(slotId) { lockedSlots[slotId] = !lockedSlots[slotId]; renderHostSummary(); }

function timeToMins24(time, ampm, allSlots) {
  if (!time) return 0;
  const [h, m] = time.split(':').map(Number);
  let h24 = h;
  if (ampm === 'AM') { if (h24 === 12) h24 = 0; }
  else               { if (h24 !== 12) h24 += 12; }
  const mins = h24 * 60 + (m || 0);
  // If this is an early AM slot (before 6am) treat it as next day so it sorts after PM slots
  if (h24 < 6) return mins + 24 * 60;
  return mins;
}

function renderAll() {
  const list = document.getElementById('daysList');
  list.innerHTML = '';
  let taken = 0, total = 0;
  const canRemove = isHost || hostControls.artistRemove;
  (eventData.days || []).forEach(day => {
    const sortedSlots = [...(day.slots || [])].sort((a, b) =>
      timeToMins24(a.time, a.ampm) - timeToMins24(b.time, b.ampm)
    );
    const section = document.createElement('div');
    section.className = 'day-section';
    if (day.name) {
      const div = document.createElement('div');
      div.className = 'day-divider';
      div.innerHTML = `<div class="day-divider-name">${day.name}</div><div class="day-divider-line"></div>`;
      section.appendChild(div);
    }
    sortedSlots.forEach(s => {
      const entry    = claims[s.id];
      const isLounge = s.label?.toLowerCase().includes('lounge');
      const isSpecial = s.label && !isLounge;
      if (entry) taken++; total++;
      const slot = document.createElement('div');
      slot.className = 'slot'+(entry?' taken':'')+(isSpecial?' special':'')+(isLounge?' lounge':'');
      const timeBlock = document.createElement('div');
      timeBlock.className = 'time-block';
      timeBlock.innerHTML = `<div class="time-num">${s.time}</div><div class="time-ampm">${s.ampm}</div><div class="time-dur">${s.dur}</div>`;
      const infoBlock = document.createElement('div');
      infoBlock.className = 'slot-info';
      const hint = s.time + ' ' + s.ampm + ' · ' + s.dur + (s.label ? ' · ' + s.label : '');
      if (entry) {
        const pillSource = entry.cardPills || entry.genre || '';
        const genreParts = pillSource.split(' · ').map(p => p.trim()).filter(Boolean).slice(0, 5);
        const pillsHtml = genreParts.length
        ? `<div class="dj-pills" style="margin-top:4px;">${genreParts.map(p => `<span class="dj-pill">${p}</span>`).join('')}</div>`
        : '';
        const soundHtml = entry.sound ? `<span style="color:var(--neon2);font-size:12px;font-style:italic;margin-left:6px;opacity:.85;">• ${entry.sound}</span>` : '';
        infoBlock.innerHTML = `<div class="dj-name-row"><span class="dj-name">🎧 ${entry.name}</span>${soundHtml}</div>${pillsHtml}`;
        if (entry.notes && (isHost || (currentUser && currentUser.id === entry.user_id))) infoBlock.innerHTML += `<div class="dj-note">📝 ${entry.notes}</div>`;
        if (entry.backups?.length) infoBlock.innerHTML += `<div class="rank-badge">+${entry.backups.length} backup${entry.backups.length>1?'s':''}</div>`;
        if (s.label) infoBlock.innerHTML += `<div class="slot-badge ${isLounge?'cyan':''}">${s.label}</div>`;
        if (!isReadOnly) {
          slot.style.cursor = 'pointer';
          slot.onclick = (e) => {
            if (e.target.closest('.btn-clear') || e.target.closest('.btn-also-want') || e.target.closest('.btn-claim')) return;
            openModal(s.id, hint, 1);
            setTimeout(() => {
              document.getElementById('inputName').value  = entry.name  || '';
              document.getElementById('inputNotes').value = entry.notes || '';
              document.getElementById('confirmBtn').textContent = 'SAVE CHANGES ✓';
              restoreGenreVibeState(entry.genre || '');
            }, 40);
          };
        }
      } else {
        infoBlock.innerHTML = `<div class="empty-tag">Open slot</div>`;
        if (s.label) infoBlock.innerHTML += `<div class="slot-badge ${isLounge?'cyan':''}">${s.label}</div>`;
      }
      const actionBlock = document.createElement('div');
      actionBlock.style.cssText = 'display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0;';
      if (!isReadOnly) {
        if (entry) {
          if (canRemove) {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'btn-clear'; clearBtn.textContent = '✕';
            clearBtn.onclick = () => clearSlot(s.id);
            actionBlock.appendChild(clearBtn);
          }
          if (isHost) {
            const want2 = document.createElement('button');
            want2.className = 'btn-also-want'; want2.textContent = 'OPT 2'; want2.onclick = () => openModal(s.id, hint, 2);
            const want3 = document.createElement('button');
            want3.className = 'btn-also-want'; want3.textContent = 'OPT 3'; want3.onclick = () => openModal(s.id, hint, 3);
            actionBlock.appendChild(want2); actionBlock.appendChild(want3);
          }
        } else {
          if (isHost) {
            if (!setTimesLocked) {
              const claimBtn = document.createElement('button');
              claimBtn.className = 'btn-claim'; claimBtn.textContent = 'CLAIM';
              claimBtn.onclick = () => autoClaimSlot(s.id);
              actionBlock.appendChild(claimBtn);
            }
          } else if (_eventCode) {
            // Artist has a valid code — check slot permissions
            const permitted = !_eventCode.slotIds || _eventCode.slotIds.includes(s.id);
            if (permitted && !setTimesLocked) {
              const claimBtn = document.createElement('button');
              claimBtn.className = 'btn-claim'; claimBtn.textContent = 'CLAIM';
              claimBtn.onclick = () => autoClaimSlot(s.id);
              actionBlock.appendChild(claimBtn);
            } else if (!permitted) {
              const noEl = document.createElement('div');
              noEl.style.cssText = 'font-size:10px;color:var(--muted);font-style:italic;text-align:right;';
              noEl.textContent = 'Not in your code';
              actionBlock.appendChild(noEl);
            }
          }
        }
      }
      // Artist can leave their own slot even in read-only view
      if (entry && !isHost && entry.user_id && entry.user_id === currentUser?.id) {
        const leaveBtn = document.createElement('button');
        leaveBtn.style.cssText = 'padding:5px 12px;background:transparent;border:1px solid var(--neon);border-radius:6px;color:var(--neon);font-family:\'Bebas Neue\',sans-serif;font-size:12px;letter-spacing:1px;cursor:pointer;white-space:nowrap;';
        leaveBtn.textContent = 'LEAVE';
        leaveBtn.onclick = () => openLeaveSlotConfirm(s.id);
        actionBlock.appendChild(leaveBtn);
      }
      // Apply button shows for non-hosts with no code when apps are open — outside isReadOnly gate
      if (!entry && !isHost && !_eventCode && hostControls.applicationsOpen && currentUser?.id && currentUser.id !== 'guest') {
        const applyBtn = document.createElement('button');
        applyBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid var(--neon2);border-radius:6px;color:var(--neon2);font-family:\'Bebas Neue\',sans-serif;font-size:13px;letter-spacing:1px;cursor:pointer;white-space:nowrap;';
        applyBtn.textContent = _hasApplied ? 'APPLIED ✓' : 'APPLY';
        applyBtn.disabled = _hasApplied;
        if (!_hasApplied) applyBtn.onclick = () => openApplyModalForEvent(currentEventId, eventData.name || '');
        actionBlock.appendChild(applyBtn);
      }
      slot.appendChild(timeBlock); slot.appendChild(infoBlock); slot.appendChild(actionBlock);
      if (entry) initSlotSwipe(slot, s.id);
      if (_starredSlots[s.id]) {
        slot.classList.add('starred');
        const nameEl = slot.querySelector('.dj-name');
        if (nameEl && !nameEl.querySelector('.star-badge')) nameEl.insertAdjacentHTML('beforeend', '<span class="star-badge">⭐</span>');
      }
      section.appendChild(slot);
    });
    list.appendChild(section);
  });
  document.getElementById('takenCount').textContent = taken;
  document.getElementById('totalCount').textContent = total;
  renderHostSummary();
}

// ── Claim modal ────────────────────────────────────

function openModal(key, hint, preferenceRank) {
  activeKey = key;
  const rank = preferenceRank || 1;
  const rankLabel = rank === 2 ? 'OPTION 2' : rank === 3 ? 'OPTION 3' : 'CLAIM';
  document.querySelector('#overlay .modal h2').textContent = isHost ? 'ASSIGN SLOT' : (rank > 1 ? rankLabel + ' ALSO WANT THIS' : 'CLAIM THIS SLOT');
  document.getElementById('modalHint').textContent = hint + (rank > 1 ? ' · registering as option ' + rank : '');
  document.getElementById('inputName').value  = '';
  document.getElementById('inputNotes').value = '';
  document.getElementById('nameErr').classList.remove('show');
  document.getElementById('confirmBtn').disabled = false;
  document.getElementById('confirmBtn').textContent = isHost ? 'ASSIGN →' : (rank > 1 ? 'ADD AS OPTION ' + rank + ' ✓' : 'LOCK IT IN ✓');
  document.getElementById('inputGenreMain').value = '';
  document.getElementById('subgenreChips').innerHTML = '';
  document.getElementById('subgenreSection').style.display = 'none';
  document.getElementById('multiGenrePicker').style.display = 'none';
  document.getElementById('genreChips').innerHTML = '';
  document.getElementById('multiSubgenreAccordion').innerHTML = '';
  document.querySelectorAll('.vibe-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('genreSection').style.display = hostControls.genrePicker !== false ? '' : 'none';
  document.getElementById('backupSection').style.display = isHost ? 'none' : '';
  const hostSearchEl = document.getElementById('hostArtistSearchSection');
  if (hostSearchEl) {
    hostSearchEl.style.display = isHost ? '' : 'none';
    document.getElementById('hostArtistSearch').value = '';
    document.getElementById('hostArtistResults').style.display = 'none';
    document.getElementById('hostArtistSelected').style.display = 'none';
  }
  const codeSection = document.getElementById('approvalCodeSection');
  const hasCodesForEvent = approvalCodes[currentEventId] && Object.keys(approvalCodes[currentEventId]).length > 0;
  if (codeSection) codeSection.style.display = (isHost || !hasCodesForEvent) ? 'none' : '';
  document.getElementById('inputApprovalCode').value = '';
  document.getElementById('codeErr').classList.remove('show');
  populateBackupSlots(key);
  document.getElementById('overlay').classList.add('open');
  setTimeout(() => document.getElementById('inputName').focus(), 100);
}

async function autoClaimSlot(slotId) {
  if (!currentUser || currentUser.id === 'guest') {
    showToast('Create a profile to claim slots.', 'error');
    setTimeout(() => show('authScreen'), 1200);
    return;
  }
  const name = artistProfile?.djName;
  const genre = artistProfile?.genreString;
  if (!name || !genre) {
    showToast('Complete your profile first — takes 2 mins!', 'error');
    setTimeout(() => showProfile(), 1200);
    return;
  }
  const cardPills = artistProfile?.cardPills || '';
  const ok = await upsertClaim(slotId, name, genre, '', [], cardPills);
  if (ok) {
    claims[slotId] = { name, genre, notes: '', backups: [], cardPills, mixLink: artistProfile?.mixLink || '', user_id: currentUser.id };
    const slotLabel = (() => { let l='slot'; (eventData?.days||[]).forEach(d=>d.slots.forEach(s=>{if(s.id===slotId)l=s.time+' '+s.ampm;})); return l; })();
    pushNotif('🎧', `${name} claimed the ${slotLabel} slot`, 'host');
    renderAll();
    setTimeout(loadClaims, 600);
    showToast(`Slot claimed ✓`, 'success');
  } else {
    showToast('Something went wrong — try again.', 'error');
  }
}

async function searchArtistsForAssign(query) {
  const resultsEl = document.getElementById('hostArtistResults');
  if (!query || query.length < 2) { resultsEl.style.display = 'none'; return; }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?type=eq.artist&dj_name=ilike.*${encodeURIComponent(query)}*&select=user_id,dj_name,genre_string,card_pills,mix_link,soundcloud,mixcloud,instagram,avatar&limit=8`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${currentSession?.access_token || SUPABASE_KEY}` } }
    );
    const artists = res.ok ? await res.json() : [];
    resultsEl.innerHTML = '';
    if (!artists.length) {
      resultsEl.innerHTML = '<div style="padding:10px 12px;font-size:13px;color:var(--muted);">No artists found</div>';
      resultsEl.style.display = 'block';
      return;
    }
    artists.forEach(a => {
      const item = document.createElement('div');
      item.style.cssText = 'padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center;';
      const avatarHtml = a.avatar
        ? `<img src="${a.avatar}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:1.5px solid var(--neon2);flex-shrink:0;" onerror="this.style.display='none'">`
        : `<div style="width:36px;height:36px;border-radius:50%;background:var(--card2);border:1.5px solid var(--neon2);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">🎧</div>`;
      const pillsDisplay = (a.card_pills || a.genre_string || '').split(' · ').filter(Boolean).slice(0, 5).join(' · ');
      item.innerHTML = `${avatarHtml}<div style="min-width:0;"><div style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:var(--text);">${esc(a.dj_name)}</div><div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(pillsDisplay)}</div></div>`;
      item.onmousedown = async (e) => {
        e.preventDefault();
        resultsEl.style.display = 'none';
        document.getElementById('hostArtistSearch').value = '';
        // Auto-assign immediately
        const notes = '';
        const ok = await upsertClaim(activeKey, a.dj_name, a.genre_string || '', notes, [], a.card_pills || '');
        if (ok) {
          claims[activeKey] = { name: a.dj_name, genre: a.genre_string || '', notes: '', backups: [], cardPills: a.card_pills || '', mixLink: a.mix_link || '', user_id: a.user_id };
          const slotLabel = (() => { let l='slot'; (eventData?.days||[]).forEach(d=>d.slots.forEach(s=>{if(s.id===activeKey)l=s.time+' '+s.ampm;})); return l; })();
          pushNotif('🎧', `${a.dj_name} assigned to ${slotLabel}`, 'host');
          closeModal();
          renderManage();
          renderAll();
          setTimeout(loadClaims, 600);
          showToast(`${a.dj_name} assigned ✓`, 'success');
        } else {
          showToast('Assignment failed — try again.', 'error');
        }
      };
      resultsEl.appendChild(item);
    });
    resultsEl.style.display = 'block';
  } catch(e) { console.warn('searchArtistsForAssign error:', e); }
}

function clearArtistSelection() {
  document.getElementById('hostArtistSelected').style.display = 'none';
  document.getElementById('hostArtistSelectedName').textContent = '';
  document.getElementById('hostArtistSelectedGenre').textContent = '';
  document.getElementById('hostArtistSearch').value = '';
  document.getElementById('hostArtistResults').style.display = 'none';
}

function closeModal() { document.getElementById('overlay').classList.remove('open'); activeKey = null; }

async function confirmClaim() {
  const codeInput = document.getElementById('inputApprovalCode');
  const codeErr   = document.getElementById('codeErr');
  if (codeInput && approvalCodes[currentEventId]) {
    const code = codeInput.value.trim().toUpperCase();
    const codeData = approvalCodes[currentEventId]?.[code];
    if (!code) { codeErr.classList.add('show'); codeInput.focus(); return; }
    if (!codeData || codeData.used) { codeErr.classList.add('show'); codeInput.focus(); return; }
    codeErr.classList.remove('show');
  }
  const name = document.getElementById('inputName').value.trim();
  if (!name) { document.getElementById('nameErr').classList.add('show'); document.getElementById('inputName').focus(); return; }
  const mainVal   = document.getElementById('inputGenreMain').value;
  const genres    = getSelectedGenres();
  const subgenres = getSelectedSubgenres();
  const vibes     = getSelectedVibes();
  const uniqueSubs = [...new Set(subgenres)];
  let genreParts;
  if (mainVal === 'Multi Genre') {
    genreParts = genres.length ? [...genres, ...uniqueSubs, ...vibes] : ['Multi Genre', ...uniqueSubs, ...vibes];
  } else {
    genreParts = [mainVal, ...uniqueSubs, ...vibes];
  }
  const genre = genreParts.filter(Boolean).join(' · ');
  const notes   = document.getElementById('inputNotes').value.trim();
  const backups = getBackupSelections();
  document.getElementById('confirmBtn').disabled = true;
  document.getElementById('confirmBtn').textContent = 'SAVING...';
  const cardPills = isHost ? (claims[activeKey]?.cardPills || '') : (artistProfile?.cardPills || '');
  const sound     = isHost ? (claims[activeKey]?.sound     || '') : (artistProfile?.sound     || '');
  const ok = await upsertClaim(activeKey, name, genre, notes, backups, cardPills, sound);
  if (ok) {
    const codeInput = document.getElementById('inputApprovalCode');
    if (codeInput && approvalCodes[currentEventId]) {
      const code = codeInput.value.trim().toUpperCase();
      if (approvalCodes[currentEventId][code]) {
        approvalCodes[currentEventId][code].used = true;
        approvalCodes[currentEventId][code].slotId = activeKey;
      }
    }
    const mixLink = isHost ? (claims[activeKey]?.mixLink || '') : (artistProfile?.mixLink || '');
    claims[activeKey] = { name, genre, notes, backups, mixLink, cardPills, sound, user_id: currentUser?.id || null };
    const slotLabel = (() => { let l='slot'; (eventData?.days||[]).forEach(d=>d.slots.forEach(s=>{if(s.id===activeKey)l=s.time+' '+s.ampm;})); return l; })();
    pushNotif('🎧', `${name} claimed the ${slotLabel} slot`, 'host');
    closeModal();
    if (isHost) { renderManage(); } else { renderAll(); }
    setTimeout(loadClaims, 600);
  } else {
    document.getElementById('confirmBtn').disabled = false;
    document.getElementById('confirmBtn').textContent = 'LOCK IT IN ✓';
    showToast('Something went wrong — check your connection.', 'error');
  }
}

async function clearSlot(id) {
  saveManageState();
  await deleteClaim(id);
  delete claims[id];
  renderManage();
  renderAll();
  setTimeout(loadClaims, 600);
}

// ── Supabase claims CRUD ───────────────────────────

async function sbFetch(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
      ...options.headers
    }
  });
}

async function loadClaims() {
  if (!currentEventId) return;
  try {
    const res = await sbFetch(`claims?event_id=eq.${currentEventId}&select=*`);
    if (!res.ok) throw new Error();
    const rows = await res.json();
    claims = {};
    rows.forEach(r => { claims[r.slot_id] = { name: r.name, genre: r.genre || '', notes: r.notes || '', backups: r.backups || [], cardPills: r.card_pills || '', sound: r.sound || '', mixLink: r.mix_link || '', user_id: r.user_id || null }; });
    setSync(true); renderAll();
  } catch { setSync(false); }
}

async function upsertClaim(slotId, name, genre, notes, backups, cardPills = '', sound = '') {
  const res = await sbFetch('claims', {
    method: 'POST',
    body: JSON.stringify({ event_id: currentEventId, slot_id: slotId, name, genre, notes, backups, card_pills: cardPills, sound, updated_at: new Date().toISOString(), user_id: currentUser?.id || null })
  });
  return res.ok;
}

async function deleteClaim(slotId) {
  try {
    await sbRest(`claims?event_id=eq.${currentEventId}&slot_id=eq.${encodeURIComponent(slotId)}`, { method: 'DELETE' }, currentSession?.access_token || null);
    return true;
  } catch { return false; }
}

function setSync(live) {
  document.getElementById('syncDot').className = 'sync-dot ' + (live ? 'live' : 'error');
  document.getElementById('syncLabel').textContent = live ? 'Live' : 'Offline — retrying...';
}

// ── Genre / vibe pickers ───────────────────────────

const SUBGENRES = {
  'Psytrance': ['Full On', 'Goa', 'Dark Psy', 'Forest Psy', 'Hi-Tech', 'Twilight', 'Psybient', 'Suomi'],
  'Progressive Psy': ['Night Prog', 'Psyprog', 'Prog Trance', 'Minimal Psy', 'Chunk'],
  'Techno': ['Peak Time', 'Hard Techno', 'Schranz', 'Industrial', 'Melodic Techno', 'Atmospheric', 'Raw / Hypnotic', 'Minimal', 'Deep Tech', 'Detroit', 'Acid', 'Rave'],
  'House': ['Tech House', 'Deep House', 'Afro House', 'Organic House', 'UK Garage', '2-Step', 'Progressive House', 'Melodic House', 'Jackin House', 'Funky / Groove', 'Electro House', 'Soulful'],
  'Drum & Bass': ['Liquid', 'Rollers', 'Neurofunk', 'Jump Up', 'Dark / Atmospheric', 'Jungle', 'Techstep', 'Minimal DnB'],
  'Trance': ['Progressive Trance', 'Psy-Trance', 'Dark Psy', 'Hi-Tech', 'Melodic Trance', 'Hard Trance', 'Uplifting Trance', 'Tech Trance', 'Goa Trance'],
  'Breaks': ['Psy Breaks', 'Nu Skool Breaks', 'Electro Breaks', 'Florida Breaks', 'Acid Breaks', 'Big Beat', 'Breakbeat'],
  'Ambient / Downtempo': ['Ambient', 'Chillout', 'Trip-Hop', 'Lo-Fi', 'New Age', 'Drone'],
  'Hard Dance / Hardcore': ['Hard Techno', 'Hardstyle', 'Hardcore', 'Gabber', 'Happy Hardcore', 'UK Hardcore'],
  'Dubstep / Bass': ['Dubstep', 'UK Dubstep', 'Brostep', 'Riddim', 'Bass House', 'UK Bass', 'Future Bass', 'Trap', 'Footwork', 'Halftime', '80 BPM', 'Glitch Hop', 'Leftfield', 'Grime'],
  'Hip-Hop / R&B': ['Boom Bap', 'Trap', 'Lo-Fi Hip Hop', 'G-Funk', 'Neo Soul', 'R&B'],
  'Funk / Soul / Disco': ['Classic Disco', 'Nu Disco', 'Funk', 'Soul', 'Boogie'],
  'Electronica': ['IDM', 'Glitch', 'Indietronica'],
};

const ALL_GENRES = ['Techno','House','Drum & Bass','Breaks','Trance','Psytrance','Progressive Psy','Dubstep / Bass','Hard Dance / Hardcore','Ambient / Downtempo','Electronica','Funk / Soul / Disco','Hip-Hop / R&B','Reggae / Dancehall','World / Global','Experimental','Other'];

function updateSubgenres() {
  const genre = document.getElementById('inputGenreMain').value;
  const singleSection = document.getElementById('subgenreSection');
  const multiPicker   = document.getElementById('multiGenrePicker');
  const genreChipsEl  = document.getElementById('genreChips');
  const subChipsEl    = document.getElementById('subgenreChips');
  singleSection.style.display = 'none'; multiPicker.style.display = 'none'; subChipsEl.innerHTML = '';
  if (genre === 'Multi Genre') {
    multiPicker.style.display = ''; genreChipsEl.innerHTML = '';
    ALL_GENRES.forEach(g => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'vibe-btn'; chip.style.fontSize = '12px'; chip.textContent = g;
      chip.onclick = () => { chip.classList.toggle('selected'); renderMultiSubgenreAccordion(); };
      genreChipsEl.appendChild(chip);
    });
    renderMultiSubgenreAccordion();
  } else if (SUBGENRES[genre]) {
    singleSection.style.display = '';
    SUBGENRES[genre].forEach(s => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'vibe-btn'; chip.style.fontSize = '12px'; chip.textContent = s;
      chip.onclick = () => chip.classList.toggle('selected');
      subChipsEl.appendChild(chip);
    });
  }
}

function renderMultiSubgenreAccordion() {
  const accordion = document.getElementById('multiSubgenreAccordion');
  const selectedGenres = Array.from(document.querySelectorAll('#genreChips .vibe-btn.selected')).map(b => b.textContent.trim());
  accordion.innerHTML = '';
  selectedGenres.forEach(g => {
    const subs = SUBGENRES[g];
    if (!subs?.length) return;
    const block = document.createElement('div'); block.style.cssText = 'margin-bottom:10px;';
    const label = document.createElement('div');
    label.style.cssText = 'font-size:10px;letter-spacing:1.5px;color:var(--neon2);text-transform:uppercase;margin-bottom:6px;font-family:DM Sans,sans-serif;';
    label.textContent = g + ' subgenres'; block.appendChild(label);
    const chipWrap = document.createElement('div'); chipWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:4px;';
    subs.forEach(s => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'vibe-btn'; chip.dataset.genre = g; chip.dataset.sub = s;
      chip.style.fontSize = '11px'; chip.textContent = s;
      chip.onclick = () => chip.classList.toggle('selected');
      chipWrap.appendChild(chip);
    });
    block.appendChild(chipWrap); accordion.appendChild(block);
  });
  if (!selectedGenres.length) {
    accordion.innerHTML = '<div style="font-size:12px;color:var(--muted);font-style:italic;margin-top:4px;">Select genres above to see their subgenres</div>';
  }
}

function getSelectedSubgenres() {
  const single = Array.from(document.querySelectorAll('#subgenreChips .vibe-btn.selected')).map(b => b.textContent.trim());
  const multi  = Array.from(document.querySelectorAll('#multiSubgenreAccordion .vibe-btn.selected')).map(b => b.textContent.trim());
  return [...new Set([...single, ...multi])];
}

function getSelectedGenres() {
  const main = document.getElementById('inputGenreMain').value;
  if (main === 'Multi Genre') return Array.from(document.querySelectorAll('#genreChips .vibe-btn.selected')).map(b => b.textContent.trim());
  return main ? [main] : [];
}

function toggleVibe(btn) { btn.classList.toggle('selected'); }
function getSelectedVibes() { return Array.from(document.querySelectorAll('.vibe-btn.selected')).map(b => b.textContent.trim()); }

function populateBackupSlots(excludeKey) {
  const container = document.getElementById('backupSlots');
  container.innerHTML = '';
  const ranked = hostControls.rankedBackups !== false;
  let count = 0;
  (eventData.days || []).forEach((day, di) => {
    day.slots.forEach((s, si) => {
      const key = s.id || `d${di}s${si}`;
      if (key === excludeKey) return;
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'backup-slot-btn'; btn.dataset.key = key;
      btn.textContent = `${day.name ? day.name + ' · ' : ''}${s.time} ${s.ampm} · ${s.dur}${s.label ? ' · '+s.label : ''}`;
      btn.onclick = function() {
        const selected = container.querySelectorAll('.selected');
        if (this.classList.contains('selected')) {
          this.classList.remove('selected'); this.dataset.rank = '';
          if (ranked) this.textContent = this.textContent.replace(/\s+\[#\d\]/, '');
          renumberRanks(container, ranked);
        } else {
          const maxSel = ranked ? 3 : 2;
          if (selected.length < maxSel) {
            this.classList.add('selected');
            if (ranked) { const rank = selected.length + 1; this.dataset.rank = rank; this.textContent += ` [#${rank}]`; }
          }
        }
      };
      container.appendChild(btn); count++;
    });
  });
  if (!count) container.innerHTML = '<p style="font-size:12px;color:var(--muted);font-style:italic;">No other open slots available</p>';
}

function renumberRanks(container, ranked) {
  if (!ranked) return;
  let rank = 1;
  container.querySelectorAll('.backup-slot-btn.selected').forEach(b => {
    b.textContent = b.textContent.replace(/\s+\[#\d\]/, '') + ` [#${rank}]`;
    b.dataset.rank = rank++;
  });
}

function getBackupSelections() {
  return Array.from(document.querySelectorAll('.backup-slot-btn.selected'))
    .sort((a,b) => (parseInt(a.dataset.rank)||99) - (parseInt(b.dataset.rank)||99))
    .map(b => b.dataset.key);
}

// ── Manage screen ──────────────────────────────────

function showManage() { renderManage(); show('manageScreen'); }

function renderManage() {
  const subtitleEl = document.getElementById('manageSubtitle');
  const listEl     = document.getElementById('manageList');
  listEl.innerHTML = '';
  const totalSlots = (eventData.days||[]).reduce((n,d) => n+d.slots.length, 0);
  const takenSlots = Object.keys(claims).length;
  const titleEl = document.getElementById('manageTitle');
  const slotCountEl = document.getElementById('manageSlotCount');
  if (titleEl) titleEl.textContent = eventData.name || 'EVENT';
  if (subtitleEl) subtitleEl.textContent = [eventData.venue, eventData.date].filter(Boolean).join(' · ');
  if (slotCountEl) slotCountEl.textContent = takenSlots + ' of ' + totalSlots + ' slots filled';
  // Applications toggle state
  const appsOpen = hostControls.applicationsOpen || false;
  const toggleBtn = document.getElementById('appsToggleBtn');
  if (toggleBtn) {
    toggleBtn.textContent = appsOpen ? 'APPLICATIONS: OPEN ✓' : 'APPLICATIONS: CLOSED';
    toggleBtn.style.borderColor = appsOpen ? 'var(--neon2)' : 'var(--border)';
    toggleBtn.style.color = appsOpen ? 'var(--neon2)' : 'var(--muted)';
  }
  // Show poster if available
  const managePosterEl = document.getElementById('managePoster');
  if (managePosterEl) {
    const posterSrc = eventData.poster || '';
    if (posterSrc) {
      managePosterEl.src = posterSrc;
      managePosterEl.style.display = '';
    } else {
      managePosterEl.style.display = 'none';
    }
  }
  const mixCount  = Object.values(claims).filter(c => c.mixLink).length;
  const lineupBtn = document.getElementById('lineupRadioBtn');
  if (lineupBtn) lineupBtn.style.display = mixCount >= 1 ? '' : 'none';
  const allSlots = [];
  (eventData.days||[]).forEach(day => day.slots.forEach(s => allSlots.push({slot:s,dayName:day.name||''})));
  let lastDay = null;
  allSlots.forEach(item => {
    const s = item.slot, claim = claims[s.id], locked = lockedSlots[s.id];
    const isLounge  = s.label?.toLowerCase().includes('lounge');
    const isSpecial = s.label && !isLounge;
    if (item.dayName && item.dayName !== lastDay) {
      lastDay = item.dayName;
      const div = document.createElement('div');
      div.className = 'day-divider';
      div.innerHTML = '<div class="day-divider-name">'+item.dayName+'</div><div class="day-divider-line"></div>';
      listEl.appendChild(div);
    }
    const wrapper = document.createElement('div'); wrapper.style.cssText = 'margin-bottom:8px;';
    const card = document.createElement('div');
    card.className = 'slot'+(claim?' taken':'')+(isSpecial?' special':'')+(isLounge?' lounge':'')+(locked?' manage-locked-glow':'');
    card.style.cssText = 'margin-bottom:0;'+(claim?'cursor:pointer;':'');
    card.dataset.slotId = s.id;
    if (claim && !locked && !setTimesLocked) card.draggable = true;
    const timeCol = document.createElement('div');
    timeCol.className = 'time-block';
    timeCol.innerHTML = '<div class="time-num">'+s.time+'</div><div class="time-ampm">'+s.ampm+'</div><div class="time-dur">'+s.dur+'</div>';
    const infoCol = document.createElement('div'); infoCol.className = 'slot-info';
    const actCol = document.createElement('div'); actCol.style.cssText = 'display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0;';
    if (!claim) {
      infoCol.innerHTML = '<div class="empty-tag">Open slot</div>'+(s.label?'<div class="slot-badge '+(isLounge?'cyan':'')+'">' +s.label+'</div>':'');
      const assignBtn = document.createElement('button');
      assignBtn.className = 'btn-ghost'; assignBtn.style.cssText = 'font-size:11px;padding:5px 14px;border-color:var(--neon2);color:var(--neon2);white-space:nowrap;';
      assignBtn.textContent = '+ ASSIGN';
      assignBtn.onclick = e => { e.stopPropagation(); const hint = s.time+' '+s.ampm+' · '+s.dur+(s.label?' · '+s.label:''); openModal(s.id, hint, 1); };
      actCol.appendChild(assignBtn);
    } else {
      const mgGenreStr = claim.genre || '';
      const mgPillSource = claim.cardPills || mgGenreStr;
      const mgHasPills = mgPillSource.length > 0;
      const mgPillsHtml = mgHasPills
      ? `<div class="dj-pills" style="margin-top:4px;">${mgPillSource.split(' · ').map(p => p.trim()).filter(Boolean).slice(0, 5).map(p => `<span class="dj-pill">${p}</span>`).join('')}</div>`
      : '';
      const mgDescHtml = !mgHasPills && mgGenreStr
      ? '<div class="dj-genre">'+mgGenreStr+'</div>'
      : '';
      const mgSoundHtml = claim.sound ? `<span style="color:var(--neon2);font-size:12px;font-style:italic;margin-left:6px;opacity:.85;">• ${claim.sound}</span>` : '';
      infoCol.innerHTML = `<div class="dj-name-row"><span class="dj-name">🎧 ${claim.name}</span>${mgSoundHtml}</div>${mgPillsHtml}${mgDescHtml}`;
      if (claim.notes) infoCol.innerHTML += '<div class="dj-note">📝 '+claim.notes+'</div>';
      if (claim.backups?.length) infoCol.innerHTML += '<div class="rank-badge">+'+claim.backups.length+' backup'+(claim.backups.length>1?'s':'')+'</div>';
      if (s.label) infoCol.innerHTML += '<div class="slot-badge '+(isLounge?'cyan':'')+'">' +s.label+'</div>';
      const clearBtn = document.createElement('button'); clearBtn.className = 'btn-clear'; clearBtn.textContent = '✕';
      clearBtn.onclick = e=>{e.stopPropagation(); if(setTimesLocked){showLockedPopup();return;} clearSlot(s.id);renderManage();};
      const chevron = document.createElement('div');
      chevron.style.cssText = 'color:var(--muted);font-size:20px;line-height:1;transition:transform .2s;text-align:center;padding:2px 4px;'; chevron.textContent = '›';
      if (claim.mixLink) {
        const playBtn = document.createElement('button');
        playBtn.style.cssText = 'background:none;border:none;color:var(--neon2);font-size:16px;cursor:pointer;padding:2px 4px;line-height:1;';
        playBtn.textContent = '▶'; playBtn.title = 'Play mix';
        playBtn.onclick = e => { e.stopPropagation(); openMiniPlayer(claim.name, claim.mixLink, '🎧'); };
        actCol.appendChild(playBtn);
      }
      actCol.appendChild(clearBtn); actCol.appendChild(chevron);
      const detail = document.createElement('div');
      detail.style.cssText = 'display:none;background:var(--card2);border:1px solid var(--border);border-top:none;border-radius:0 0 10px 10px;padding:14px 16px;';
      if (claim.genre) { const g = document.createElement('div'); g.style.cssText = 'font-size:12px;color:var(--muted);line-height:1.6;word-break:break-word;margin-bottom:10px;'; g.textContent = claim.genre; detail.appendChild(g); }
      if (claim.notes) { const n = document.createElement('div'); n.style.cssText = 'background:rgba(90,154,122,.08);border:1px solid rgba(90,154,122,.2);border-radius:6px;padding:8px 12px;font-size:13px;color:#7abf9a;line-height:1.5;margin-bottom:10px;word-break:break-word;'; n.innerHTML = '<span style="font-size:10px;letter-spacing:1.5px;color:var(--muted);font-family:Bebas Neue,sans-serif;display:block;margin-bottom:4px;">NOTES</span>'+claim.notes; detail.appendChild(n); }
      if (claim.backups?.length) {
        const bkWrap = document.createElement('div'); bkWrap.style.cssText = 'margin-bottom:10px;';
        bkWrap.innerHTML = '<div style="font-size:10px;letter-spacing:1.5px;color:var(--neon2);font-family:Bebas Neue,sans-serif;margin-bottom:6px;">BACKUP PREFERENCES</div>';
        claim.backups.forEach((bk,i) => { let lbl=bk; (eventData.days||[]).forEach(d=>d.slots.forEach(sl=>{if(sl.id===bk)lbl=(d.name?d.name.split(' ')[0].trim()+' · ':'')+sl.time+' '+sl.ampm+(sl.label?' · '+sl.label:'');})); bkWrap.innerHTML+='<span class="manage-backup-pill">#'+(i+1)+' '+lbl+'</span> '; });
        detail.appendChild(bkWrap);
      }
      const detAct = document.createElement('div'); detAct.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding-top:4px;border-top:1px solid var(--border);margin-top:4px;';
      const lockBtn = document.createElement('button'); lockBtn.className = 'btn-lock'+(locked?' locked':''); lockBtn.style.cssText = 'font-size:11px;flex:1;'; lockBtn.textContent = locked ? '📌 PINNED' : '📌 PIN ARTIST';
      lockBtn.onclick = e=>{e.stopPropagation();toggleLock(s.id);renderManage();};
      detAct.appendChild(lockBtn);
      const notesWrap = document.createElement('div'); notesWrap.style.cssText = 'margin-top:12px;padding-top:10px;border-top:1px solid var(--border);';
      notesWrap.innerHTML = '<div class="host-notes-label">🔒 HOST NOTES (private)</div>';
      const notesTA = document.createElement('textarea'); notesTA.className = 'host-notes-input'; notesTA.rows = 2;
      notesTA.placeholder = 'Private notes — only you can see this...'; notesTA.value = hostNotes[s.id] || '';
      notesTA.oninput = () => { hostNotes[s.id] = notesTA.value; };
      notesWrap.appendChild(notesTA); detail.appendChild(detAct); detail.appendChild(notesWrap);
      let expanded = false;
      card.onclick = e => {
        if (e.target.closest('.btn-clear')) return;
        expanded = !expanded; detail.style.display = expanded ? '' : 'none';
        chevron.style.transform = expanded ? 'rotate(90deg)' : ''; card.style.borderRadius = expanded ? '10px 10px 0 0' : '';
      };
      wrapper.appendChild(card); wrapper.appendChild(detail);
    }
    card.appendChild(timeCol); card.appendChild(infoCol); card.appendChild(actCol);
    if (!claim) wrapper.appendChild(card);
    if (claim && !locked && !setTimesLocked) {
      card.addEventListener('dragstart',e=>{e.dataTransfer.setData('slotId',s.id);setTimeout(()=>card.style.opacity='.35',0);});
      card.addEventListener('dragend',()=>{card.style.opacity='1';});
    }
    card.addEventListener('dragover',e=>{ if (setTimesLocked) return; e.preventDefault();card.style.boxShadow='0 0 0 2px var(--neon2)'; });
    card.addEventListener('dragleave',()=>{card.style.boxShadow='';});
    card.addEventListener('drop',e=>{ e.preventDefault();card.style.boxShadow=''; if (setTimesLocked) { showLockedPopup(); return; } const f=e.dataTransfer.getData('slotId');if(f&&f!==s.id)shiftArtist(f,s.id); });
    listEl.appendChild(wrapper);
  });
  const summary = document.createElement('div');
  summary.style.cssText = 'text-align:center;padding:24px;font-size:12px;color:var(--muted);';
  summary.innerHTML = '<strong style="color:var(--neon2)">'+takenSlots+'</strong> claims · <strong style="color:var(--muted)">'+(totalSlots-takenSlots)+'</strong> open slots';
  listEl.appendChild(summary);
}

function shiftArtist(fromSlotId, toSlotId) {
  if (!fromSlotId||!toSlotId||fromSlotId===toSlotId) return;
  if (setTimesLocked) { showLockedPopup(); return; }
  if (lockedSlots[fromSlotId]) {showToast('That artist is pinned. Unpin them first.','error');return;}
  const orderedIds=[]; (eventData.days||[]).forEach(d=>d.slots.forEach(s=>orderedIds.push(s.id)));
  const fromIdx=orderedIds.indexOf(fromSlotId), toIdx=orderedIds.indexOf(toSlotId);
  if (fromIdx===-1||toIdx===-1) return;
  const fromClaim=claims[fromSlotId], toClaim=claims[toSlotId];
  if (!toClaim) { claims[toSlotId]=fromClaim;delete claims[fromSlotId]; showToast(fromClaim.name+' moved.','success'); }
  else {
    const dir=toIdx>fromIdx?1:-1;
    const range=[]; for(let i=fromIdx;i!==toIdx;i+=dir) range.push(orderedIds[i]); range.push(orderedIds[toIdx]);
    const blocked=range.slice(1).find(id=>lockedSlots[id]&&claims[id]);
    if(blocked){showToast((claims[blocked]?.name||blocked)+' is pinned — unpin to shift past.','error');return;}
    const name=fromClaim.name;
    for(let i=0;i<range.length-1;i++){ const a=range[i],b=range[i+1]; if(claims[b]) claims[a]=claims[b]; else delete claims[a]; }
    claims[orderedIds[toIdx]]=fromClaim; showToast(name+' moved — others shifted.','success');
  }
  renderManage();renderAll();
}

function restoreGenreVibeState(genreStr) {
  if (!genreStr) return;
  const parts = genreStr.split(' · ').map(p => p.trim()).filter(Boolean);
  const ALL_VIBES = ['Fun','Funky','Groove','Wobbly','Thinky','Bouncy','Uplifting','Clubby','Bangers','Staunch','Crankin','Chunks','Sinister','Techy','Melodic','Hypnotic','Deep','Dark','Dank','Organic','Lush','Shanti','Warm Up','Wonky','Sleazy','Cocktail','Classy','Minimal','Experimental','USA','UK','VOX'];
  const genreSelect = document.getElementById('inputGenreMain');
  const options = Array.from(genreSelect.options).map(o => o.value);
  let mainGenre = '';
  for (const p of parts) { if (options.includes(p)) { mainGenre = p; break; } }
  if (!mainGenre && parts.some(p => !ALL_VIBES.includes(p))) mainGenre = 'Multi Genre';
  if (mainGenre) {
    genreSelect.value = mainGenre; updateSubgenres();
    setTimeout(() => {
      const subChips = document.querySelectorAll('#subgenreChips .vibe-btn, #multiSubgenreAccordion .vibe-btn');
      subChips.forEach(chip => { if (parts.includes(chip.textContent.trim())) chip.classList.add('selected'); });
    }, 50);
  }
  document.querySelectorAll('#intensityPicker .vibe-btn').forEach(btn => { if (parts.includes(btn.textContent.trim())) btn.classList.add('selected'); });
}

// ── Delete event ───────────────────────────────────

async function deleteEvent(eventId) {
  try {
    const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${currentSession.access_token}`, 'Content-Type': 'application/json' };
    await fetch(`${SUPABASE_URL}/rest/v1/events?id=eq.${eventId}`, { method: 'DELETE', headers });
    showToast('Event deleted', 'success'); enterDashboard();
  } catch(e) { showToast(`Failed: ${e.message}`, 'error'); }
}

function deleteCurrentEvent() { if (currentEventId) document.getElementById('deleteEventConfirmOverlay').classList.add('open'); }
async function confirmDeleteEvent() { document.getElementById('deleteEventConfirmOverlay').classList.remove('open'); if (currentEventId) await deleteEvent(currentEventId); }

// ── Applications ───────────────────────────────────

async function loadAllApplications() {
  if (!currentEventId || DEMO) return;
  const listEl = document.getElementById('dashTabApplicationsContent');
  if (!listEl) return;
  try {
    const ids = allEvents.map(e => e.id).join(',');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/applications?event_id=in.(${ids})&order=created_at.desc`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${currentSession.access_token}` } }
    );
    const apps = res.ok ? await res.json() : [];
    if (!apps.length) { listEl.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:12px 0;">No applications yet.</div>'; return; }

    // Fetch profiles for all unique artist_ids in one request
    const artistIds = [...new Set(apps.map(a => a.artist_id).filter(Boolean))];
    let profileMap = {};
    if (artistIds.length) {
      const profRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?user_id=in.(${artistIds.join(',')})&type=eq.artist&select=*`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${currentSession.access_token}` } }
      );
      const profiles = profRes.ok ? await profRes.json() : [];
      profiles.forEach(p => { profileMap[p.user_id] = p; });
    }

    const evMap = {};
    allEvents.forEach(e => evMap[e.id] = e);

    // Group by event
    const byEvent = {};
    apps.forEach(app => {
      if (!byEvent[app.event_id]) byEvent[app.event_id] = [];
      byEvent[app.event_id].push(app);
    });

    listEl.innerHTML = '';
    Object.entries(byEvent).forEach(([eventId, eventApps]) => {
      const ev = evMap[eventId];
      const evName = ev ? ev.name : 'Unknown Event';
      const section = document.createElement('div');
      section.style.marginBottom = '24px';
      section.innerHTML = `<div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:2px;color:var(--neon);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border);">${evName} · ${eventApps.length} APPLICATION${eventApps.length !== 1 ? 'S' : ''}</div>`;

      eventApps.forEach(app => {
        const profile = profileMap[app.artist_id];
        const name = profile ? (profile.dj_name || profile.name || app.artist_name || 'Unknown Artist') : (app.artist_name || 'Unknown Artist');
        const location = profile ? [profile.location, profile.state].filter(Boolean).join(', ') : '';
        const genres = profile?.genre_string ? profile.genre_string.split(' · ').slice(0, 3).join(' · ') : '';
        const mixLink = profile?.mix_link || profile?.soundcloud || profile?.mixcloud || '';
        const avatarHtml = profile?.avatar
          ? `<img src="${profile.avatar}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid var(--neon2);flex-shrink:0;" onerror="this.outerHTML='<div style=\\'width:44px;height:44px;border-radius:50%;background:var(--card2);border:2px solid var(--neon2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;\\'>🎧</div>'">`
          : `<div style="width:44px;height:44px;border-radius:50%;background:var(--card2);border:2px solid var(--neon2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">🎧</div>`;
        const statusColor = app.status === 'accepted' ? 'var(--neon2)' : app.status === 'declined' ? 'var(--neon)' : 'var(--gold)';

        const card = document.createElement('div');
        card.style.cssText = 'background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px;';
        card.innerHTML = `
          <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:${app.note ? '10px' : '0'};">
            ${avatarHtml}
            <div style="flex:1;min-width:0;">
              <div style="font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:1px;">${name}</div>
              ${location ? `<div style="font-size:12px;color:var(--muted);">📍 ${location}</div>` : ''}
              ${genres ? `<div style="font-size:11px;color:var(--neon2);margin-top:2px;">${genres}</div>` : ''}
            </div>
            <span style="font-size:10px;color:${statusColor};font-family:'Bebas Neue',sans-serif;letter-spacing:1px;flex-shrink:0;">${app.status.toUpperCase()}</span>
          </div>
          ${app.note ? `<div style="font-size:13px;color:var(--muted);background:var(--card2);border-radius:8px;padding:10px;margin-bottom:10px;line-height:1.6;">"${app.note}"</div>` : ''}
          <div class="_app-actions" style="display:flex;gap:8px;flex-wrap:wrap;"></div>`;

        const actionsEl = card.querySelector('._app-actions');

        if (mixLink) {
          const playBtn = document.createElement('button');
          playBtn.style.cssText = 'background:rgba(0,229,255,.1);border:1px solid var(--neon2);border-radius:20px;color:var(--neon2);font-size:12px;padding:6px 14px;cursor:pointer;';
          playBtn.textContent = '▶ Play Mix';
          playBtn.onclick = () => openMiniPlayer(name, mixLink, '🎧');
          actionsEl.appendChild(playBtn);
        }

        if (profile) {
          const viewBtn = document.createElement('button');
          viewBtn.style.cssText = 'background:var(--card2);border:1px solid var(--border);border-radius:20px;color:var(--text);font-size:12px;padding:6px 14px;cursor:pointer;';
          viewBtn.textContent = 'View Profile';
          viewBtn.onclick = () => openPublicProfile(profile);
          actionsEl.appendChild(viewBtn);
        }

        if (app.status === 'pending') {
          const acceptBtn = document.createElement('button');
          acceptBtn.style.cssText = 'background:rgba(0,229,255,.15);border:1px solid var(--neon2);border-radius:20px;color:var(--neon2);font-size:12px;padding:6px 14px;cursor:pointer;font-weight:600;';
          acceptBtn.textContent = '✓ Accept';
          acceptBtn.onclick = () => updateApplicationStatus(app.id, 'accepted', actionsEl);
          const declineBtn = document.createElement('button');
          declineBtn.style.cssText = 'background:rgba(255,45,120,.1);border:1px solid var(--neon);border-radius:20px;color:var(--neon);font-size:12px;padding:6px 14px;cursor:pointer;';
          declineBtn.textContent = '✕ Decline';
          declineBtn.onclick = () => updateApplicationStatus(app.id, 'declined', actionsEl);
          actionsEl.appendChild(acceptBtn);
          actionsEl.appendChild(declineBtn);
        }

        section.appendChild(card);
      });
      listEl.appendChild(section);
    });
  } catch(e) { console.warn('loadAllApplications error:', e); }
}

async function updateApplicationStatus(appId, status, btnContainer) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/applications?id=eq.${appId}`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${currentSession.access_token}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status })
    });
    showToast(`Application ${status}`, 'success');
    loadAllApplications();
  } catch(e) { showToast('Update failed', 'error'); }
}

async function loadMyApplications() {
  if (DEMO || !currentUser?.id || currentUser.id === 'guest') return;
  const listEl = document.getElementById('myApplicationsList');
  if (!listEl) return;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/applications?artist_id=eq.${currentUser.id}&order=created_at.desc`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${currentSession.access_token}` } }
    );
    const apps = res.ok ? await res.json() : [];
    if (!apps.length) { listEl.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:12px 0;">No applications submitted yet.</div>'; return; }
    const eventIds = [...new Set(apps.map(a => a.event_id))];
    const evRes = await fetch(`${SUPABASE_URL}/rest/v1/events?id=in.(${eventIds.join(',')})&select=id,name,config`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${currentSession.access_token}` } });
    const events = evRes.ok ? await evRes.json() : [];
    const evMap = {}; events.forEach(e => evMap[e.id] = e);
    listEl.innerHTML = '';
    apps.forEach(app => {
      const ev = evMap[app.event_id];
      const evName = ev?.name || 'Unknown Event';
      const venue = ev?.config?.venue || '';
      const date = ev?.config?.date || '';
      const statusColor = app.status === 'accepted' ? 'var(--neon2)' : app.status === 'declined' ? 'var(--neon)' : 'var(--gold)';
      const statusLabel = app.status === 'accepted' ? '✓ ACCEPTED' : app.status === 'declined' ? '✕ DECLINED' : '⏳ PENDING';
      const card = document.createElement('div');
      card.style.cssText = `background:var(--card);border:1px solid ${statusColor === 'var(--gold)' ? 'rgba(255,184,48,.3)' : statusColor === 'var(--neon2)' ? 'rgba(0,229,255,.3)' : 'rgba(255,45,120,.3)'};border-radius:12px;padding:14px;margin-bottom:10px;`;
      card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;"><div style="flex:1;min-width:0;"><div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1px;">${evName}</div>${venue?`<div style="font-size:12px;color:var(--muted);">📍 ${venue}</div>`:''} ${date?`<div style="font-size:12px;color:var(--muted);">📅 ${date}</div>`:''}${app.note?`<div style="font-size:12px;color:var(--muted);margin-top:6px;font-style:italic;">"${app.note}"</div>`:''}</div><span style="font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:1px;color:${statusColor};flex-shrink:0;padding-top:2px;">${statusLabel}</span></div>`;
      listEl.appendChild(card);
    });
  } catch(e) { console.warn('loadMyApplications error:', e); }
}

// ── Notify matching artists ────────────────────────

async function notifyMatchingArtists(event) {
  if (DEMO) return;
  try {
    const cfg = event.config || {};
    const eventGenres = (cfg.genres || '').toLowerCase();
    const eventLocation = cfg.venue || cfg.location || '';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?type=eq.artist&select=user_id,dj_name,genre_string,location`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${currentSession.access_token}` } });
    const artists = res.ok ? await res.json() : [];
    let matched = 0;
    artists.forEach(artist => {
      if (!artist.genre_string) return;
      const artistGenres = artist.genre_string.toLowerCase();
      const eventGenreList = eventGenres.split(/[\s·,]+/).filter(g => g.length > 2);
      const hasMatch = eventGenreList.some(g => artistGenres.includes(g));
      if (!hasMatch) return;
      const notifKey = `yp_pending_notifs_${artist.user_id}`;
      try {
        const existing = JSON.parse(localStorage.getItem(notifKey) || '[]');
        existing.unshift({ id: Date.now() + Math.random(), icon: '🎉', text: `Applications open: ${event.name}${eventLocation ? ' · ' + eventLocation : ''}`, time: new Date().toISOString(), read: false });
        localStorage.setItem(notifKey, JSON.stringify(existing.slice(0, 20)));
        matched++;
      } catch(e) {}
    });
    if (matched > 0) showToast(`${matched} matching artist${matched > 1 ? 's' : ''} notified`, 'success');
  } catch(e) { console.warn('notifyMatchingArtists error:', e); }
}

// ── Poster upload ──────────────────────────────────

async function handlePosterUpload(input) {
  const file = input.files[0]; if (!file) return;
  const localReader = new FileReader();
  localReader.onload = (e) => {
    document.getElementById('inPoster').value = e.target.result;
    document.getElementById('posterPreview').src = e.target.result;
    document.getElementById('posterPreviewWrap').style.display = 'block';
    document.getElementById('posterPlaceholder').style.display = 'none';
  };
  localReader.readAsDataURL(file);
  try {
    const compressed = await compressImage(file, 1200, 0.82);
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `posters/${currentUser?.id || 'anon'}-${Date.now()}.${ext}`;
    const token = currentSession?.access_token || SUPABASE_KEY;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/event-assets/${path}`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}`, 'Content-Type': file.type || 'image/jpeg', 'x-upsert': 'true' },
      body: compressed
    });
    if (res.ok) {
      const url = `${SUPABASE_URL}/storage/v1/object/public/event-assets/${path}`;
      document.getElementById('inPoster').value = url;
      document.getElementById('posterPreview').src = url;
      showToast('Poster uploaded ✓', 'success');
    } else {
      const err = await res.json().catch(() => ({}));
      console.warn('Poster cloud upload failed:', err.error || res.status);
      showToast('Poster saved locally (cloud upload failed — check storage bucket)', 'error');
    }
  } catch(e) { console.warn('Poster upload error:', e); }
  input.value = '';
}

function compressImage(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Compression failed')), 'image/jpeg', quality);
      };
      img.onerror = reject; img.src = e.target.result;
    };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}

function openPosterLightbox(src) { const lb = document.getElementById('posterLightbox'); document.getElementById('posterLightboxImg').src = src; lb.style.display = 'flex'; }
function closePosterLightbox() { document.getElementById('posterLightbox').style.display = 'none'; }
function clearPoster() { document.getElementById('inPoster').value = ''; document.getElementById('posterPreview').src = ''; document.getElementById('posterPreviewWrap').style.display = 'none'; document.getElementById('posterPlaceholder').style.display = 'flex'; document.getElementById('posterFileInput').value = ''; }

// ── Nominatim location autocomplete ───────────────

let _nominatimTimer = null;
async function nominatimSearch(inputEl, dropdownId, hiddenId) {
  const q = inputEl.value.trim();
  const dropdown = document.getElementById(dropdownId);
  if (q.length < 3) { dropdown.style.display = 'none'; return; }
  clearTimeout(_nominatimTimer);
  _nominatimTimer = setTimeout(async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=6&featuretype=city`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const results = await res.json();
      dropdown.innerHTML = '';
      if (!results.length) { dropdown.style.display = 'none'; return; }
      results.forEach(r => {
        const addr = r.address || {};
        const city = addr.city || addr.town || addr.village || addr.suburb || addr.county || r.display_name.split(',')[0];
        const country = addr.country || '', state = addr.state || '';
        const label = [city, state, country].filter(Boolean).join(', ');
        const item = document.createElement('div');
        item.className = 'nominatim-item'; item.textContent = label;
        item.onclick = () => {
          inputEl.value = city;
          if (hiddenId) document.getElementById(hiddenId).value = label;
          dropdown.style.display = 'none';
          const stateMap = { 'New South Wales':'NSW','Victoria':'VIC','Queensland':'QLD','Western Australia':'WA','South Australia':'SA','Tasmania':'TAS','Australian Capital Territory':'ACT','Northern Territory':'NT' };
          const stateDropId = inputEl.id === 'profileLocation' ? 'profileState' : (inputEl.id === 'hostProfileLocation' ? 'hostProfileState' : null);
          if (stateDropId && stateMap[state]) document.getElementById(stateDropId).value = stateMap[state];
        };
        dropdown.appendChild(item);
      });
      dropdown.style.display = 'block';
      document.addEventListener('click', function closeNom(e) {
        if (!dropdown.contains(e.target) && e.target !== inputEl) { dropdown.style.display = 'none'; document.removeEventListener('click', closeNom); }
      });
    } catch(e) { console.warn('Nominatim error:', e); }
  }, 400);
}

// ── Approval codes & Applications ──────────────────

function generateCodeStr() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

function openApprovalCodes() {
  document.getElementById('approvalCodesOverlay').classList.add('open');
  switchAppsTab('applications');
  loadApplications();
}

function closeApprovalCodes() {
  document.getElementById('approvalCodesOverlay').classList.remove('open');
}

function switchAppsTab(tab) {
  const isApps = tab === 'applications';
  document.getElementById('appsTabContent').style.display  = isApps ? '' : 'none';
  document.getElementById('codesTabContent').style.display = isApps ? 'none' : '';
  document.getElementById('tabAppsBtn').style.borderBottomColor = isApps ? 'var(--neon2)' : 'transparent';
  document.getElementById('tabAppsBtn').style.color = isApps ? 'var(--neon2)' : 'var(--muted)';
  document.getElementById('tabCodesBtn').style.borderBottomColor = isApps ? 'transparent' : 'var(--neon2)';
  document.getElementById('tabCodesBtn').style.color = isApps ? 'var(--muted)' : 'var(--neon2)';
  if (!isApps) loadCodesTab();
}

async function loadApplications() {
  const listEl = document.getElementById('applicationsList');
  listEl.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px;">Loading…</div>';
  // Safety: show fallback if still loading after 8 seconds
  const loadTimeout = setTimeout(() => {
    if (listEl.innerHTML.includes('Loading')) {
      listEl.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:24px;">No applications yet.</div>';
    }
  }, 8000);
  try {
    const rows = await sbRest(
      `applications?event_id=eq.${currentEventId}&status=eq.pending&select=*&order=created_at.asc`,
      { method: 'GET' },
      currentSession?.access_token
    );
    clearTimeout(loadTimeout);
    if (!rows || !rows.length) {
      listEl.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:24px;">No pending applications.</div>';
      ['manageAppsBadge','overlayAppsBadge'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
      return;
    }
    ['manageAppsBadge','overlayAppsBadge'].forEach(id => { const el = document.getElementById(id); if (el) { el.textContent = rows.length; el.style.display = ''; } });
    // Render cards immediately with basic info, then enrich with profile data
    listEl.innerHTML = '';
    rows.forEach(app => {
      let name = 'Unknown Artist';
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:12px;';
      card.innerHTML = `
        <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;">
          <div data-avatar style="width:46px;height:46px;border-radius:6px;background:var(--card);border:2px solid var(--neon2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">🎧</div>
          <div style="flex:1;min-width:0;">
            <div data-name style="font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:1px;">Artist</div>
            <div data-detail></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="app-accept-btn" style="flex:1;padding:9px;background:var(--neon2);border:none;border-radius:8px;color:#0a0a0f;font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1px;cursor:pointer;">ACCEPT ✓</button>
          <button class="app-decline-btn" style="flex:1;padding:9px;background:transparent;border:1px solid var(--neon);border-radius:8px;color:var(--neon);font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1px;cursor:pointer;">DECLINE ✕</button>
        </div>`;
      card.querySelector('.app-accept-btn').onclick  = () => openAcceptModal(app.id, app.artist_id, name);
      card.querySelector('.app-decline-btn').onclick = function() { rejectApplication(app.id, this); };
      listEl.appendChild(card);
      // Enrich card with profile data asynchronously (use null/anon key so RLS doesn't block)
      sbRest(`profiles?user_id=eq.${app.artist_id}&type=eq.artist&limit=1`, { method: 'GET' }, currentSession?.access_token || null)
        .then(pr => {
          if (!pr || !pr[0]) return;
          const prof = pr[0];
          const enrichedName = prof.dj_name || prof.name || 'Unknown Artist';
          const nameEl = card.querySelector('[data-name]');
          if (nameEl) nameEl.textContent = enrichedName;
          card.querySelector('.app-accept-btn').onclick = () => openAcceptModal(app.id, app.artist_id, enrichedName);
          const genres = (prof.genre_string || '').split(' · ').filter(Boolean).slice(0,4);
          const detailEl = card.querySelector('[data-detail]');
          if (detailEl) detailEl.innerHTML = [
            prof.location ? `<div style="font-size:11px;color:var(--muted);">📍 ${prof.location}</div>` : '',
            genres.length ? `<div class="dj-pills" style="margin-top:4px;">${genres.map(g=>`<span class="dj-pill">${g}</span>`).join('')}</div>` : '',
            prof.sound ? `<div style="font-size:11px;color:var(--neon2);font-style:italic;margin-top:4px;">${prof.sound}</div>` : '',
            prof.mix_link ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">▶ Mix link: <a href="${prof.mix_link}" target="_blank" style="color:var(--neon2);">listen</a></div>` : ''
          ].join('');
          if (prof.avatar) {
            const avatarEl = card.querySelector('[data-avatar]');
            if (avatarEl) avatarEl.innerHTML = `<img src="${prof.avatar}" style="width:46px;height:46px;border-radius:6px;object-fit:cover;border:2px solid var(--neon2);">`;
          }
        }).catch(() => {});
    });
  } catch(e) {
    clearTimeout(loadTimeout);
    listEl.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px;">No applications yet.</div>`;
  }
}

async function rejectApplication(appId, btn) {
  btn.disabled = true; btn.textContent = 'DECLINING...';
  try {
    await sbRest(`applications?id=eq.${appId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected' })
    }, currentSession?.access_token);
    btn.closest('div[style*="border-radius:10px"]').style.opacity = '.4';
    btn.textContent = 'DECLINED';
    showToast('Application declined', 'success');
    setTimeout(() => loadApplications(), 800);
  } catch(e) {
    btn.disabled = false; btn.textContent = 'DECLINE ✕';
    showToast('Could not decline application', 'error');
  }
}

// ── Accept artist modal ─────────────────────────────

let _acceptAppId    = null;
let _acceptArtistId = null;
let _acceptArtistName = '';

function openAcceptModal(appId, artistId, artistName) {
  _acceptAppId    = appId;
  _acceptArtistId = artistId;
  _acceptArtistName = artistName;
  document.getElementById('acceptArtistName').textContent = artistName;
  document.getElementById('accessAll').checked = true;
  document.getElementById('slotPickerWrap').style.display = 'none';
  document.getElementById('generatedCodeWrap').style.display = 'none';
  document.getElementById('acceptActionsWrap').style.display = '';
  document.getElementById('acceptConfirmBtn').textContent = 'GENERATE CODE →';
  document.getElementById('acceptConfirmBtn').disabled = false;
  const dismissBtn = document.querySelector('#acceptArtistOverlay .btn-ghost');
  if (dismissBtn) { dismissBtn.textContent = 'Cancel'; dismissBtn.style.background = ''; dismissBtn.style.color = ''; }
  // Build slot picker
  const list = document.getElementById('slotPickerList');
  list.innerHTML = '';
  (eventData.days || []).forEach(day => {
    const dayLabel = document.createElement('div');
    dayLabel.style.cssText = 'font-family:"Bebas Neue",sans-serif;font-size:12px;letter-spacing:1px;color:var(--muted);padding:4px 0;margin-top:4px;';
    dayLabel.textContent = day.name || '';
    list.appendChild(dayLabel);
    (day.slots || []).forEach(s => {
      if (claims[s.id]) return; // skip taken slots
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;font-size:13px;';
      label.innerHTML = `<input type="checkbox" value="${s.id}" style="accent-color:var(--neon2);">
        <span>${s.time} ${s.ampm} · ${s.dur}${s.label?' · '+s.label:''}</span>`;
      list.appendChild(label);
    });
  });
  document.getElementById('acceptArtistOverlay').classList.add('open');
}

function closeAcceptModal() {
  document.getElementById('acceptArtistOverlay').classList.remove('open');
  _acceptAppId = null;
}

function setSlotAccess(type) {
  document.getElementById('slotPickerWrap').style.display = type === 'specific' ? '' : 'none';
}

async function confirmAcceptArtist() {
  const btn = document.getElementById('acceptConfirmBtn');
  btn.disabled = true; btn.textContent = 'GENERATING...';
  const useSpecific = document.getElementById('accessSpecific').checked;
  let slotIds = null;
  if (useSpecific) {
    slotIds = Array.from(document.querySelectorAll('#slotPickerList input[type=checkbox]:checked')).map(c => c.value);
    if (!slotIds.length) { showToast('Select at least one slot', 'error'); btn.disabled = false; btn.textContent = 'GENERATE CODE →'; return; }
  }
  const code = generateCodeStr();
  try {
    await sbRest('approval_codes', {
      method: 'POST',
      prefer: 'return=minimal',
      body: JSON.stringify({
        event_id:       currentEventId,
        code:           code,
        slot_ids:       slotIds,
        artist_id:      _acceptArtistId,
        application_id: _acceptAppId
      })
    }, currentSession?.access_token);
    await sbRest(`applications?id=eq.${_acceptAppId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'accepted' })
    }, currentSession?.access_token);
    // Show the generated code and reload applications list in background
    document.getElementById('generatedCodeText').textContent = code;
    document.getElementById('generatedCodeWrap').style.display = '';
    document.getElementById('acceptActionsWrap').style.display = 'none';
    const dismissBtn = document.querySelector('#acceptArtistOverlay .btn-ghost');
    if (dismissBtn) { dismissBtn.textContent = 'DONE'; dismissBtn.style.background = 'var(--neon2)'; dismissBtn.style.color = '#0a0a0f'; }
    showToast('Artist accepted! Copy the code and share it with them.', 'success');
    loadApplications(); // refresh list (accepted app disappears from pending)
  } catch(e) {
    showToast('Could not generate code: ' + e.message, 'error');
    btn.disabled = false; btn.textContent = 'GENERATE CODE →';
  }
}

function copyGeneratedCode() {
  const code = document.getElementById('generatedCodeText').textContent;
  navigator.clipboard.writeText(code).then(() => showToast('Code copied!', 'success'));
}

async function loadCodesTab() {
  const el = document.getElementById('codeList');
  el.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:8px;">Loading…</div>';
  try {
    const rows = await sbRest(
      `approval_codes?event_id=eq.${currentEventId}&select=*&order=created_at.desc`,
      { method: 'GET' },
      currentSession?.access_token
    );
    if (!rows || !rows.length) { el.innerHTML = '<div style="font-size:13px;color:var(--muted);text-align:center;padding:12px;">No codes yet.</div>'; return; }
    el.innerHTML = rows.map(r => {
      const slotLabel = r.slot_ids?.length ? `· ${r.slot_ids.length} slot${r.slot_ids.length>1?'s':''}` : '· All slots';
      const used = !!r.used_at;
      return `<div class="code-item${used?' used':''}" style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-family:'Bebas Neue',sans-serif;letter-spacing:2px;">${r.code}</span>
        <span style="font-size:11px;color:var(--muted);">${slotLabel}${used?' · USED':''}</span>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px;">Could not load codes.</div>';
  }
}

async function copyAllCodes() {
  try {
    const rows = await sbRest(
      `approval_codes?event_id=eq.${currentEventId}&used_at=is.null&select=code`,
      { method: 'GET' },
      currentSession?.access_token
    );
    const codes = (rows || []).map(r => r.code).join('\n');
    navigator.clipboard.writeText(codes).then(() => showToast('Codes copied!', 'success'));
  } catch(e) {
    showToast('Could not copy codes', 'error');
  }
}

// ── Locked set times ───────────────────────────────

function showLockedPopup() {
  showToast('⏰ Set times are locked. Unlock first to make changes.', 'error');
}

function toggleLockSetTimes() {
  setTimesLocked = !setTimesLocked;
  const btn = document.getElementById('lockTimesBtn');
  if (btn) { btn.textContent = setTimesLocked ? '🔒 SET TIMES LOCKED' : '🔒 LOCK SET TIMES'; btn.classList.toggle('locked', setTimesLocked); }
  // Persist to Supabase
  if (!DEMO && currentEventId && currentSession?.access_token) {
    sbRest(`events?id=eq.${currentEventId}`, {
      method: 'PATCH',
      body: JSON.stringify({ host_controls: { ...hostControls, setTimesLocked } })
    }, currentSession.access_token).catch(() => {});
  }
}

function toggleApplicationsOpen() {
  hostControls.applicationsOpen = !hostControls.applicationsOpen;
  const open = hostControls.applicationsOpen;
  const btn = document.getElementById('appsToggleBtn');
  if (btn) {
    btn.textContent = open ? 'APPLICATIONS: OPEN ✓' : 'APPLICATIONS: CLOSED';
    btn.style.borderColor = open ? 'var(--neon2)' : 'var(--border)';
    btn.style.color = open ? 'var(--neon2)' : 'var(--muted)';
  }
  showToast(open ? 'Applications are now OPEN ✓' : 'Applications closed', 'success');
  if (!DEMO && currentEventId && currentSession?.access_token) {
    sbRest(`events?id=eq.${currentEventId}`, {
      method: 'PATCH',
      body: JSON.stringify({ host_controls: { ...hostControls } })
    }, currentSession.access_token).catch(() => {});
  }
}

// ── Artist event view ──────────────────────────────

function openArtistEvent(gig) {
  // Use the same loadPublicEvent + showSignup path as Discover so claims load fully
  loadPublicEvent(gig.eventId).then(ok => {
    if (ok) showSignup();
    else showToast('Could not load event.', 'error');
  });
}

// ── Manage screen slot manipulation ───────────────
// (undo/redo, insert slot, slot conflicts, drag — these remain from original)
// These functions rely on DOM state and are kept as-is from the original

let _manageHistory = [];
let _manageHistoryIndex = -1;

function saveManageState() {
  const state = JSON.parse(JSON.stringify({ claims, eventData }));
  _manageHistory = _manageHistory.slice(0, _manageHistoryIndex + 1);
  _manageHistory.push(state);
  _manageHistoryIndex = _manageHistory.length - 1;
  updateUndoRedoBtns();
}

function saveSlotHistory() { saveManageState(); }

function undoManage() {
  if (_manageHistoryIndex <= 0) return;
  _manageHistoryIndex--;
  const state = _manageHistory[_manageHistoryIndex];
  claims = JSON.parse(JSON.stringify(state.claims));
  eventData = JSON.parse(JSON.stringify(state.eventData));
  renderManage(); renderAll(); updateUndoRedoBtns();
}

function redoManage() {
  if (_manageHistoryIndex >= _manageHistory.length - 1) return;
  _manageHistoryIndex++;
  const state = _manageHistory[_manageHistoryIndex];
  claims = JSON.parse(JSON.stringify(state.claims));
  eventData = JSON.parse(JSON.stringify(state.eventData));
  renderManage(); renderAll(); updateUndoRedoBtns();
}

function undoSlots() { undoManage(); }
function redoSlots() { redoManage(); }

function updateUndoRedoBtns() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) { undoBtn.disabled = _manageHistoryIndex <= 0; undoBtn.style.opacity = _manageHistoryIndex <= 0 ? '.4' : '1'; }
  if (redoBtn) { redoBtn.disabled = _manageHistoryIndex >= _manageHistory.length - 1; redoBtn.style.opacity = _manageHistoryIndex >= _manageHistory.length - 1 ? '.4' : '1'; }
}

// ── Insert slot modal ──────────────────────────────

let _insertTargetWrap = null;

function openInsertSlot(targetWrap) {
  _insertTargetWrap = targetWrap;
  // Pre-fill time from previous slot
  const prevH = document.getElementById('insertH');
  const prevM = document.getElementById('insertM');
  if (prevH) prevH.value = '8';
  if (prevM) prevM.value = '0';
  document.getElementById('insertSlotOverlay').classList.add('open');
}

function closeInsertSlot() { document.getElementById('insertSlotOverlay').classList.remove('open'); _insertTargetWrap = null; }
function selectInsertDur(btn) {
  document.querySelectorAll('#insertDurChips .dur-chip').forEach(c => c.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('insertOtherWrap').style.display = btn.dataset.val === 'other' ? '' : 'none';
}

function getInsertDurMins() {
  const chip = document.querySelector('#insertDurChips .dur-chip.selected');
  if (!chip) return 90;
  const val = chip.dataset.val;
  if (val === '60') return 60;
  if (val === '90') return 90;
  if (val === '120') return 120;
  return parseInt(document.getElementById('insertOM')?.value) || 45;
}

function getInsertDurStr() {
  const mins = getInsertDurMins();
  if (mins === 60) return '1 hr';
  if (mins === 90) return '1.5 hrs';
  if (mins === 120) return '2 hrs';
  return mins + ' mins';
}

function confirmInsertSlot() {
  if (!_insertTargetWrap) return;
  const h  = document.getElementById('insertH')?.value || '8';
  const m  = document.getElementById('insertM')?.value || '0';
  const ap = document.getElementById('insertAP')?.value || 'PM';
  const dur = getInsertDurStr();
  const newSlot = { id: 'ins' + Date.now(), time: h + ':' + String(m).padStart(2,'0'), ampm: ap, dur, label: '' };

  // Insert into eventData
  const card = _insertTargetWrap.closest('.day-card');
  if (!card) { closeInsertSlot(); return; }
  const dayIndex = Array.from(document.querySelectorAll('.day-card')).indexOf(card);
  if (dayIndex === -1 || !eventData.days[dayIndex]) { closeInsertSlot(); return; }

  const wrapIndex = Array.from(card.querySelector('.slots-inner').children).indexOf(_insertTargetWrap);
  eventData.days[dayIndex].slots.splice(wrapIndex, 0, newSlot);

  closeInsertSlot();
  buildTemplate(eventData);
  showToast('Slot inserted', 'success');
}

function slipSlotsFrom(startWrap, slipMins) {
  const card = startWrap.closest('.day-card');
  if (!card) return;
  const dayIndex = Array.from(document.querySelectorAll('.day-card')).indexOf(card);
  if (dayIndex === -1 || !eventData.days[dayIndex]) return;
  const slots = eventData.days[dayIndex].slots;
  const wraps = Array.from(card.querySelector('.slots-inner').children);
  const startIndex = wraps.indexOf(startWrap);
  for (let i = startIndex; i < slots.length; i++) {
    const s = slots[i];
    const totalMins = timeToMins24(s.time, s.ampm) + slipMins;
    const h24 = Math.floor(totalMins / 60) % 24;
    const mm  = totalMins % 60;
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 || 12;
    s.time = `${h12}:${mm.toString().padStart(2,'0')}`;
    s.ampm = ampm;
  }
  buildTemplate(eventData);
}

// ── Remove slot ────────────────────────────────────

let _removeTargetWrap = null;

function askRemoveSlot(wrap) {
  _removeTargetWrap = wrap;
  const nameEl = wrap.querySelector('.sr-label-input');
  document.getElementById('confirmRemoveBtn').textContent = 'REMOVE';
  document.getElementById('confirmRemoveOverlay').classList.add('open');
}

function confirmRemoveSlot() {
  if (_removeTargetWrap) { _removeTargetWrap.remove(); _removeTargetWrap = null; }
  document.getElementById('confirmRemoveOverlay').classList.remove('open');
}

function closeConfirmRemove() { document.getElementById('confirmRemoveOverlay').classList.remove('open'); _removeTargetWrap = null; }

// ── Slot conflict detection ────────────────────────

function rewireSlotRows(builder) {
  builder.querySelectorAll('.day-card').forEach(card => {
    card.querySelectorAll('.slot-row-wrap').forEach(wrap => {
      attachConflictCheck(wrap, card);
      initSlotDrag(wrap, card);
    });
  });
}

function slotTimeToMins(h, m, ap) {
  let h24 = parseInt(h) || 0;
  if (ap === 'AM') { if (h24 === 12) h24 = 0; }
  else { if (h24 !== 12) h24 += 12; }
  return h24 * 60 + (parseInt(m) || 0);
}

function durToMins(dur) {
  if (!dur) return 90;
  if (dur === '1 hr') return 60;
  if (dur === '1.5 hrs') return 90;
  if (dur === '2 hrs') return 120;
  const match = dur.match(/^(\d+)/);
  return match ? parseInt(match[1]) : 90;
}

function minsToTimeStr(totalMins) {
  const h24 = Math.floor(totalMins / 60) % 24;
  const mm  = totalMins % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 || 12;
  return `${h12}:${mm.toString().padStart(2,'0')} ${ampm}`;
}

function readDaySlots(card) {
  const slots = [];
  card.querySelectorAll('.slot-row-wrap').forEach(wrap => {
    const uid = wrap.dataset.uid;
    if (!uid) return;
    const hEl  = document.getElementById(uid + 'H');
    const mEl  = document.getElementById(uid + 'M');
    const apEl = document.getElementById(uid + 'AP');
    if (!hEl || !mEl || !apEl) return;
    const chip = wrap.querySelector('.dur-chip.selected');
    const val  = chip?.dataset?.val || '90';
    let durStr;
    if (val === '60') durStr = '1 hr';
    else if (val === '90') durStr = '1.5 hrs';
    else if (val === '120') durStr = '2 hrs';
    else { const om = document.getElementById(uid + 'OM'); durStr = (om?.value || '45') + ' mins'; }
    slots.push({ wrap, h: hEl.value, m: mEl.value, ap: apEl.value, durMins: durToMins(durStr) });
  });
  return slots;
}

function checkSlotConflicts(card, changedUid) {
  const slots = readDaySlots(card);
  if (slots.length < 2) return;
  for (let i = 0; i < slots.length - 1; i++) {
    const a = slots[i], b = slots[i+1];
    const aStart = slotTimeToMins(a.h, a.m, a.ap);
    const aEnd   = aStart + a.durMins;
    const bStart = slotTimeToMins(b.h, b.m, b.ap);
    if (aEnd > bStart) {
      showSlotConflict('⚠ SLOT OVERLAP', `${minsToTimeStr(aStart)} ends at ${minsToTimeStr(aEnd)} but next slot starts at ${minsToTimeStr(bStart)}.`, true, { card, changedUid, slipMins: aEnd - bStart });
      return;
    }
    if (aEnd < bStart) {
      showSlotConflict('⚠ GAP IN SET TIMES', `${minsToTimeStr(aEnd)} → ${minsToTimeStr(bStart)} (${bStart - aEnd} min gap).`, true, { card, changedUid, slipMins: 0 });
      return;
    }
  }
}

function showSlotConflict(title, msg, slipMode, ctx) {
  document.getElementById('slotConflictTitle').textContent = title;
  document.getElementById('slotConflictMsg').textContent   = msg;
  const autoFix = document.getElementById('slotConflictAutoFix');
  const enableSlip = document.getElementById('slotConflictEnableSlip');
  const cancel = document.getElementById('slotConflictCancel');
  if (slipMode && ctx?.slipMins > 0) {
    autoFix.style.display = ''; autoFix.dataset.ctx = JSON.stringify(ctx);
    cancel.style.display = '';
  } else {
    autoFix.style.display = 'none'; cancel.style.display = 'none';
  }
  if (!document.getElementById('toggleSlipMode').checked && slipMode) {
    enableSlip.style.display = '';
  } else { enableSlip.style.display = 'none'; }
  document.getElementById('slotConflictOverlay').classList.add('open');
}

function enableSlipAndFix() { document.getElementById('toggleSlipMode').checked = true; closeSlotConflict(); }
function closeSlotConflict() { document.getElementById('slotConflictOverlay').classList.remove('open'); }
function slotConflictAutoFix() {
  const btn = document.getElementById('slotConflictAutoFix');
  try { const ctx = JSON.parse(btn.dataset.ctx || '{}'); if (ctx.slipMins && ctx.card) slipSlotsFrom(ctx.card.querySelector('.slot-row-wrap'), ctx.slipMins); } catch {}
  closeSlotConflict();
}

function attachConflictCheck(wrap, card) {
  const uid = wrap.dataset.uid; if (!uid) return;
  ['H','M','AP'].forEach(suffix => {
    const el = document.getElementById(uid + suffix);
    if (el) el.addEventListener('change', () => setTimeout(() => checkSlotConflicts(card, uid), 100));
  });
  wrap.querySelectorAll('.dur-chip').forEach(chip => {
    chip.addEventListener('click', () => setTimeout(() => checkSlotConflicts(card, uid), 100));
  });
}

// ── Slot drag (template builder) ───────────────────

function initSlotDrag(wrap, card) {
  const handle = wrap.querySelector('.btn-remove-slot');
  if (!handle) return;
  handle.addEventListener('mousedown', e => { if (e.button === 0) startSlotDrag(wrap, card, e.clientY); });
  handle.addEventListener('touchstart', e => startSlotDrag(wrap, card, e.touches[0].clientY), { passive: true });
}

let _dragState = null;

function startSlotDrag(wrap, card, startY) {
  _dragState = { wrap, card, startY, originalIndex: Array.from(card.querySelector('.slots-inner').children).indexOf(wrap) };
  document.addEventListener('mousemove', onSlotDragMove);
  document.addEventListener('touchmove', onSlotDragMove, { passive: false });
  document.addEventListener('mouseup', onSlotDragEnd);
  document.addEventListener('touchend', onSlotDragEnd);
  wrap.style.opacity = '.5';
}

function onSlotDragMove(e) {
  if (!_dragState) return;
  if (e.cancelable) e.preventDefault();
  const y = e.touches ? e.touches[0].clientY : e.clientY;
  const container = _dragState.card.querySelector('.slots-inner');
  const wraps = Array.from(container.children);
  let targetIndex = wraps.length;
  wraps.forEach((w, i) => {
    const rect = w.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) { targetIndex = Math.min(targetIndex, i); }
  });
  if (targetIndex !== Array.from(container.children).indexOf(_dragState.wrap)) {
    container.insertBefore(_dragState.wrap, container.children[targetIndex] || null);
  }
}

function _animateSlotsToTarget() {}

function onSlotDragEnd() {
  if (!_dragState) return;
  _dragState.wrap.style.opacity = '1';
  document.removeEventListener('mousemove', onSlotDragMove);
  document.removeEventListener('touchmove', onSlotDragMove);
  document.removeEventListener('mouseup', onSlotDragEnd);
  document.removeEventListener('touchend', onSlotDragEnd);
  setTimeout(() => checkSlotConflicts(_dragState.card, null), 200);
  _dragState = null;
}

// ── Slot swipe (claim view) ────────────────────────

function initSlotSwipe(slotEl, slotId) {
  let startX = 0, startY = 0, moved = false;
  slotEl.addEventListener('touchstart', e => { startX = e.touches[0].clientX; startY = e.touches[0].clientY; moved = false; }, { passive: true });
  slotEl.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) { moved = true; slotEl.style.transform = `translateX(${dx}px)`; }
  }, { passive: true });
  slotEl.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    slotEl.style.transform = '';
    if (moved && Math.abs(dx) > 80 && (isHost || hostControls.artistRemove)) {
      clearSlot(slotId);
    }
  });
}

// ── Slot delete confirm (swipe) ────────────────────

function showSlotDeleteConfirm(name) { showToast(`Removed ${name} from slot`, 'success'); }

// ── Demo overrides ─────────────────────────────────

function demoOverrides() {
  window.doLogin = async function() {
    const email = document.getElementById('loginEmail').value.trim();
    const pass  = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginErr');
    errEl.classList.remove('show');
    if (!email || !pass) { errEl.textContent='Fill in both fields.'; errEl.classList.add('show'); return; }
    currentUser = { ...DEMO_USER };
    currentSession = { access_token: 'demo-token' };
    showRoleSelector();
  };
  window.doSignup = async function() {
    const email = document.getElementById('signupEmail').value.trim();
    const pass  = document.getElementById('signupPassword').value;
    const errEl = document.getElementById('signupErr');
    errEl.classList.remove('show');
    if (!email || !pass) { errEl.textContent='Fill in both fields.'; errEl.classList.add('show'); return; }
    currentUser = { ...DEMO_USER, email };
    currentSession = { access_token: 'demo-token' };
    showToast('Demo account created!', 'success');
    showRoleSelector();
  };
  window.doSignOut = function() {
    currentUser = null; currentSession = null; currentMode = null;
    allEvents = []; currentEventId = null; eventData = null; isHost = false;
    try { localStorage.removeItem('yp_last_mode'); } catch(e) {}
    if (pollTimer) clearInterval(pollTimer);
    show('authScreen');
  };
  window.loadUserEvents = async function() { allEvents = DEMO_EVENTS; renderEventList(); };
  window.loadPublicEvent = async function(eventId) {
    const ev = DEMO_EVENTS.find(e => e.id === eventId && e.status === 'live');
    if (!ev) return false;
    currentEventId = ev.id; eventData = { ...ev.config, id: ev.id }; hostControls = ev.host_controls; isHost = false; return true;
  };
  window.loadClaims = async function() {
    if (!currentEventId) return;
    claims = { ...(demoClaims[currentEventId] || {}) };
    setSync(true); renderAll();
  };
  window.upsertClaim = async function(slotId, name, genre, notes, backups) {
    if (!demoClaims[currentEventId]) demoClaims[currentEventId] = {};
    demoClaims[currentEventId][slotId] = { name, genre, notes, backups }; return true;
  };
  window.deleteClaim = async function(slotId) { if (demoClaims[currentEventId]) delete demoClaims[currentEventId][slotId]; return true; };
  window.launchEvent = async function() {
    const cfg = readForm();
    if (!cfg.name) { document.getElementById('inEventName').focus(); showToast('Please enter an event name.', 'error'); return; }
    const total = cfg.days.reduce((n,d) => n+d.slots.length, 0);
    if (!total) { showToast('Please add at least one time slot.', 'error'); return; }
    const existingClaims = Object.keys(claims || {}).length;
    if (existingClaims > 0 && !window._launchConfirmed) { window._launchConfirmed = false; document.getElementById('editEventOverlay').classList.add('open'); return; }
    window._launchConfirmed = false;
    const btn = document.getElementById('launchBtn'); btn.disabled = true; btn.textContent = 'SAVING...';
    await new Promise(r => setTimeout(r, 500));
    if (!currentEventId) {
      currentEventId = 'demo-event-' + Date.now();
      const newEv = { id: currentEventId, host_id: 'demo-host-001', name: cfg.name, status: 'live', host_controls: cfg.host_controls, config: cfg };
      DEMO_EVENTS.unshift(newEv); allEvents = DEMO_EVENTS;
    } else {
      const ev = DEMO_EVENTS.find(e => e.id === currentEventId);
      if (ev) { ev.name = cfg.name; ev.config = cfg; ev.status = 'live'; ev.host_controls = cfg.host_controls; }
    }
    hostControls = cfg.host_controls; eventData = { ...cfg, id: currentEventId };
    btn.disabled = false; btn.textContent = 'GO LIVE →';
    showToast('Event live! (demo)', 'success');
    document.getElementById('shareLinkBtn').style.display = '';
    showSignup();
  };
  window.showPubLink = function() {
    document.getElementById('pubLinkUrl').textContent = location.origin + location.pathname + '?event=' + currentEventId + '  (demo link works in this session only)';
    document.getElementById('pubLinkOverlay').classList.add('open');
  };
  window.tryRestoreSession = async function() { return false; };
  artistProfile = { djName:'DJ Flames',label:'Independent',location:'Sydney, NSW',tagline:'Peak-time techno from Sydney. Builds slow, hits hard.',bio:'Ten years in the game, three years playing festivals.',age:'31',mixLink:'https://soundcloud.com/djflames/peak-time-mix-2024',experience:'ESTABLISHED',techSetup:'DJ DIGITAL',feeType:'paid',fee:'350',genreString:'Techno · Breaks · Peak Time · Staunch · Crankin · Techy',soundcloud:'https://soundcloud.com/djflames',instagram:'https://instagram.com/djflames',avatar:null };
  hostProfile = { name:'Subsonic Events',location:'Sydney, NSW',years:'6',bio:'Running underground electronic events across NSW since 2018.',instagram:'https://instagram.com/subsonicevents',website:'https://subsonicevents.com.au',email:'book@subsonicevents.com.au' };
}

// ── Artist / host dashboard profile UI ────────────

function updateArtistDashCard() {
  const nameEl = document.getElementById('artistDashName');
  const taglineEl = document.getElementById('artistDashTagline');
  const genresEl = document.getElementById('artistDashGenres');
  const avatarEl = document.getElementById('artistDashAvatar');
  const ctaEl = document.getElementById('artistDashCta');
  const card = document.getElementById('artistDashProfileCard');
  if (artistProfile.djName) {
    nameEl.textContent    = artistProfile.djName;
    taglineEl.textContent = artistProfile.tagline || artistProfile.location || '';
    genresEl.textContent  = artistProfile.genreString ? artistProfile.genreString.split(' · ').slice(0,4).join(' · ') : '';
    ctaEl.textContent = 'EDIT →'; card.classList.add('complete');
    if (artistProfile.avatar) { avatarEl.innerHTML = `<img src="${artistProfile.avatar}" alt="" onerror="this.parentElement.textContent='🎧'">`; }
    else { avatarEl.textContent = '🎧'; }
    let playEl = document.getElementById('artistDashPlayBtn');
    if (artistProfile.mixLink) {
      if (!playEl) {
        playEl = document.createElement('button'); playEl.id = 'artistDashPlayBtn';
        playEl.style.cssText = 'background:var(--neon2);border:none;color:#0a0a0f;border-radius:50%;width:32px;height:32px;cursor:pointer;position:absolute;bottom:10px;right:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        playEl.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>';
        card.style.position = 'relative'; card.appendChild(playEl);
      }
      playEl.onclick = e => { e.stopPropagation(); openMiniPlayer(artistProfile.djName, artistProfile.mixLink, '🎧'); };
    } else if (playEl) { playEl.remove(); }
  } else {
    nameEl.textContent = 'Set up your artist profile'; taglineEl.textContent = 'Promoters will see this — takes 2 mins';
    genresEl.textContent = ''; avatarEl.textContent = '👤'; ctaEl.textContent = 'SET UP →'; card.classList.remove('complete');
  }
}

function renderArtistDashGigs() {
  // Route to unified renderer which handles both confirmed + manual gigs
  renderArtistDashGigsWithManual();
}

function updateDashProfileCard() {
  const nameEl = document.getElementById('dashProfileName');
  const taglineEl = document.getElementById('dashProfileTagline');
  const genresEl = document.getElementById('dashProfileGenres');
  const avatarEl = document.getElementById('dashProfileAvatar');
  const ctaEl = document.getElementById('dashProfileCta');
  const card = document.getElementById('dashProfileCard');
  if (hostProfile.name) {
    nameEl.textContent = hostProfile.name; taglineEl.textContent = hostProfile.location || '';
    genresEl.textContent = hostProfile.genreString ? hostProfile.genreString.split(' · ').slice(0,4).join(' · ') : (hostProfile.bio ? hostProfile.bio.substring(0,60) + (hostProfile.bio.length > 60 ? '…' : '') : '');
    ctaEl.textContent = 'EDIT →'; card.classList.add('complete');
    if (hostProfile.avatar) { avatarEl.innerHTML = `<img src="${hostProfile.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:9px;" onerror="this.parentElement.textContent='🎛️'">`; }
    else { avatarEl.textContent = '🎛️'; }
  } else {
    nameEl.textContent = 'Set up your host profile'; taglineEl.textContent = 'Your location & genres go here';
    genresEl.textContent = ''; avatarEl.textContent = '🎛️'; ctaEl.textContent = 'EDIT →'; card.classList.remove('complete');
  }
}

// ── Profile screen ─────────────────────────────────

function showProfile() { show('profileScreen'); profileGoPage1(); initProfileGenres(); loadProfileData(); renderUpcomingGigs(); }
function showHostProfile() { loadHostProfileData(); initHostProfileGenres(); show('hostProfileScreen'); }
function profileGoPage1() { document.getElementById('profilePage1').style.display = 'block'; document.getElementById('profilePage2').style.display = 'none'; document.getElementById('pdot1').classList.add('active'); document.getElementById('pdot2').classList.remove('active'); }
function profileGoPage2() { document.getElementById('profilePage1').style.display = 'none'; document.getElementById('profilePage2').style.display = 'block'; document.getElementById('pdot1').classList.remove('active'); document.getElementById('pdot2').classList.add('active'); document.getElementById('profileScreen').scrollTop = 0; window.scrollTo(0,0); }
function handleAvatarUpload(e) { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = ev => { const img = document.getElementById('avatarPreview'); img.src = ev.target.result; img.style.display = 'block'; document.getElementById('avatarPlaceholder').style.display = 'none'; artistProfile.avatar = ev.target.result; }; reader.readAsDataURL(file); }
function selectExp(btn) { document.querySelectorAll('.exp-pill').forEach(p => p.classList.remove('selected')); btn.classList.add('selected'); artistProfile.experience = btn.textContent; }
function selectTech(btn) { document.querySelectorAll('.tech-pill').forEach(p => p.classList.remove('selected')); btn.classList.add('selected'); artistProfile.techSetup = btn.textContent; }
function selectFeeType(type) { const tBtn = document.getElementById('feeTicketsBtn'), pBtn = document.getElementById('feePaidBtn'), block = document.getElementById('feeAmountBlock'); tBtn.className = 'fee-toggle-btn'; pBtn.className = 'fee-toggle-btn'; if (type === 'tickets') { tBtn.classList.add('selected-tickets'); block.style.display = 'none'; artistProfile.feeType = 'tickets'; } else { pBtn.classList.add('selected-fee'); block.style.display = 'block'; artistProfile.feeType = 'paid'; } }
function triggerAttach(inputId) { document.getElementById(inputId).click(); }
function handleAttach(input, statusId) { const file = input.files[0]; if (!file) return; const statusEl = document.getElementById(statusId); statusEl.textContent = file.name.length > 24 ? file.name.substring(0,22)+'…' : file.name; statusEl.classList.add('done'); }
function selectABN(hasABN) { document.getElementById('abnYesBtn').className = 'fee-toggle-btn' + (hasABN ? ' selected-tickets' : ''); document.getElementById('abnNoBtn').className = 'fee-toggle-btn' + (!hasABN ? ' selected-fee' : ''); document.getElementById('abnBlock').style.display = hasABN ? 'block' : 'none'; artistProfile.hasABN = hasABN; if (!hasABN) { artistProfile.abn = ''; artistProfile.gstRegistered = false; } }
function selectGST(registered) { document.getElementById('gstYesBtn').className = 'fee-toggle-btn' + (registered ? ' selected-tickets' : ''); document.getElementById('gstNoBtn').className = 'fee-toggle-btn' + (!registered ? ' selected-fee' : ''); artistProfile.gstRegistered = registered; }

function getProfileVibes() { return Array.from(document.querySelectorAll('#profileVibePicker .vibe-btn.selected')).map(b => b.textContent.trim()); }
function toggleProfileVibe(btn) {
  btn.classList.toggle('selected');
  renderCardPillsPicker();
}

function initProfileGenres() {
  const wrap = document.getElementById('profileGenreChips'); if (wrap.children.length > 0) return;
  ALL_GENRES.forEach(g => { const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'vibe-btn'; chip.textContent = g; chip.onclick = () => { chip.classList.toggle('selected'); renderProfileSubgenres(); renderCardPillsPicker(); }; wrap.appendChild(chip); });
}

function renderProfileSubgenres() {
  const PSUB = { 'Techno':['Peak Time','Hard Techno','Schranz','Industrial','Melodic Techno','Atmospheric','Raw / Hypnotic','Minimal','Deep Tech','Detroit','Acid','Rave'],'House':['Tech House','Deep House','Afro House','Organic House','UK Garage','2-Step','Progressive House','Melodic House','Jackin House','Funky / Groove','Electro House','Soulful'],'Drum & Bass':['Liquid','Rollers','Neurofunk','Jump Up','Dark / Atmospheric','Jungle','Techstep','Minimal DnB'],'Breaks':['Psy Breaks','Nu Skool Breaks','Electro Breaks','Florida Breaks','Acid Breaks','Big Beat','Breakbeat'],'Psytrance':['Full On','Goa','Dark Psy','Forest Psy','Hi-Tech','Twilight','Psybient','Suomi'],'Progressive Psy':['Night Prog','Psyprog','Prog Trance','Minimal Psy','Chunk'],'Dubstep / Bass':['Dubstep','UK Dubstep','Brostep','Riddim','Bass House','UK Bass','Future Bass','Trap','Footwork','Halftime','80 BPM','Glitch Hop','Leftfield','Grime'],'Hard Dance / Hardcore':['Hard Techno','Hardstyle','Hardcore','Gabber','Happy Hardcore','UK Hardcore'],'Trance':['Progressive Trance','Uplifting Trance','Vocal Trance','Tech Trance','Acid Trance'] };
  const selected = Array.from(document.querySelectorAll('#profileGenreChips .vibe-btn.selected')).map(b => b.textContent.trim());
  const subWrap = document.getElementById('profileSubgenreChips'); subWrap.innerHTML = '';
  selected.forEach(g => { if (!PSUB[g]) return; PSUB[g].forEach(sub => { const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'vibe-btn'; chip.textContent = sub; chip.onclick = () => chip.classList.toggle('selected'); subWrap.appendChild(chip); }); });
renderCardPillsPicker();
}

function renderCardPillsPicker() {
  const section = document.getElementById('cardPillsSection');
  const picker = document.getElementById('cardPillsPicker');
  if (!section || !picker) return;
  const genres = Array.from(document.querySelectorAll('#profileGenreChips .vibe-btn.selected')).map(b => b.textContent.trim());
  const subs = Array.from(document.querySelectorAll('#profileSubgenreChips .vibe-btn.selected')).map(b => b.textContent.trim());
  const vibes = Array.from(document.querySelectorAll('#profileVibePicker .vibe-btn.selected')).map(b => b.textContent.trim());
  const all = [...new Set([...genres, ...subs, ...vibes])];
  if (!all.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  const existing = artistProfile.cardPills ? artistProfile.cardPills.split(' · ') : [];
  picker.innerHTML = '';
  all.forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vibe-btn' + (existing.includes(tag) ? ' selected' : '');
    btn.textContent = tag;
    btn.onclick = () => {
      const selected = picker.querySelectorAll('.vibe-btn.selected');
      if (btn.classList.contains('selected')) {
        btn.classList.remove('selected');
      } else if (selected.length < 5) {
        btn.classList.add('selected');
      } else {
        showToast('Max 5 card tags', 'error');
        return;
      }
      document.getElementById('cardPillsCount').textContent = picker.querySelectorAll('.vibe-btn.selected').length + ' / 5 selected';
    };
    picker.appendChild(btn);
  });
  document.getElementById('cardPillsCount').textContent = existing.filter(t => all.includes(t)).length + ' / 5 selected';
}

function getCardPills() {
  const picker = document.getElementById('cardPillsPicker');
  if (!picker) return '';
  return Array.from(picker.querySelectorAll('.vibe-btn.selected')).map(b => b.textContent.trim()).join(' · ');
}

function getProfileGenreString() {
  const genres = Array.from(document.querySelectorAll('#profileGenreChips .vibe-btn.selected')).map(b => b.textContent.trim());
  const subs   = Array.from(document.querySelectorAll('#profileSubgenreChips .vibe-btn.selected')).map(b => b.textContent.trim());
  const vibes  = getProfileVibes();
  return [...genres, ...subs, ...vibes].join(' · ');
}

function closeMemberModal() { document.getElementById('becomeMemberOverlay').classList.remove('open'); }

async function saveProfile() {
  if (currentUser?.id === 'guest') { document.getElementById('becomeMemberOverlay').classList.add('open'); return; }
  const btn = document.getElementById('saveProfileBtn'); btn.disabled = true; btn.textContent = 'SAVING...';
  artistProfile = { ...artistProfile, djName: document.getElementById('profileDjName').value.trim(), label: document.getElementById('profileLabel').value.trim(), location: document.getElementById('profileLocation').value.trim(), state: document.getElementById('profileState').value, tagline: document.getElementById('profileTagline').value.trim(), bio: document.getElementById('profileBio').value.trim(), age: document.getElementById('profileAgeNone').checked ? 'prefer-not-to-say' : document.getElementById('profileAge').value.trim(), agePrivate: document.getElementById('profileAgePrivate').checked, ageNone: document.getElementById('profileAgeNone').checked, mixLink: document.getElementById('profileMixLink').value.trim(), experience: artistProfile.experience || '', techSetup: artistProfile.techSetup || '', feeType: artistProfile.feeType || '', fee: document.getElementById('profileFee').value.trim(), feeLocal: document.getElementById('profileFeeLocal') ? document.getElementById('profileFeeLocal').checked : false, feePlusTravelLocal: document.getElementById('profileFeePlusTravelLocal').checked, feeNegotiable: document.getElementById('profileFeeNegotiable').checked, abn: document.getElementById('profileABN') ? document.getElementById('profileABN').value.trim() : '', emergencyName: document.getElementById('profileEmergencyName').value.trim(), emergencyPhone: document.getElementById('profileEmergencyPhone').value.trim(), emergencyRel: document.getElementById('profileEmergencyRel').value.trim(), sound: document.getElementById('profileSound').value.trim(), genreString: getProfileGenreString(), cardPills: getCardPills(), soundcloud: document.getElementById('profileSoundcloud').value.trim(), mixcloud: document.getElementById('profileMixcloud').value.trim(), instagram: document.getElementById('profileInstagram').value.trim(), youtube: document.getElementById('profileYoutube').value.trim(), facebook: document.getElementById('profileFacebook').value.trim(), updatedAt: new Date().toISOString() };
  try { localStorage.setItem('yp_artist_profile', JSON.stringify(artistProfile)); } catch(e) {}
  await upsertProfileToSupabase(artistProfile, 'artist');
  btn.disabled = false; btn.textContent = 'SAVE PROFILE →';
  updateArtistDashCard(); updateToggleVisibility('artist');
  setTimeout(() => { if (currentMode === 'artist') enterArtistDashboard(); else enterDashboard(); }, 1200);
}

function loadProfileData() {
  if (!DEMO) { try { const saved = localStorage.getItem('yp_artist_profile'); if (saved) artistProfile = JSON.parse(saved); } catch(e) {} }
  if (artistProfile.avatar) { const img = document.getElementById('avatarPreview'); img.onerror = () => { img.style.display = 'none'; document.getElementById('avatarPlaceholder').style.display = 'flex'; }; img.src = artistProfile.avatar; img.style.display = 'block'; document.getElementById('avatarPlaceholder').style.display = 'none'; }
  document.getElementById('profileDjName').value = artistProfile.djName || '';
  document.getElementById('profileLabel').value = artistProfile.label || '';
  document.getElementById('profileLocation').value = artistProfile.location || '';
  document.getElementById('profileState').value = artistProfile.state || '';
  document.getElementById('profileTagline').value = artistProfile.tagline || '';
  document.getElementById('profileBio').value = artistProfile.bio || '';
  const ageNoneEl = document.getElementById('profileAgeNone'), ageEl = document.getElementById('profileAge'), agePriEl = document.getElementById('profileAgePrivate');
  if (artistProfile.ageNone) { if (ageNoneEl) { ageNoneEl.checked = true; if (ageEl) ageEl.disabled = true; } }
  else { if (ageEl) { ageEl.disabled = false; ageEl.value = (artistProfile.age && artistProfile.age !== 'prefer-not-to-say') ? artistProfile.age : ''; } if (ageNoneEl) ageNoneEl.checked = false; }
  if (agePriEl) agePriEl.checked = !!artistProfile.agePrivate;
  document.getElementById('profileMixLink').value = artistProfile.mixLink || '';
  document.getElementById('profileFee').value = artistProfile.fee || '';
  const flEl = document.getElementById('profileFeeLocal'), ftlEl = document.getElementById('profileFeePlusTravelLocal'), fnEl = document.getElementById('profileFeeNegotiable');
  if (flEl) flEl.checked = !!artistProfile.feeLocal; if (ftlEl) ftlEl.checked = !!artistProfile.feePlusTravelLocal; if (fnEl) fnEl.checked = !!artistProfile.feeNegotiable;
  document.getElementById('profileEmergencyName').value  = artistProfile.emergencyName  || '';
  document.getElementById('profileEmergencyPhone').value = artistProfile.emergencyPhone || '';
  document.getElementById('profileEmergencyRel').value   = artistProfile.emergencyRel   || '';
  const soundEl = document.getElementById('profileSound'); if (soundEl) { soundEl.value = artistProfile.sound || ''; updateSoundCount(); }
  document.getElementById('profileSoundcloud').value = artistProfile.soundcloud || '';
  document.getElementById('profileMixcloud').value   = artistProfile.mixcloud   || '';
  document.getElementById('profileInstagram').value  = artistProfile.instagram  || '';
  document.getElementById('profileYoutube').value    = artistProfile.youtube    || '';
  document.getElementById('profileFacebook').value   = artistProfile.facebook   || '';
  updateTaglineCount(); updateBioCount();
  document.querySelectorAll('.exp-pill').forEach(p => p.classList.toggle('selected', p.textContent === artistProfile.experience));
  document.querySelectorAll('.tech-pill').forEach(p => p.classList.toggle('selected', p.textContent === artistProfile.techSetup));
  if (artistProfile.feeType) selectFeeType(artistProfile.feeType);
  if (artistProfile.hasABN !== undefined) { selectABN(artistProfile.hasABN); if (artistProfile.hasABN) { const abnEl = document.getElementById('profileABN'); if (abnEl) abnEl.value = artistProfile.abn || ''; if (artistProfile.gstRegistered !== undefined) selectGST(artistProfile.gstRegistered); } }
  if (artistProfile.genreString) {
    const parts = artistProfile.genreString.split(' · ').map(s => s.trim());
    const ALL_VIBES = ['Fun','Funky','Groove','Wobbly','Thinky','Bouncy','Uplifting','Clubby','Bangers','Staunch','Crankin','Chunks','Sinister','Techy','Melodic','Hypnotic','Deep','Dark','Dank','Organic','Lush','Shanti','Warm Up','Wonky','Sleazy','Cocktail','Classy','Minimal','Experimental','USA','UK','VOX'];
    document.querySelectorAll('#profileGenreChips .vibe-btn').forEach(btn => { if (parts.includes(btn.textContent.trim())) btn.classList.add('selected'); });
    renderProfileSubgenres();
    setTimeout(() => { document.querySelectorAll('#profileSubgenreChips .vibe-btn').forEach(btn => { if (parts.includes(btn.textContent.trim())) btn.classList.add('selected'); }); }, 50);
    document.querySelectorAll('#profileVibePicker .vibe-btn').forEach(btn => { if (ALL_VIBES.includes(btn.textContent.trim()) && parts.includes(btn.textContent.trim())) btn.classList.add('selected'); });
  }
 setTimeout(() => {
  renderCardPillsPicker();
  setTimeout(() => {
    const savedPills = (artistProfile.cardPills || '').split(' · ').filter(Boolean);
    document.querySelectorAll('#cardPillsPicker .vibe-btn').forEach(btn => {
      if (savedPills.includes(btn.textContent.trim())) btn.classList.add('selected');
    });
    const count = document.querySelectorAll('#cardPillsPicker .vibe-btn.selected').length;
    const countEl = document.getElementById('cardPillsCount');
    if (countEl) countEl.textContent = count + ' / 5 selected';
  }, 100);
}, 300);
}

function renderUpcomingGigs() {
  const list = document.getElementById('upcomingGigsList'); if (!list) return;
  const gigs = [];
  if (DEMO) {
    gigs.push({ eventName: 'Solstice Soirée', venue: 'Vabooshna', date: 'June 20 / 21', slotTime: '10:00 PM', slotDur: '1.5 hrs', private: false });
    gigs.push({ eventName: 'Subsonic Winter 2025', venue: 'Location TBA', date: 'July 19', slotTime: null, slotDur: null, private: true });
  }
  if (!gigs.length) { list.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:12px 0;">No upcoming bookings yet.</div>'; return; }
  list.innerHTML = gigs.map(g => `<div class="gig-card"><div class="gig-event-name">${g.eventName}</div><div class="gig-meta">${g.venue} · ${g.date}</div>${g.private ? '<span class="gig-slot private">🔒 Set time private — host will confirm closer to the event</span>' : `<span class="gig-slot visible">${g.slotTime} · ${g.slotDur}</span>`}</div>`).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  const tagline = document.getElementById('profileTagline');
  const bio = document.getElementById('profileBio');
  const sound = document.getElementById('profileSound');
  if (tagline) tagline.addEventListener('input', updateTaglineCount);
  if (bio) bio.addEventListener('input', updateBioCount);
  if (sound) sound.addEventListener('input', updateSoundCount);
});

function updateTaglineCount() { const el = document.getElementById('profileTagline'), ct = document.getElementById('taglineCharCount'); if (el && ct) ct.textContent = `${el.value.length} / 120`; }
function updateBioCount() { const el = document.getElementById('profileBio'), ct = document.getElementById('bioCharCount'); if (el && ct) ct.textContent = `${el.value.length} / 500`; }
function updateSoundCount() { const el = document.getElementById('profileSound'), ct = document.getElementById('soundCharCount'); if (el && ct) ct.textContent = `${el.value.length} / 35`; }

// ── Host profile ───────────────────────────────────

function initHostProfileGenres() {
  const wrap = document.getElementById('hostProfileGenreChips'); if (!wrap || wrap.children.length > 0) return;
  ALL_GENRES.forEach(g => { const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'vibe-btn'; chip.textContent = g; chip.onclick = () => { chip.classList.toggle('selected'); renderHostProfileSubgenres(); }; wrap.appendChild(chip); });
}

function renderHostProfileSubgenres() {
  const SUBG = { 'Techno':['Peak Time','Hard Techno','Schranz','Industrial','Melodic Techno','Atmospheric','Raw / Hypnotic','Minimal','Deep Tech','Detroit','Acid','Rave'],'House':['Tech House','Deep House','Afro House','Organic House','UK Garage','2-Step','Progressive House','Melodic House','Jackin House','Funky / Groove','Electro House','Soulful'],'Drum & Bass':['Liquid','Rollers','Neurofunk','Jump Up','Dark / Atmospheric','Jungle','Techstep','Minimal DnB'],'Breaks':['Psy Breaks','Nu Skool Breaks','Electro Breaks','Florida Breaks','Acid Breaks','Big Beat','Breakbeat'],'Psytrance':['Full On','Goa','Dark Psy','Forest Psy','Hi-Tech','Twilight','Psybient','Suomi'],'Progressive Psy':['Night Prog','Psyprog','Prog Trance','Minimal Psy','Chunk'],'Dubstep / Bass':['Dubstep','UK Dubstep','Brostep','Riddim','Bass House','UK Bass','Future Bass','Trap','Footwork','Halftime','80 BPM','Glitch Hop','Leftfield','Grime'],'Hard Dance / Hardcore':['Hard Techno','Hardstyle','Hardcore','Gabber','Happy Hardcore','UK Hardcore'] };
  const selected = Array.from(document.querySelectorAll('#hostProfileGenreChips .vibe-btn.selected')).map(b => b.textContent.trim());
  const subWrap = document.getElementById('hostProfileSubgenreChips'); if (!subWrap) return; subWrap.innerHTML = '';
  selected.forEach(g => { if (!SUBG[g]) return; SUBG[g].forEach(sub => { const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'vibe-btn'; chip.textContent = sub; chip.onclick = () => chip.classList.toggle('selected'); subWrap.appendChild(chip); }); });
}

function getHostProfileGenreString() {
  const genres = Array.from(document.querySelectorAll('#hostProfileGenreChips .vibe-btn.selected')).map(b => b.textContent.trim());
  const subs   = Array.from(document.querySelectorAll('#hostProfileSubgenreChips .vibe-btn.selected')).map(b => b.textContent.trim());
  const vibes  = Array.from(document.querySelectorAll('#hostProfileVibePicker .vibe-btn.selected')).map(b => b.textContent.trim());
  return [...genres, ...subs, ...vibes].join(' · ');
}

async function saveHostProfile() {
  const btn = document.getElementById('saveHostProfileBtn'); btn.disabled = true; btn.textContent = 'SAVING...';
  const nameVal = document.getElementById('hostProfileName').value.trim();
  showToast(`Saving name: "${nameVal}"`, 'success');
  hostProfile = { ...hostProfile, name: nameVal, location: document.getElementById('hostProfileLocation').value.trim(), state: document.getElementById('hostProfileState').value, years: document.getElementById('hostProfileYears').value.trim(), bio: document.getElementById('hostProfileBio').value.trim(), instagram: document.getElementById('hostProfileInstagram').value.trim(), website: document.getElementById('hostProfileWebsite').value.trim(), email: document.getElementById('hostProfileEmail').value.trim(), genreString: getHostProfileGenreString() };
  try { localStorage.setItem('yp_host_profile', JSON.stringify(hostProfile)); } catch(e) {}
  await upsertProfileToSupabase(hostProfile, 'host');
  btn.disabled = false; btn.textContent = 'SAVE HOST PROFILE →';
  updateDashProfileCard(); updateToggleVisibility('host');
  setTimeout(() => enterDashboard(), 1200);
}

function loadHostProfileData() {
  if (!DEMO) { try { const saved = localStorage.getItem('yp_host_profile'); if (saved) hostProfile = JSON.parse(saved); } catch(e) {} }
  if (hostProfile.avatar) { const img = document.getElementById('hostAvatarPreview'); if (img) { img.onerror = () => { img.style.display = 'none'; const ph = document.getElementById('hostAvatarPlaceholder'); if (ph) ph.style.display = 'flex'; }; img.src = hostProfile.avatar; img.style.display = 'block'; } const ph = document.getElementById('hostAvatarPlaceholder'); if (ph) ph.style.display = 'none'; }
  document.getElementById('hostProfileName').value      = hostProfile.name      || '';
  document.getElementById('hostProfileLocation').value  = hostProfile.location  || '';
  document.getElementById('hostProfileState').value     = hostProfile.state     || '';
  document.getElementById('hostProfileYears').value     = hostProfile.years     || '';
  document.getElementById('hostProfileBio').value       = hostProfile.bio       || '';
  document.getElementById('hostProfileInstagram').value = hostProfile.instagram || '';
  document.getElementById('hostProfileWebsite').value   = hostProfile.website   || '';
  document.getElementById('hostProfileEmail').value     = hostProfile.email     || '';
  updateHostBioCount();
  if (hostProfile.genreString) {
    const parts = hostProfile.genreString.split(' · ').map(s => s.trim());
    const ALL_VIBES = ['Fun','Funky','Groove','Wobbly','Thinky','Bouncy','Uplifting','Clubby','Bangers','Staunch','Crankin','Chunks','Sinister','Techy','Melodic','Hypnotic','Deep','Dark','Dank','Organic','Lush','Shanti','Warm Up','Wonky','Experimental','Underground'];
    initHostProfileGenres();
    document.querySelectorAll('#hostProfileGenreChips .vibe-btn').forEach(btn => { if (parts.includes(btn.textContent.trim())) btn.classList.add('selected'); });
    renderHostProfileSubgenres();
    setTimeout(() => { document.querySelectorAll('#hostProfileSubgenreChips .vibe-btn').forEach(btn => { if (parts.includes(btn.textContent.trim())) btn.classList.add('selected'); }); document.querySelectorAll('#hostProfileVibePicker .vibe-btn').forEach(btn => { if (ALL_VIBES.includes(btn.textContent.trim()) && parts.includes(btn.textContent.trim())) btn.classList.add('selected'); }); }, 50);
  }
}

document.addEventListener('DOMContentLoaded', () => { const hbio = document.getElementById('hostProfileBio'); if (hbio) hbio.addEventListener('input', updateHostBioCount); });
function updateHostBioCount() { const el = document.getElementById('hostProfileBio'), ct = document.getElementById('hostBioCharCount'); if (el && ct) ct.textContent = `${el.value.length} / 400`; }

function handleHostAvatarUpload(e) { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = ev => { const img = document.getElementById('hostAvatarPreview'); img.src = ev.target.result; img.style.display = 'block'; document.getElementById('hostAvatarPlaceholder').style.display = 'none'; hostProfile.avatar = ev.target.result; }; reader.readAsDataURL(file); }

// ── Withdraw ───────────────────────────────────────

let _withdrawPending = null;

function openWithdrawConfirm(eventId, slotId, slotLabel) { _withdrawPending = { eventId, slotId, slotLabel }; document.getElementById('withdrawConfirmOverlay').classList.add('open'); }
function closeWithdrawConfirm() { document.getElementById('withdrawConfirmOverlay').classList.remove('open'); _withdrawPending = null; }

async function confirmWithdraw() {
  if (!_withdrawPending) return;
  const { eventId, slotId, slotLabel } = _withdrawPending;
  closeWithdrawConfirm();
  await deleteClaim(slotId);
  delete claims[slotId];
  if (typeof demoClaims !== 'undefined' && demoClaims?.[eventId]) delete demoClaims[eventId][slotId];
  pushNotif('👋', `You withdrew from ${slotLabel}`, 'artist');
  pushNotif('👋', `${artistProfile.djName || 'An artist'} withdrew from ${slotLabel}`, 'host');
  showToast('Withdrawn from slot.', 'success');
  renderAll(); enterArtistDashboard();
}
// ── Manual gig CRUD ────────────────────────────────

async function loadManualGigs() {
  if (DEMO || !currentUser?.id || currentUser.id === 'guest') return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/gigs?artist_id=eq.${currentUser.id}&order=created_at.desc`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${currentSession.access_token}` } }
    );
    return res.ok ? await res.json() : [];
  } catch(e) { return []; }
}

async function saveManualGig(gig) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/gigs`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${currentSession.access_token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      artist_id:  currentUser.id,
      event_name: gig.event_name,
      venue:      gig.venue,
      date:       gig.date,
      poster_url: gig.poster_url || ''
    })
  });
  return res.ok ? await res.json() : null;
}

async function deleteManualGig(gigId) {
  await fetch(`${SUPABASE_URL}/rest/v1/gigs?id=eq.${gigId}`, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${currentSession.access_token}` }
  });
}

// ── Unified gig card builder ───────────────────────
// type: 'confirmed' | 'manual'
// confirmed = cyan border, visible on public profile
// manual    = purple border, only artist can see

function buildGigCard(data, type, onDelete) {
  const isConfirmed = type === 'confirmed';
  const borderColor = isConfirmed ? 'var(--neon2)'        : 'rgba(176,96,255,.7)';
  const bgColor     = isConfirmed ? 'rgba(0,229,255,.04)' : 'rgba(176,96,255,.04)';
  const badgeColor  = isConfirmed ? 'var(--neon2)'        : 'rgba(176,96,255,.9)';
  const badgeBg     = isConfirmed ? 'rgba(0,229,255,.12)' : 'rgba(176,96,255,.12)';
  const badgeBorder = isConfirmed ? 'rgba(0,229,255,.3)'  : 'rgba(176,96,255,.3)';
  const badgeText   = isConfirmed ? 'CONFIRMED ✓'         : 'SELF-LISTED';

  const name     = esc(data.event_name || data.eventName || '');
  const venue    = esc(data.venue || '');
  const date     = esc(data.date  || '');
  const slotTime = data.slotTime ? esc(data.slotTime) : null;
  const slotDur  = data.slotDur  ? esc(data.slotDur)  : null;

  const card = document.createElement('div');
  card.className = 'gig-card';
  card.style.cssText = `border:1.5px solid ${borderColor};background:${bgColor};position:relative;`;

  const slotHtml = slotTime
    ? `<span class="gig-slot visible">${slotTime}${slotDur ? ' · ' + slotDur : ''}</span>`
    : isConfirmed ? `<span class="gig-slot private">Slot time TBC</span>` : '';

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
      <div class="gig-event-name">${name}</div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:8px;">
        <span style="font-family:'Bebas Neue',sans-serif;font-size:9px;letter-spacing:1.5px;color:${badgeColor};background:${badgeBg};border:1px solid ${badgeBorder};border-radius:10px;padding:2px 8px;white-space:nowrap;">${badgeText}</span>
        <button class="gig-remove-btn" style="background:rgba(255,45,120,.12);border:1px solid rgba(255,45,120,.4);border-radius:6px;color:var(--neon);font-size:12px;cursor:pointer;padding:3px 8px;line-height:1;">✕ LEAVE</button>
      </div>
    </div>
    <div class="gig-meta">${venue}${venue && date ? ' · ' : ''}${date}</div>
    ${slotHtml}
  `;

  // Remove button — confirmed: unclaim from Supabase; manual: delete gig record
  const removeBtn = card.querySelector('.gig-remove-btn');
  if (isConfirmed && data.eventId) {
    removeBtn.onclick = (e) => { e.stopPropagation(); openRemoveGigConfirm(data.eventId, name); };
  } else if (!isConfirmed && onDelete) {
    removeBtn.onclick = (e) => { e.stopPropagation(); confirmDeleteGig(data.id); };
  } else {
    removeBtn.style.display = 'none';
  }

  return card;
}

let _removeGigEventId = null;

// ── Leave slot confirm (from event view) ────────────

let _leaveSlotId = null;

function openLeaveSlotConfirm(slotId) {
  _leaveSlotId = slotId;
  const overlay = document.getElementById('leaveSlotConfirmOverlay');
  if (overlay) overlay.classList.add('open');
}

function closeLeaveSlotConfirm() {
  _leaveSlotId = null;
  const overlay = document.getElementById('leaveSlotConfirmOverlay');
  if (overlay) overlay.classList.remove('open');
}

async function confirmLeaveSlot() {
  if (!_leaveSlotId) return;
  const btn = document.getElementById('leaveSlotConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'LEAVING...'; }
  const ok = await deleteClaim(_leaveSlotId);
  if (ok) {
    closeLeaveSlotConfirm();
    showToast('Removed from slot ✓', 'success');
    loadClaims();
  } else {
    showToast('Could not remove — try again.', 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'YES, LEAVE SLOT'; }
}

function openRemoveGigConfirm(eventId, eventName) {
  _removeGigEventId = eventId;
  const overlay = document.getElementById('removeGigConfirmOverlay');
  const nameEl  = document.getElementById('removeGigEventName');
  if (nameEl) nameEl.textContent = eventName || 'this event';
  if (overlay) overlay.classList.add('open');
}

function closeRemoveGigConfirm() {
  _removeGigEventId = null;
  const overlay = document.getElementById('removeGigConfirmOverlay');
  if (overlay) overlay.classList.remove('open');
}

async function confirmRemoveGig() {
  if (!_removeGigEventId) return;
  const btn = document.getElementById('removeGigConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'REMOVING...'; }
  try {
    await sbRest(
      `claims?user_id=eq.${currentUser.id}&event_id=eq.${_removeGigEventId}`,
      { method: 'DELETE' },
      currentSession.access_token
    );
    closeRemoveGigConfirm();
    showToast('Removed from gig ✓', 'success');
    renderArtistDashGigsWithManual();
  } catch(e) {
    showToast('Could not remove — try again.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'YES, REMOVE ME'; }
  }
}

// ── Load confirmed YesPleez gigs for artist ────────

async function loadConfirmedYPGigs() {
  if (DEMO || !currentUser?.id || currentUser.id === 'guest') return [];
  try {
    // Get all claims by this user, with event data
    const claims = await sbRest(
      `claims?user_id=eq.${currentUser.id}&select=slot_id,event_id`,
      { method: 'GET' }, currentSession.access_token
    );
    if (!claims?.length) return [];

    const eventIds = [...new Set(claims.map(c => c.event_id).filter(Boolean))];
    if (!eventIds.length) return [];

    const events = await sbRest(
      `events?id=in.(${eventIds.join(',')})&select=id,name,config`,
      { method: 'GET' }, currentSession.access_token
    );
    if (!events?.length) return [];

    return events.map(ev => {
      const cfg = ev.config || {};
      const myClaimSlotId = claims.find(c => c.event_id === ev.id)?.slot_id;
      let slotTime = null, slotDur = null;
      (cfg.days || []).forEach(d => d.slots?.forEach(s => {
        if (s.id === myClaimSlotId) { slotTime = s.time + ' ' + s.ampm; slotDur = s.dur; }
      }));
      return {
        eventId:   ev.id,
        eventName: ev.name || cfg.name || 'Untitled Event',
        venue:     cfg.venue || '',
        date:      cfg.date  || '',
        days:      cfg.days  || [],
        slotTime, slotDur
      };
    });
  } catch(e) { console.warn('loadConfirmedYPGigs:', e.message); return []; }
}

// ── Add gig modal ──────────────────────────────────

function openAddGigModal() {
  document.getElementById('addGigName').value   = '';
  document.getElementById('addGigVenue').value  = '';
  document.getElementById('addGigDate').value   = '';
  document.getElementById('addGigOverlay').classList.add('open');
}

function closeAddGigModal() {
  document.getElementById('addGigOverlay').classList.remove('open');
}

async function submitAddGig() {
  const name  = document.getElementById('addGigName').value.trim();
  const venue = document.getElementById('addGigVenue').value.trim();
  const date  = document.getElementById('addGigDate').value.trim();
  if (!name) { showToast('Enter an event name.', 'error'); return; }
  const btn = document.getElementById('addGigSubmitBtn');
  btn.disabled = true; btn.textContent = 'SAVING...';
  const result = await saveManualGig({ event_name: name, venue, date });
  btn.disabled = false; btn.textContent = 'ADD GIG →';
  if (result) {
    closeAddGigModal();
    showToast('Gig added ✓', 'success');
    renderArtistDashGigsWithManual();
  } else {
    showToast('Failed to save — try again.', 'error');
  }
}

// ── Render gigs (confirmed YesPleez + self-listed) ─

async function renderArtistDashGigsWithManual() {
  const list = document.getElementById('artistDashGigs'); if (!list) return;
  list.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0;">Loading...</div>';

  const [confirmedGigs, manualGigs] = await Promise.all([
    loadConfirmedYPGigs(),
    loadManualGigs()
  ]);

  list.innerHTML = '';

  confirmedGigs.forEach(g => {
    const card = buildGigCard(g, 'confirmed', null);
    if (g.eventId) {
      card.style.cursor = 'pointer';
      card.title = 'Tap to view set times';
      card.onclick = () => openArtistEvent({ eventId: g.eventId });
    }
    list.appendChild(card);
  });

  manualGigs.forEach(g => {
    list.appendChild(buildGigCard(g, 'manual', `confirmDeleteGig('${g.id}')`));
  });

  if (!confirmedGigs.length && !manualGigs.length) {
    list.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:8px 0;">No upcoming gigs yet.</div>';
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-ghost';
  addBtn.style.cssText = 'width:100%;margin-top:10px;border-color:rgba(176,96,255,.6);color:rgba(176,96,255,.9);font-size:12px;';
  addBtn.textContent = '+ ADD A GIG';
  addBtn.onclick = openAddGigModal;
  list.appendChild(addBtn);
}

async function confirmDeleteGig(gigId) {
  await deleteManualGig(gigId);
  showToast('Gig removed', 'success');
  renderArtistDashGigsWithManual();
}
