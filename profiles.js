// ═══════════════════════════════════════════════════
//  profiles.js — YesPleez Profiles Module
//  Handles artist + host profile CRUD and public profile view
//  Depends on: state.js, auth.js (sbRest), navigation.js (show, showToast)
// ═══════════════════════════════════════════════════

// ── Supabase profile CRUD ──────────────────────────

async function upsertProfileToSupabase(profile, type) {
  if (DEMO) return;
  if (!currentSession?.access_token) {
    showToast('Not synced — session missing. Try signing out and back in.', 'error');
    return;
  }
  if (!currentUser?.id) {
    showToast('Not synced — user ID missing.', 'error');
    return;
  }
  try {
    const payload = {
      user_id:           currentUser.id,
      type:              type,
      dj_name:           profile.djName        || profile.name || '',
      sound:             profile.sound         || '',
      name:              profile.name          || profile.djName || '',
      location:          profile.location      || '',
      state:             profile.state         || '',
      bio:               profile.bio           || '',
      tagline:           profile.tagline       || '',
      age:               profile.ageNone ? 'prefer-not-to-say' : (profile.age || ''),
      age_private:       !!profile.agePrivate,
      experience:        profile.experience    || '',
      tech_setup:        profile.techSetup     || '',
      fee_type:          profile.feeType       || '',
      fee:               profile.fee           || '',
      fee_local:         !!profile.feeLocal,
      fee_plus_travel:   !!profile.feePlusTravelLocal,
      fee_negotiable:    !!profile.feeNegotiable,
      genre_string:      profile.genreString   || '',
      mix_link:          profile.mixLink       || '',
      soundcloud:        profile.soundcloud    || '',
      mixcloud:          profile.mixcloud      || '',
      instagram:         profile.instagram     || '',
      youtube:           profile.youtube       || '',
      facebook:          profile.facebook      || '',
      website:           profile.website       || '',
      email:             profile.email         || '',
      avatar:            profile.avatar        || '',
      years:             profile.years         || '',
      label:             profile.label         || '',
      card_pills:        profile.cardPills     || '',
      emergency_name:    profile.emergencyName  || '',
      emergency_phone:   profile.emergencyPhone || '',
      emergency_rel:     profile.emergencyRel   || '',
      updated_at:        new Date().toISOString()
    };
    const token = currentSession.access_token;
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    };
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${currentUser.id}&type=eq.${type}&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` } }
    );
    const existing = await checkRes.json().catch(() => []);

    let writeRes;
    if (existing && existing.length > 0) {
      writeRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${currentUser.id}&type=eq.${type}`,
        { method: 'PATCH', headers, body: JSON.stringify(payload) }
      );
    } else {
      writeRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles`,
        { method: 'POST', headers, body: JSON.stringify(payload) }
      );
    }

    if (writeRes.ok || writeRes.status === 201 || writeRes.status === 204) {
      showToast(`${type} profile synced ✓`, 'success');
    } else {
      const errText = await writeRes.text();
      showToast(`Sync error ${writeRes.status}: ${errText.substring(0,80)}`, 'error');
    }
  } catch(e) {
    showToast(`Sync failed: ${e.message}`, 'error');
  }
}

async function loadProfileFromSupabase(type) {
  if (DEMO || !currentSession?.access_token || !currentUser?.id) return null;
  try {
    const rows = await sbRest(
      `profiles?user_id=eq.${currentUser.id}&type=eq.${type}&limit=1`,
      { method: 'GET' },
      currentSession.access_token
    );
    return rows && rows.length ? rows[0] : null;
  } catch(e) {
    console.warn('Profile load failed:', e.message);
    return null;
  }
}

// ── DB row mappers ─────────────────────────────────

function mapDbToArtistProfile(row) {
  return {
    djName:             row.dj_name       || '',
    sound:              row.sound         || '',
    label:              row.label         || '',
    location:           row.location      || '',
    state:              row.state         || '',
    tagline:            row.tagline       || '',
    bio:                row.bio           || '',
    age:                row.age           || '',
    agePrivate:         !!row.age_private,
    ageNone:            row.age === 'prefer-not-to-say',
    experience:         row.experience    || '',
    techSetup:          row.tech_setup    || '',
    feeType:            row.fee_type      || '',
    fee:                row.fee           || '',
    feeLocal:           !!row.fee_local,
    feePlusTravelLocal: !!row.fee_plus_travel,
    feeNegotiable:      !!row.fee_negotiable,
    genreString:        row.genre_string  || '',
    cardPills:          row.card_pills    || '',
    mixLink:            row.mix_link      || '',
    soundcloud:         row.soundcloud    || '',
    mixcloud:           row.mixcloud      || '',
    instagram:          row.instagram     || '',
    youtube:            row.youtube       || '',
    facebook:           row.facebook      || '',
    avatar:             row.avatar        || '',
    emergencyName:      row.emergency_name  || '',
    emergencyPhone:     row.emergency_phone || '',
    emergencyRel:       row.emergency_rel   || '',
    updatedAt:          row.updated_at    || ''
  };
}

function mapDbToHostProfile(row) {
  return {
    name:        row.name || row.dj_name  || '',
    location:    row.location     || '',
    state:       row.state        || '',
    years:       row.years        || '',
    bio:         row.bio          || '',
    instagram:   row.instagram    || '',
    website:     row.website      || '',
    email:       row.email        || '',
    genreString: row.genre_string || '',
    avatar:      row.avatar       || ''
  };
}

// ── Profile search ─────────────────────────────────

async function searchProfiles(query, filterType, filterState) {
  try {
    let path = `profiles?select=*`;
    if (filterType && filterType !== 'all') path += `&type=eq.${filterType}`;
    if (filterState && filterState !== 'all') {
      const s = encodeURIComponent(`%${filterState}%`);
      // Match on state column OR location column (covers both storage patterns)
      path += `&or=(state.ilike.${s},location.ilike.${s})`;
    }
    if (query && query.trim()) {
      const q = encodeURIComponent(`%${query.trim()}%`);
      path += `&or=(dj_name.ilike.${q},name.ilike.${q},genre_string.ilike.${q},location.ilike.${q},bio.ilike.${q},tagline.ilike.${q})`;
    }
    path += `&order=updated_at.desc&limit=50`;
    const rows = await sbRest(path, { method: 'GET' }, currentSession?.access_token || null);
    return rows || [];
  } catch(e) {
    console.warn('Search failed:', e.message);
    return [];
  }
}

// ── Public profile view ────────────────────────────

let _viewingProfile = null;

function openPublicProfile(row) {
  _viewingProfile = row;
  const isHost = row.type === 'host';
  const name = row.dj_name || row.name || 'Unknown';
  const location = [row.location, row.state].filter(Boolean).join(', ');
  const genres = row.genre_string ? row.genre_string.split(' · ') : [];
  const topGenres = genres.slice(0, 8);
  const accentColor = isHost ? 'var(--neon)' : 'var(--neon2)';
  const accentRgb = isHost ? '255,45,120' : '0,229,255';

  const heroBg = document.getElementById('profileHeroBg');
  if (row.avatar) {
    heroBg.style.backgroundImage = `url(${row.avatar})`;
  } else {
    heroBg.style.backgroundImage = '';
  }

  const mixLink = row.mix_link || row.soundcloud || row.mixcloud || '';
  const safeName = name.replace(/'/g, "\\'");

  const mixHtml = !isHost ? (mixLink ? `
    <button onclick="openMiniPlayer('${safeName}','${mixLink}','🎧')"
      style="background:rgba(${accentRgb},.12);border:1.5px solid ${accentColor};border-radius:12px;color:${accentColor};font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:2px;padding:14px 24px;cursor:pointer;width:100%;margin-bottom:12px;">
      ▶ PLAY DEMO MIX
    </button>` : `
    <div style="background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.15);border-radius:12px;padding:14px 24px;text-align:center;margin-bottom:12px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:2px;color:var(--muted);">🎵 DEMO MIX COMING SOON</div>
    </div>`) : '';

  const isOwnProfile = currentUser?.id === row.user_id;
  const inviteBtn = !isHost && currentMode === 'host' && !isOwnProfile ? `
    <button onclick="showToast('Invite feature coming soon','success')"
      style="background:var(--neon);color:#fff;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:2px;padding:16px;border:none;border-radius:12px;cursor:pointer;width:100%;font-weight:700;margin-bottom:12px;">
      INVITE TO EVENT →
    </button>` : '';

  const heroSpacer = row.avatar
    ? `<div style="height:55vh;min-height:260px;max-height:420px;"></div>`
    : `<div style="height:60px;"></div>`;

  document.getElementById('publicProfileContent').innerHTML = `
    ${heroSpacer}
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:clamp(42px,12vw,64px);letter-spacing:3px;line-height:.88;text-shadow:0 2px 24px rgba(0,0,0,.9);">${name}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px;flex-wrap:wrap;">
        <span style="font-size:11px;background:rgba(${accentRgb},.15);color:${accentColor};border:1px solid rgba(${accentRgb},.35);border-radius:20px;padding:4px 14px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">${isHost ? 'HOST / PROMOTER' : 'ARTIST / DJ'}</span>
        ${location ? `<span style="font-size:13px;color:rgba(232,232,240,.75);">📍 ${location}</span>` : ''}
      </div>
    </div>
    ${mixHtml}
    ${row.sound ? `
    <div style="background:rgba(19,19,31,.88);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px 16px;margin-bottom:12px;text-align:center;">
      <div style="font-size:15px;color:var(--text);font-style:italic;line-height:1.5;">"${row.sound}"</div>
    </div>` : ''}
    ${row.bio ? `
    <div style="background:rgba(19,19,31,.88);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;margin-bottom:12px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:2px;color:${accentColor};margin-bottom:8px;">ABOUT</div>
      <div style="font-size:14px;color:var(--muted);line-height:1.7;">${row.bio}</div>
    </div>` : ''}
    ${topGenres.length ? `
    <div style="background:rgba(19,19,31,.88);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;margin-bottom:12px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:2px;color:${accentColor};margin-bottom:10px;">GENRES & VIBES</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${topGenres.map(g => `<span style="background:var(--card2);border:1px solid var(--border);border-radius:20px;font-size:12px;padding:4px 12px;color:var(--text);">${g}</span>`).join('')}
      </div>
    </div>` : ''}
    ${row.instagram || row.website ? `
    <div style="background:rgba(19,19,31,.88);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;margin-bottom:12px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:2px;color:${accentColor};margin-bottom:10px;">LINKS</div>
      ${row.instagram ? `<div style="font-size:13px;color:var(--muted);margin-bottom:6px;">📸 @${row.instagram}</div>` : ''}
      ${row.website ? `<div style="font-size:13px;color:var(--neon2);">${row.website}</div>` : ''}
    </div>` : ''}
    ${inviteBtn}
    <div id="publicProfileGigs"></div>
  `;
  show('publicProfileScreen');

  // Load confirmed YesPleez gigs for this artist (non-self-listed only)
  if (!isHost && row.user_id) {
    loadPublicProfileGigs(row.user_id, accentColor, accentRgb);
  }
}

async function loadPublicProfileGigs(userId, accentColor, accentRgb) {
  const container = document.getElementById('publicProfileGigs'); if (!container) return;
  try {
    const claimRows = await sbRest(
      `claims?user_id=eq.${userId}&select=slot_id,event_id`,
      { method: 'GET' }, currentSession?.access_token || null
    );
    if (!claimRows?.length) return;
    const eventIds = [...new Set(claimRows.map(c => c.event_id).filter(Boolean))];
    if (!eventIds.length) return;
    const events = await sbRest(
      `events?id=in.(${eventIds.join(',')})&select=id,name,config`,
      { method: 'GET' }, currentSession?.access_token || null
    );
    if (!events?.length) return;

    const gigs = events.map(ev => {
      const cfg = ev.config || {};
      const mySlotId = claimRows.find(c => c.event_id === ev.id)?.slot_id;
      let slotTime = null, slotDur = null;
      (cfg.days || []).forEach(d => d.slots?.forEach(s => {
        if (s.id === mySlotId) { slotTime = s.time + ' ' + s.ampm; slotDur = s.dur; }
      }));
      return { eventName: ev.name || cfg.name || 'Untitled Event', venue: cfg.venue || '', date: cfg.date || '', slotTime, slotDur };
    });

    container.innerHTML = `
      <div style="background:rgba(19,19,31,.88);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;margin-bottom:12px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:2px;color:${accentColor};margin-bottom:10px;">UPCOMING GIGS</div>
        ${gigs.map(g => `
          <div style="border:1.5px solid rgba(0,229,255,.4);background:rgba(0,229,255,.04);border-radius:10px;padding:10px 12px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
              <div style="font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:1px;">${g.eventName}</div>
              <span style="font-family:'Bebas Neue',sans-serif;font-size:9px;letter-spacing:1.5px;color:var(--neon2);background:rgba(0,229,255,.12);border:1px solid rgba(0,229,255,.3);border-radius:10px;padding:2px 8px;white-space:nowrap;margin-left:8px;">CONFIRMED ✓</span>
            </div>
            <div style="font-size:12px;color:var(--muted);">${g.venue}${g.venue && g.date ? ' · ' : ''}${g.date}</div>
            ${g.slotTime ? `<span style="display:inline-block;margin-top:6px;font-size:11px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:var(--neon2);border:1px solid var(--neon2);border-radius:20px;padding:2px 10px;">${g.slotTime}${g.slotDur ? ' · ' + g.slotDur : ''}</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  } catch(e) { console.warn('loadPublicProfileGigs:', e.message); }
}

// ── Unclaimed Profiles (host creates, artist claims) ──

function openCreateUnclaimedProfile() {
  ['ucpName','ucpSound','ucpGenres','ucpBio','ucpMixLink','ucpEmail'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('createUnclaimedOverlay').style.display = 'flex';
}

function closeCreateUnclaimedProfile() {
  document.getElementById('createUnclaimedOverlay').style.display = 'none';
}

async function submitCreateUnclaimedProfile() {
  const name = document.getElementById('ucpName').value.trim();
  if (!name) { showToast('Artist name is required.', 'error'); return; }
  const payload = {
    name,
    sound:        document.getElementById('ucpSound').value.trim(),
    genre_string: document.getElementById('ucpGenres').value.trim(),
    card_pills:   document.getElementById('ucpGenres').value.trim(),
    bio:          document.getElementById('ucpBio').value.trim(),
    mix_link:     document.getElementById('ucpMixLink').value.trim(),
    claim_email:  document.getElementById('ucpEmail').value.trim().toLowerCase(),
    created_by:   currentUser.id
  };
  try {
    await sbRest('unclaimed_profiles', {
      method: 'POST',
      body: JSON.stringify(payload),
      prefer: 'return=minimal'
    }, currentSession.access_token);
    loadUnclaimedProfiles();
    // Switch modal to invite step
    showUnclaimedInviteStep(name);
  } catch(e) {
    showToast('Could not save: ' + e.message, 'error');
  }
}

function showUnclaimedInviteStep(name) {
  const email = document.getElementById('ucpEmail')?.value.trim() || '';
  const msg = buildInviteMsg(name, email);
  const overlay = document.getElementById('createUnclaimedOverlay');
  overlay.querySelector('div').innerHTML = `
    <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;color:var(--neon2);margin-bottom:8px;">PROFILE CREATED ✓</div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">Copy the message below and send it to <strong style="color:var(--text);">${name}</strong> however you normally reach them.</p>
    <div id="ucpInviteText" style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px;font-size:13px;color:var(--text);line-height:1.6;white-space:pre-wrap;margin-bottom:16px;">${msg}</div>
    <div style="display:flex;gap:10px;">
      <button onclick="closeCreateUnclaimedProfile()" style="flex:1;background:none;border:1px solid var(--border);border-radius:10px;color:var(--muted);font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:1px;padding:12px;cursor:pointer;">DONE</button>
      <button onclick="copyInviteMessage()" id="ucpCopyBtn" style="flex:2;background:var(--neon2);border:none;border-radius:10px;color:#0a0a0f;font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:1px;padding:12px;cursor:pointer;font-weight:700;">COPY INVITE</button>
    </div>
  `;
}

function buildInviteMsg(name, email) {
  const emailLine = email ? `\n\nUse this email when you get there: ${email}` : '';
  return `Hey ${name}! I've built your artist profile on YesPleez and put you on the lineup 🎧\n\nGo to yespleez.pages.dev — you'll see a prompt to claim your profile. It'll be pre-filled with your details ready to go.${emailLine}\n\nSee you on the lineup! 🎶`;
}

function copyInviteMessage() {
  const text = document.getElementById('ucpInviteText')?.textContent || '';
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('ucpCopyBtn');
    if (btn) { btn.textContent = 'COPIED ✓'; btn.style.background = 'var(--gold)'; }
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    const btn = document.getElementById('ucpCopyBtn');
    if (btn) { btn.textContent = 'COPIED ✓'; btn.style.background = 'var(--gold)'; }
  });
}

function copyUnclaimedInvite(id, btn) {
  const data = window._ucpInviteData?.[id];
  if (!data) return;
  const text = buildInviteMsg(data.name, data.email);
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'COPIED ✓'; btn.style.background = 'var(--gold)'; btn.style.color = '#0a0a0f';
    setTimeout(() => { btn.textContent = 'COPY INVITE'; btn.style.background = ''; btn.style.color = ''; }, 2500);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent = 'COPIED ✓';
    setTimeout(() => { btn.textContent = 'COPY INVITE'; }, 2500);
  });
}

async function loadUnclaimedProfiles() {
  const list = document.getElementById('unclaimedProfilesList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">Loading...</div>';
  try {
    const rows = await sbRest(
      `unclaimed_profiles?created_by=eq.${currentUser.id}&order=created_at.desc`,
      { method: 'GET' },
      currentSession.access_token
    );
    if (!rows.length) {
      list.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:12px 0;">No profiles created yet.</div>';
      return;
    }
    // Store invite data for copy buttons to access
    window._ucpInviteData = {};
    rows.forEach(r => { window._ucpInviteData[r.id] = { name: r.name, email: r.claim_email || '' }; });
    list.innerHTML = rows.map(r => `
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;">
          <div style="min-width:0;">
            <div style="font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:1px;">${r.name}</div>
            ${r.sound ? `<div style="font-size:12px;color:var(--neon2);margin-top:2px;">${r.sound}</div>` : ''}
            ${r.claim_email ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">✉ ${r.claim_email}</div>` : '<div style="font-size:11px;color:var(--muted);margin-top:4px;">No email set</div>'}
          </div>
          <button onclick="deleteUnclaimedProfile('${r.id}')" style="background:none;border:1px solid rgba(255,45,120,.3);border-radius:8px;color:var(--neon);font-size:11px;padding:4px 10px;cursor:pointer;white-space:nowrap;flex-shrink:0;">Remove</button>
        </div>
        <button onclick="copyUnclaimedInvite('${r.id}', this)" style="width:100%;background:rgba(0,229,255,.08);border:1px solid rgba(0,229,255,.25);border-radius:8px;color:var(--neon2);font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:1px;padding:8px;cursor:pointer;">COPY INVITE</button>
      </div>
    `).join('');
  } catch(e) {
    list.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:12px 0;">Could not load profiles.</div>';
  }
}

async function deleteUnclaimedProfile(id) {
  if (!confirm('Remove this unclaimed profile?')) return;
  try {
    await sbRest(`unclaimed_profiles?id=eq.${id}`, { method: 'DELETE' }, currentSession.access_token);
    showToast('Profile removed.', 'success');
    loadUnclaimedProfiles();
  } catch(e) {
    showToast('Could not remove: ' + e.message, 'error');
  }
}

// Called on artist dashboard load — checks if email matches an unclaimed profile
async function checkForClaimableProfile() {
  if (!currentSession?.access_token || !currentUser?.email) return;
  const email = currentUser.email.toLowerCase();
  try {
    const rows = await sbRest(
      `unclaimed_profiles?claim_email=eq.${encodeURIComponent(email)}&limit=1`,
      { method: 'GET' },
      currentSession.access_token
    );
    if (rows && rows.length) {
      const profile = rows[0];
      window._pendingClaimId = profile.id;
      const banner = document.getElementById('claimProfileBanner');
      const nameEl = document.getElementById('claimProfileBannerName');
      if (banner && nameEl) {
        nameEl.textContent = `"${profile.name}"${profile.sound ? ' — ' + profile.sound : ''}`;
        banner.style.display = 'block';
      }
    }
  } catch(e) { /* silent */ }
}

async function claimUnclaimedProfile(id) {
  if (!id) return;
  const btn = document.getElementById('claimProfileBannerBtn');
  if (btn) { btn.textContent = 'CLAIMING...'; btn.disabled = true; }
  try {
    const rows = await sbRest(
      `unclaimed_profiles?id=eq.${id}`,
      { method: 'GET' },
      currentSession.access_token
    );
    if (!rows || !rows.length) { showToast('Profile not found.', 'error'); return; }
    const p = rows[0];
    // Upsert into profiles
    const payload = {
      user_id:      currentUser.id,
      type:         'artist',
      dj_name:      p.name,
      name:         p.name,
      sound:        p.sound || '',
      bio:          p.bio || '',
      genre_string: p.genre_string || '',
      card_pills:   p.card_pills || '',
      mix_link:     p.mix_link || '',
      updated_at:   new Date().toISOString()
    };
    await sbRest('profiles', {
      method: 'POST',
      body: JSON.stringify(payload),
      prefer: 'resolution=merge-duplicates,return=minimal'
    }, currentSession.access_token);
    // Delete unclaimed record
    await sbRest(`unclaimed_profiles?id=eq.${id}`, { method: 'DELETE' }, currentSession.access_token);
    window._pendingClaimId = null;
    document.getElementById('claimProfileBanner').style.display = 'none';
    showToast(`Profile claimed! Welcome, ${p.name} 🎧`, 'success');
    // Reload artist profile
    if (typeof loadArtistProfile === 'function') loadArtistProfile();
  } catch(e) {
    showToast('Could not claim: ' + e.message, 'error');
  } finally {
    if (btn) { btn.textContent = 'CLAIM MY PROFILE →'; btn.disabled = false; }
  }
}
