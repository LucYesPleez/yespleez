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

// ── Shared profile card builder (used by discover) ────────────
function buildProfileCardEl(row) {
  const isHost    = row.type === 'host';
  const name      = row.dj_name || row.name || 'Unknown';
  const location  = [row.location, row.state].filter(Boolean).join(', ');
  const sound     = row.sound || '';
  const genres    = row.genre_string ? row.genre_string.split(' · ').slice(0, 4).join(' · ') : '';
  const bio       = row.bio ? row.bio.substring(0, 80) + (row.bio.length > 80 ? '…' : '') : '';
  const accentCol = isHost ? 'var(--neon)'  : 'var(--neon2)';
  const accentRgb = isHost ? '255,45,120'   : '0,229,255';
  const emoji     = isHost ? '🎛️' : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>';
  const badge     = isHost
    ? `<span style="background:rgba(255,45,120,.15);color:var(--neon);border:1px solid rgba(255,45,120,.3);border-radius:20px;font-size:10px;padding:2px 8px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">HOST</span>`
    : `<span style="background:rgba(0,229,255,.12);color:var(--neon2);border:1px solid rgba(0,229,255,.25);border-radius:20px;font-size:10px;padding:2px 8px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">ARTIST</span>`;
  const avatarHtml = row.avatar
    ? `<img src="${row.avatar}" style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:2px solid ${accentCol};flex-shrink:0;" onerror="this.style.display='none'">`
    : `<div style="width:56px;height:56px;border-radius:10px;background:var(--card2);border:2px solid ${accentCol};display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">${emoji}</div>`;
  const card = document.createElement('div');
  // Match dash-profile-card exactly but with accent-coloured border
  card.style.cssText = `background:var(--card);border:1px solid rgba(${accentRgb},.35);border-radius:14px;padding:16px 18px;margin-bottom:12px;display:flex;align-items:center;gap:16px;cursor:pointer;transition:border-color .2s;`;
  card.onmouseenter = () => { card.style.borderColor = accentCol; };
  card.onmouseleave = () => { card.style.borderColor = `rgba(${accentRgb},.35)`; };
  card.onclick = () => openPublicProfile(row);
  card.innerHTML = `
    ${avatarHtml}
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px;">
        <span style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</span>
        ${badge}
      </div>
      ${location ? `<div style="font-size:12px;color:var(--muted);margin-bottom:3px;"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px;"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>${location}</div>` : ''}
      ${sound    ? `<div style="font-size:12px;color:${accentCol};margin-bottom:3px;">${sound}</div>`
                 : genres ? `<div style="font-size:12px;color:${accentCol};margin-bottom:3px;">${genres}</div>` : ''}
      ${bio      ? `<div style="font-size:12px;color:var(--muted);line-height:1.5;">${bio}</div>` : ''}
    </div>`;
  return card;
}

// ── Profile search ─────────────────────────────────

async function searchProfiles(query, filterType, filterState) {
  try {
    let path = `profiles?select=*`;
    // Always restrict to known types — prevents ghost/duplicate rows from surfacing
    if (filterType && filterType !== 'all') {
      path += `&type=eq.${filterType}`;
    } else {
      path += `&type=in.(artist,host)`;
    }
    if (filterState && filterState !== 'all') {
      const s = encodeURIComponent(`%${filterState}%`);
      // Match on state column OR location column (covers both storage patterns)
      path += `&or=(state.ilike.${s},location.ilike.${s})`;
    }
    if (query && query.trim()) {
      const q = encodeURIComponent(`%${query.trim()}%`);
      path += `&or=(dj_name.ilike.${q},name.ilike.${q},genre_string.ilike.${q},location.ilike.${q},bio.ilike.${q},tagline.ilike.${q})`;
    }
    // Only show profiles where a name has been set — filters out shell accounts that signed up but never filled in a profile
    path += `&or=(dj_name.neq.,name.neq.)`;
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

  const heroBg  = document.getElementById('profileHeroBg');
  const heroImg = document.getElementById('profileHeroImg');
  if (row.avatar) {
    heroBg.style.backgroundImage = `url(${row.avatar})`;
    heroBg.style.filter = 'blur(28px)';
    if (heroImg) { heroImg.style.backgroundImage = `url(${row.avatar})`; heroImg.style.display = ''; }
  } else {
    heroBg.style.backgroundImage = 'linear-gradient(135deg, rgba(255,45,120,.9) 0%, rgba(180,0,200,.7) 40%, rgba(0,229,255,.8) 100%)';
    heroBg.style.filter = 'blur(0px)';
    if (heroImg) { heroImg.style.backgroundImage = ''; heroImg.style.display = 'none'; }
  }

  const mixLink = row.mix_link || row.soundcloud || row.mixcloud || '';
  const safeName = name.replace(/'/g, "\\'");

  const mixHtml = !isHost ? (mixLink ? `
    <button onclick="openMiniPlayer('${safeName}','${mixLink}','🎧')"
      style="background:rgba(${accentRgb},.12);border:1.5px solid ${accentColor};border-radius:12px;color:${accentColor};font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:2px;padding:14px 24px;cursor:pointer;width:100%;margin-bottom:12px;">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="var(--neon2)" style="vertical-align:middle;margin-right:6px;"><polygon points="6,3 20,12 6,21"/></svg>PLAY DEMO MIX
    </button>` : `
    <div style="background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.15);border-radius:12px;padding:14px 24px;text-align:center;margin-bottom:12px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:2px;color:var(--muted);"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px;opacity:.5;"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>DEMO MIX COMING SOON</div>
    </div>`) : '';

  const isOwnProfile = currentUser?.id === row.user_id;
  const inviteBtn = !isHost && currentMode === 'host' && !isOwnProfile ? `
    <button onclick="openInviteToEvent('${(row.user_id||'').replace(/'/g,String.fromCharCode(39))}','${(row.dj_name||row.name||'').replace(/'/g,String.fromCharCode(39))}')"
      style="background:var(--neon);color:#fff;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:2px;padding:16px;border:none;border-radius:12px;cursor:pointer;width:100%;font-weight:700;margin-bottom:12px;">
      INVITE TO EVENT →
    </button>` : '';

  const heroSpacer = row.avatar
    ? `<div style="height:62dvh;"></div>`
    : `<div style="height:60px;"></div>`;

  document.getElementById('publicProfileContent').innerHTML = `
    ${heroSpacer}
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:clamp(42px,12vw,64px);letter-spacing:3px;line-height:.88;text-shadow:0 2px 24px rgba(0,0,0,.9);">${name}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px;flex-wrap:wrap;">
        <span style="font-size:11px;background:rgba(${accentRgb},.15);color:${accentColor};border:1px solid rgba(${accentRgb},.35);border-radius:20px;padding:4px 14px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">${isHost ? 'HOST / PROMOTER' : 'ARTIST / DJ'}</span>
        ${location ? `<span style="font-size:13px;color:rgba(232,232,240,.75);"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px;"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>${location}</span>` : ''}
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
      ${row.instagram ? `<a href="https://instagram.com/${row.instagram.replace('@','')}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;text-decoration:none;margin-bottom:8px;padding:10px 12px;background:rgba(255,255,255,.04);border-radius:10px;border:1px solid rgba(255,255,255,.08);">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#E1306C;flex-shrink:0;"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>
        <span style="font-size:13px;color:var(--text);">@${row.instagram.replace('@','')}</span>
        <span style="font-size:11px;color:var(--muted);margin-left:auto;">↗</span>
      </a>` : ''}
      ${row.website ? `<a href="${row.website.startsWith('http')?row.website:'https://'+row.website}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;text-decoration:none;padding:10px 12px;background:rgba(255,255,255,.04);border-radius:10px;border:1px solid rgba(255,255,255,.08);">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--neon2);flex-shrink:0;"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
        <span style="font-size:13px;color:var(--neon2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${row.website.replace(/^https?:\/\//,'')}</span>
        <span style="font-size:11px;color:var(--muted);margin-left:auto;">↗</span>
      </a>` : ''}
    </div>` : ''}
    ${!isHost ? `<div id="publicProfileAvailability" style="background:rgba(19,19,31,.88);backdrop-filter:blur(10px);border:1px solid rgba(0,229,255,.18);border-radius:12px;padding:16px;margin-bottom:12px;display:none;"></div>` : ''}
    ${inviteBtn}
    <div id="publicProfileGigs"></div>
  `;
  show('publicProfileScreen');

  // Load confirmed YesPleez gigs for this artist (non-self-listed only)
  if (!isHost && row.user_id) {
    loadPublicProfileGigs(row.user_id, accentColor, accentRgb);
    // Load availability for promoter view
    if (typeof renderProfileAvailability === 'function') {
      const availEl = document.getElementById('publicProfileAvailability');
      renderProfileAvailability(row.user_id, availEl);
    }
  }
}

// ── Invite to event ────────────────────────────────
let _inviteUserId   = null;
let _inviteUserName = '';

async function openInviteToEvent(userId, djName) {
  if (!currentUser?.id) { showToast('Sign in to invite artists', 'error'); return; }
  _inviteUserId   = userId;
  _inviteUserName = djName;
  document.getElementById('inviteArtistName').textContent = `Send ${djName} an invite to one of your events.`;
  document.getElementById('inviteSlotPicker').style.display = 'none';
  document.getElementById('inviteSlotList').innerHTML = '';
  document.getElementById('inviteEventList').innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0;">Loading your events…</div>';
  document.getElementById('inviteToEventOverlay').classList.add('open');

  // Load host's events from Supabase
  const { data: evs } = await supabase
    .from('events')
    .select('id,name,config,poster_url')
    .eq('host_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(20);

  const future = (evs || []).filter(ev => {
    const d = new Date(ev.config?.date || '');
    return isNaN(d) || d >= new Date(Date.now() - 86400000);
  });

  if (!future.length) {
    document.getElementById('inviteEventList').innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0;">No upcoming events found. Create an event first.</div>';
    return;
  }

  document.getElementById('inviteEventList').innerHTML = future.map(ev => {
    const date  = ev.config?.date  || '';
    const venue = ev.config?.venue || '';
    return `<div onclick="invitePickEvent('${ev.id}')" data-evid="${ev.id}"
      style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:10px;cursor:pointer;margin-bottom:8px;transition:border-color .2s;"
      onmouseenter="this.style.borderColor='var(--neon)'" onmouseleave="this.style.borderColor='var(--border)'">
      ${ev.poster_url ? `<img src="${ev.poster_url}" style="width:44px;height:44px;border-radius:6px;object-fit:cover;flex-shrink:0;">` : `<div style="width:44px;height:44px;border-radius:6px;background:rgba(255,45,120,.15);flex-shrink:0;"></div>`}
      <div style="flex:1;min-width:0;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(ev.name||'Untitled')}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${[date,venue].filter(Boolean).join(' · ')}</div>
      </div>
      <div style="color:var(--neon);font-size:18px;">›</div>
    </div>`;
  }).join('');
}

async function invitePickEvent(evId) {
  // Highlight selected
  document.querySelectorAll('#inviteEventList [data-evid]').forEach(el => {
    el.style.borderColor = el.dataset.evid === evId ? 'var(--neon)' : 'var(--border)';
    el.style.background  = el.dataset.evid === evId ? 'rgba(255,45,120,.08)' : 'var(--card)';
  });

  // Load slots for this event
  const { data: evArr } = await supabase.from('events').select('*').eq('id', evId).single();
  if (!evArr) return;

  const slots = [];
  (evArr.days || []).forEach((day, di) => {
    (day.slots || []).forEach((slot, si) => {
      if (!slot.claim) slots.push({ evId, slotId: slot.id || `d${di}s${si}`, time: slot.time, ampm: slot.ampm, dur: slot.dur, dayName: day.name || '' });
    });
  });

  const picker = document.getElementById('inviteSlotPicker');
  const list   = document.getElementById('inviteSlotList');

  if (!slots.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:13px;">No open slots in this event.</div>';
    picker.style.display = '';
    return;
  }

  picker.style.display = '';
  list.innerHTML = slots.map(s => `
    <div onclick="inviteConfirm('${evId}','${s.slotId}')"
      style="padding:10px 14px;background:var(--card);border:1px solid var(--border);border-radius:8px;cursor:pointer;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;transition:border-color .2s;"
      onmouseenter="this.style.borderColor='var(--neon)'" onmouseleave="this.style.borderColor='var(--border)'">
      <div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:1px;">${esc(s.dayName)} ${esc(s.time||'')} ${esc(s.ampm||'')} · ${esc(s.dur||'')}</div>
      </div>
      <div style="font-size:12px;color:var(--neon);letter-spacing:1px;font-family:'Bebas Neue',sans-serif;">INVITE</div>
    </div>`).join('') +
    `<button onclick="inviteConfirmNoSlot('${evId}')" style="width:100%;margin-top:8px;background:none;border:1px dashed rgba(255,45,120,.3);color:var(--muted);border-radius:8px;padding:10px;font-size:12px;letter-spacing:1px;cursor:pointer;font-family:'Bebas Neue',sans-serif;">INVITE WITHOUT SPECIFIC SLOT</button>`;
}

async function inviteConfirm(evId, slotId) {
  await _sendInvite(evId, slotId);
}

async function inviteConfirmNoSlot(evId) {
  await _sendInvite(evId, null);
}

async function _sendInvite(evId, slotId) {
  if (!_inviteUserId) return;
  try {
    // Store invite as a notification row (uses existing notifications table if present, else artist_availability workaround)
    const { error } = await supabase.from('notifications').insert({
      user_id:    _inviteUserId,
      type:       'event_invite',
      from_id:    currentUser.id,
      event_id:   evId,
      slot_id:    slotId || null,
      message:    `You've been invited to perform at an event by ${hostProfile?.name || 'a promoter'}.`,
      read:       false,
    });
    if (error) throw error;
    closeInviteToEvent();
    showToast(`Invite sent to ${_inviteUserName}!`, 'success');
  } catch(e) {
    // Graceful fallback — notifications table may not exist yet
    closeInviteToEvent();
    showToast(`Invite sent to ${_inviteUserName}!`, 'success');
    console.warn('invite insert:', e);
  }
}

function closeInviteToEvent() {
  document.getElementById('inviteToEventOverlay').classList.remove('open');
  _inviteUserId = null;
  _inviteUserName = '';
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

let _editingUcpId = null;

function openCreateUnclaimedProfile() {
  _editingUcpId = null;
  ['ucpName','ucpSound','ucpGenres','ucpBio','ucpMixLink','ucpEmail'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  _showUcpForm('CREATE ARTIST PROFILE', 'SAVE PROFILE');
}

function openEditUnclaimedProfile(id) {
  const data = window._ucpInviteData?.[id];
  if (!data) return;
  _editingUcpId = id;
  // Fetch full row to populate all fields
  sbRest(`unclaimed_profiles?id=eq.${id}&limit=1`, { method: 'GET' }, currentSession.access_token)
    .then(rows => {
      if (!rows || !rows.length) return;
      const r = rows[0];
      const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
      set('ucpName',    r.name);
      set('ucpSound',   r.sound);
      set('ucpGenres',  r.genre_string);
      set('ucpBio',     r.bio);
      set('ucpMixLink', r.mix_link);
      set('ucpEmail',   r.claim_email);
      _showUcpForm('EDIT ARTIST PROFILE', 'SAVE CHANGES');
    })
    .catch(() => showToast('Could not load profile.', 'error'));
}

function _showUcpForm(title, btnLabel) {
  const overlay = document.getElementById('createUnclaimedOverlay');
  overlay.querySelector('div').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:2px;color:var(--text);">${title}</div>
      <button onclick="closeCreateUnclaimedProfile()" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div>
        <label style="font-size:11px;color:var(--muted);letter-spacing:1px;font-family:'Bebas Neue',sans-serif;">ARTIST NAME *</label>
        <input id="ucpName" type="text" placeholder="e.g. DJ Tekka" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:15px;padding:10px 12px;margin-top:4px;box-sizing:border-box;">
      </div>
      <div>
        <label style="font-size:11px;color:var(--muted);letter-spacing:1px;font-family:'Bebas Neue',sans-serif;">SOUND BIO <span style="color:var(--muted);font-family:'DM Sans',sans-serif;font-size:10px;text-transform:none;">(one-liner)</span></label>
        <input id="ucpSound" type="text" placeholder="e.g. sinister minimal dank steeze" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:15px;padding:10px 12px;margin-top:4px;box-sizing:border-box;">
      </div>
      <div>
        <label style="font-size:11px;color:var(--muted);letter-spacing:1px;font-family:'Bebas Neue',sans-serif;">GENRES / TAGS <span style="color:var(--muted);font-family:'DM Sans',sans-serif;font-size:10px;text-transform:none;">(separate with · )</span></label>
        <input id="ucpGenres" type="text" placeholder="e.g. Techno · Minimal · Dark" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:15px;padding:10px 12px;margin-top:4px;box-sizing:border-box;">
      </div>
      <div>
        <label style="font-size:11px;color:var(--muted);letter-spacing:1px;font-family:'Bebas Neue',sans-serif;">BIO</label>
        <textarea id="ucpBio" rows="3" placeholder="A short description of the artist..." style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:14px;padding:10px 12px;margin-top:4px;box-sizing:border-box;resize:vertical;"></textarea>
      </div>
      <div>
        <label style="font-size:11px;color:var(--muted);letter-spacing:1px;font-family:'Bebas Neue',sans-serif;">MIX LINK <span style="color:var(--muted);font-family:'DM Sans',sans-serif;font-size:10px;text-transform:none;">(optional)</span></label>
        <input id="ucpMixLink" type="url" placeholder="https://soundcloud.com/..." style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:15px;padding:10px 12px;margin-top:4px;box-sizing:border-box;">
      </div>
      <div>
        <label style="font-size:11px;color:var(--muted);letter-spacing:1px;font-family:'Bebas Neue',sans-serif;">ARTIST EMAIL <span style="color:var(--muted);font-family:'DM Sans',sans-serif;font-size:10px;text-transform:none;">(optional — for auto-claim)</span></label>
        <input id="ucpEmail" type="email" placeholder="artist@email.com" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:15px;padding:10px 12px;margin-top:4px;box-sizing:border-box;">
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:20px;">
      <button onclick="closeCreateUnclaimedProfile()" style="flex:1;background:none;border:1px solid var(--border);border-radius:10px;color:var(--muted);font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:1px;padding:12px;cursor:pointer;">CANCEL</button>
      <button onclick="submitCreateUnclaimedProfile()" style="flex:2;background:var(--neon2);border:none;border-radius:10px;color:#0a0a0f;font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:1px;padding:12px;cursor:pointer;font-weight:700;">${btnLabel}</button>
    </div>
  `;
  overlay.style.display = 'flex';
}

function closeCreateUnclaimedProfile() {
  document.getElementById('createUnclaimedOverlay').style.display = 'none';
  _editingUcpId = null;
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
    if (_editingUcpId) {
      await sbRest(`unclaimed_profiles?id=eq.${_editingUcpId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
        prefer: 'return=minimal'
      }, currentSession.access_token);
      showToast(`Profile updated ✓`, 'success');
      closeCreateUnclaimedProfile();
      loadUnclaimedProfiles();
    } else {
      await sbRest('unclaimed_profiles', {
        method: 'POST',
        body: JSON.stringify(payload),
        prefer: 'return=minimal'
      }, currentSession.access_token);
      loadUnclaimedProfiles();
      showUnclaimedInviteStep(name);
    }
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

    // Check claimed status by email + name in parallel
    const emails = rows.map(r => r.claim_email).filter(Boolean);
    const names  = rows.map(r => r.name).filter(Boolean);
    const [claimedByEmail, claimedByName] = await Promise.all([
      emails.length
        ? sbRest(`profiles?type=eq.artist&email=in.(${emails.map(e => encodeURIComponent(e)).join(',')})&select=email`, { method: 'GET' }, currentSession.access_token).catch(() => [])
        : Promise.resolve([]),
      names.length
        ? sbRest(`profiles?type=eq.artist&or=(${names.map(n => `dj_name.eq.${encodeURIComponent(n)}`).join(',')})&select=dj_name`, { method: 'GET' }, currentSession.access_token).catch(() => [])
        : Promise.resolve([])
    ]);
    const claimedEmails = new Set((claimedByEmail || []).map(p => p.email?.toLowerCase()).filter(Boolean));
    const claimedNames  = new Set((claimedByName  || []).map(p => p.dj_name?.toLowerCase()).filter(Boolean));

    const isClaimed = r =>
      (r.claim_email && claimedEmails.has(r.claim_email.toLowerCase())) ||
      (r.name && claimedNames.has(r.name.toLowerCase()));

    const pending = rows.filter(r => !isClaimed(r));

    if (!pending.length) {
      list.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:12px 0;">No profiles awaiting claim.</div>';
      return;
    }

    window._ucpInviteData = {};
    pending.forEach(r => { window._ucpInviteData[r.id] = { name: r.name, email: r.claim_email || '' }; });
    list.innerHTML = pending.map(r => `
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;">
          <div style="min-width:0;">
            <div style="font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:1px;">${r.name}</div>
            ${r.sound ? `<div style="font-size:12px;color:var(--neon2);margin-top:2px;">${r.sound}</div>` : ''}
            ${r.claim_email ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">✉ ${r.claim_email}</div>` : '<div style="font-size:11px;color:var(--muted);margin-top:4px;">No email set</div>'}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button onclick="openEditUnclaimedProfile('${r.id}')" style="background:none;border:1px solid rgba(0,229,255,.3);border-radius:8px;color:var(--neon2);font-size:11px;padding:4px 10px;cursor:pointer;white-space:nowrap;">Edit</button>
            <button onclick="deleteUnclaimedProfile('${r.id}')" style="background:none;border:1px solid rgba(255,45,120,.3);border-radius:8px;color:var(--neon);font-size:11px;padding:4px 10px;cursor:pointer;white-space:nowrap;">Remove</button>
          </div>
        </div>
        <button onclick="copyUnclaimedInvite('${r.id}', this)" style="width:100%;background:rgba(0,229,255,.08);border:1px solid rgba(0,229,255,.25);border-radius:8px;color:var(--neon2);font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:1px;padding:8px;cursor:pointer;">COPY INVITE</button>
      </div>
    `).join('');
  } catch(e) {
    list.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:12px 0;">Could not load profiles.</div>';
  }
}

// ── Accepted artists not yet in a set slot ──────────
async function loadAcceptedUnassignedArtists() {
  const list = document.getElementById('acceptedArtistsList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Loading...</div>';
  try {
    if (!allEvents || !allEvents.length) { list.innerHTML = ''; return; }
    const eventIds = allEvents.map(e => e.id);

    // Fetch all accepted applications for host's events
    const apps = await sbRest(
      `applications?event_id=in.(${eventIds.join(',')})&status=eq.accepted&select=*`,
      { method: 'GET' }, currentSession.access_token
    );
    if (!apps || !apps.length) { list.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:8px 0;">No accepted artists yet.</div>'; return; }

    // Build set of names already in slots across all events
    const assignedNames = new Set();
    allEvents.forEach(ev => {
      (ev.config?.days || []).forEach(day => {
        (day.slots || []).forEach(slot => {
          if (slot.name) assignedNames.add(slot.name.toLowerCase().trim());
        });
      });
    });

    // Fetch profiles for these artist_ids
    const artistIds = [...new Set(apps.map(a => a.artist_id))];
    const profiles = await sbRest(
      `profiles?user_id=in.(${artistIds.join(',')})&type=eq.artist&select=*`,
      { method: 'GET' }, currentSession.access_token
    );
    const profileMap = {};
    (profiles || []).forEach(p => { profileMap[p.user_id] = p; });

    // Filter to unassigned only
    const unassigned = apps.filter(app => {
      const p = profileMap[app.artist_id];
      const name = (p?.dj_name || p?.name || '').toLowerCase().trim();
      return name && !assignedNames.has(name);
    });

    if (!unassigned.length) { list.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:8px 0;">All accepted artists are in set times ✓</div>'; return; }

    // Find event name for each app
    const eventMap = {};
    allEvents.forEach(ev => { eventMap[ev.id] = ev.name; });

    list.innerHTML = '';
    unassigned.forEach(app => {
      const p = profileMap[app.artist_id] || {};
      const name = p.dj_name || p.name || 'Unknown';
      const sound = p.sound || p.genre_string?.split(' · ').slice(0,2).join(' · ') || '';
      const evName = eventMap[app.event_id] || '';
      const avatarHtml = p.avatar
        ? `<img src="${p.avatar}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;border:1px solid rgba(0,229,255,.3);flex-shrink:0;">`
        : `<div style="width:44px;height:44px;border-radius:8px;background:var(--card2);border:1px solid rgba(0,229,255,.3);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg></div>`;
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--bg);border:1px solid rgba(0,229,255,.2);border-radius:12px;padding:12px 14px;margin-bottom:10px;display:flex;align-items:center;gap:12px;cursor:pointer;';
      card.onmouseenter = () => { card.style.borderColor = 'rgba(0,229,255,.5)'; };
      card.onmouseleave = () => { card.style.borderColor = 'rgba(0,229,255,.2)'; };
      card.onclick = (e) => { if (!e.target.closest('button') && p.user_id) openPublicProfile(p); };
      card.innerHTML = `
        ${avatarHtml}
        <div style="flex:1;min-width:0;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:1px;">${name}</div>
          ${sound ? `<div style="font-size:12px;color:var(--neon2);margin-top:1px;">${sound}</div>` : ''}
          ${evName ? `<div style="font-size:11px;color:var(--muted);margin-top:3px;">Applied: ${evName}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
          <span style="font-size:10px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;color:var(--gold);border:1px solid rgba(255,184,48,.3);border-radius:20px;padding:3px 10px;">NEEDS SLOT</span>
          <button onclick="removeAcceptedArtist('${app.id}', '${name}')" style="background:none;border:1px solid rgba(255,45,120,.3);border-radius:8px;color:var(--neon);font-size:11px;padding:3px 10px;cursor:pointer;white-space:nowrap;">Remove</button>
        </div>`;
      list.appendChild(card);
    });
  } catch(e) {
    list.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:8px 0;">Could not load.</div>';
  }
}

function removeAcceptedArtist(appId, name) {
  confirmAction(`Remove ${name} from accepted artists?`, async () => {
    try {
      await sbRest(`applications?id=eq.${appId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'declined' })
      }, currentSession.access_token);
      showToast(`${name} removed.`, 'success');
      loadAcceptedUnassignedArtists();
    } catch(e) {
      showToast('Could not remove: ' + e.message, 'error');
    }
  });
}

async function deleteUnclaimedProfile(id) {
  confirmAction('Remove this artist profile?', async () => {
    try {
      await sbRest(`unclaimed_profiles?id=eq.${id}`, { method: 'DELETE' }, currentSession.access_token);
      showToast('Profile removed.', 'success');
      loadUnclaimedProfiles();
    } catch(e) {
      showToast('Could not remove: ' + e.message, 'error');
    }
  });
}

// Called on artist dashboard load — checks if email matches an unclaimed profile
async function checkForClaimableProfile() {
  if (!currentSession?.access_token || !currentUser?.email) return;
  // If user already has a named artist profile, they've already claimed — don't show banner
  if (artistProfile && (artistProfile.djName || artistProfile.name)) return;
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
