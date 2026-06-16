// ═══════════════════════════════════════════════════
//  profiles.js — YesPleez Profiles Module
//  Handles artist + host profile CRUD and public profile view
//  Depends on: state.js, auth.js (sbRest), navigation.js (show, showToast)
// ═══════════════════════════════════════════════════

// ── Open any profile by user_id (used from event set times) ───
async function openProfileByUserId(userId) {
  if (!userId) return;
  try {
    const rows = await sbRest(
      `profiles?user_id=eq.${userId}&limit=1`,
      { method: 'GET' }, currentSession?.access_token || null
    );
    if (rows && rows.length) { openPublicProfile(rows[0]); }
    else { showToast('No profile found', 'error'); }
  } catch(e) { showToast('Could not load profile', 'error'); }
}

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
      postcode:          profile.postcode      || '',
      lat:               profile.lat           || null,
      lng:               profile.lng           || null,
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
    postcode:           row.postcode      || '',
    lat:                row.lat           || null,
    lng:                row.lng           || null,
    years:              row.years         || '',
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
    postcode:    row.postcode     || '',
    lat:         row.lat          || null,
    lng:         row.lng          || null,
    years:       row.years        || '',
    tagline:     row.tagline      || '',
    sound:       row.sound        || '',
    bio:         row.bio          || '',
    instagram:   row.instagram    || '',
    facebook:    row.facebook     || '',
    website:     row.website      || '',
    email:       row.email        || '',
    genreString: row.genre_string || '',
    avatar:      row.avatar       || ''
  };
}

// ── Shared profile card builder (used by discover) ────────────
function buildProfileCardEl(row) {
  const type      = row.type || 'artist';
  const name      = row.dj_name || row.name || 'Unknown';
  const location  = [row.location, row.state].filter(Boolean).join(', ');
  const sound     = row.sound || '';
  const genres    = row.genre_string ? row.genre_string.split(' · ').slice(0, 4).join(' · ') : '';
  const bio       = row.bio ? row.bio.substring(0, 80) + (row.bio.length > 80 ? '…' : '') : '';
  const typeStyles = {
    host:    { col: '#FF3399',       rgb: '255,51,153',  label: 'HOST',    emoji: '🎛️' },
    artist:  { col: 'var(--neon2)',  rgb: '0,229,255',   label: 'ARTIST',  emoji: '🎧' },
    band:    { col: '#FF8C42',       rgb: '255,140,66',  label: 'BAND',    emoji: '🎸' },
    standup: { col: '#FF88AA',       rgb: '255,136,170', label: 'STANDUP', emoji: '🎤' },
    venue:   { col: '#00E5A0',       rgb: '0,229,160',   label: 'VENUE',   emoji: '📍' },
  };
  const ts        = typeStyles[type] || typeStyles.artist;
  const accentCol = ts.col;
  const accentRgb = ts.rgb;
  const emoji     = ts.emoji;
  const badge     = `<span style="background:rgba(${accentRgb},.15);color:${accentCol};border:1px solid rgba(${accentRgb},.3);border-radius:20px;font-size:10px;padding:2px 8px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">${ts.label}</span>`;
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
      path += `&type=in.(artist,host,band,standup,venue)`;
    }
    if (filterState) {
      const s = encodeURIComponent(`%${filterState}%`);
      // Match on state column OR location column (covers both storage patterns)
      path += `&or=(state.ilike.${s},location.ilike.${s})`;
    }
    if (query && query.trim()) {
      const q = encodeURIComponent(`%${query.trim()}%`);
      path += `&or=(dj_name.ilike.${q},name.ilike.${q},genre_string.ilike.${q},location.ilike.${q},bio.ilike.${q},tagline.ilike.${q},state.ilike.${q})`;
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
  _viewingProfile = {
    user_id:      row.user_id,      type:         row.type,
    dj_name:      row.dj_name,      name:         row.name,
    location:     row.location,     state:        row.state,     postcode: row.postcode, lat: row.lat, lng: row.lng,
    sound:        row.sound,        tagline:      row.tagline,
    bio:          row.bio,          genre_string: row.genre_string,
    band_type:    row.band_type,    act_type:     row.act_type,
    venue_type:   row.venue_type,   experience:   row.experience,
    mix_link:     row.mix_link,     soundcloud:   row.soundcloud,
    instagram:    row.instagram,    youtube:      row.youtube,
    facebook:     row.facebook,     tiktok:       row.tiktok,
    website:      row.website,      avatar:       row.avatar,
    contact_email: row.contact_email,
  };
  // Wire up share button
  const shareBtn = document.getElementById('profileShareBtn');
  if (shareBtn && row.user_id && row.type) {
    shareBtn.style.display = 'flex';
    shareBtn.onclick = () => shareItem(row.type, row.user_id, row.dj_name || row.name || '');
  }

  const isHost  = row.type === 'host';
  const isVenue = row.type === 'venue';
  const name = row.dj_name || row.name || 'Unknown';
  const location = [row.location, row.state].filter(Boolean).join(', ');
  const genres = row.genre_string ? row.genre_string.split(' · ').filter(Boolean) : [];
  const mainGenre = genres;
  const subGenres = [];
  const typeAccents = {
    host:    { color: '#FF3399',      rgb: '255,51,153',  label: 'HOST / PROMOTER',        grad2: '#BF5FFF' },
    artist:  { color: 'var(--neon2)', rgb: '0,229,255',   label: 'ARTIST / DJ',            grad2: '#BF5FFF' },
    band:    { color: '#FF8C42',      rgb: '255,140,66',  label: row.band_type || 'BAND / MUSO',          grad2: '#FF5500' },
    standup: { color: '#FF88AA',      rgb: '255,136,170', label: row.act_type  || 'STAND-UP / COMEDY',    grad2: '#BF5FFF' },
    venue:   { color: '#00E5A0',      rgb: '0,229,160',   label: row.venue_type || 'VENUE', grad2: '#00E5FF' },
  };
  const ta = typeAccents[row.type] || typeAccents.artist;
  const accentColor = ta.color;
  const accentRgb   = ta.rgb;
  const typeLabel   = ta.label;
  const grad2       = ta.grad2;

  const heroBg  = document.getElementById('profileHeroBg');
  const heroImg = document.getElementById('profileHeroImg');
  if (row.avatar) {
    heroBg.style.backgroundImage = `url(${row.avatar})`;
    heroBg.style.filter = 'blur(28px)';
    if (heroImg) { heroImg.style.backgroundImage = `url(${row.avatar})`; heroImg.style.display = 'block'; }
  } else {
    heroBg.style.backgroundImage = 'linear-gradient(135deg, rgba(255,45,120,.9) 0%, rgba(180,0,200,.7) 40%, rgba(0,229,255,.8) 100%)';
    heroBg.style.filter = 'blur(0px)';
    if (heroImg) { heroImg.style.backgroundImage = ''; heroImg.style.display = 'none'; }
  }

  const mixLink = row.mix_link || row.soundcloud || row.mixcloud || '';
  const safeName = name.replace(/'/g, "\\'");

  // Seeded waveform — deterministic per artist name so same profile always shows the same shape
  const _wSeed = name.split('').reduce((a,c) => (a * 31 + c.charCodeAt(0)) | 0, 0x9e3779b9);
  let _wS = _wSeed; const _wRng = () => { _wS = (_wS ^ (_wS << 13)) | 0; _wS = (_wS ^ (_wS >>> 17)) | 0; _wS = (_wS ^ (_wS << 5)) | 0; return (_wS >>> 0) / 0xffffffff; };
  const _wN = 32, _wW = 300, _wH = 40, _bW = (_wW / _wN) * 0.55;
  const _wBars = Array.from({length: _wN}, (_,i) => { const h = 4 + _wRng() * (_wH - 8); const x = (i / _wN) * _wW + (_wW / _wN) * 0.225; const y = (_wH - h) / 2; return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${_bW.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"/>`; }).join('');
  const _waveSvg = `<svg viewBox="0 0 ${_wW} ${_wH}" preserveAspectRatio="none" style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:38%;height:100%;opacity:.32;mask-image:linear-gradient(to right,black 0%,transparent 35%,transparent 65%,black 100%);-webkit-mask-image:linear-gradient(to right,black 0%,transparent 35%,transparent 65%,black 100%);" fill="rgba(${accentRgb},1)">${_wBars}</svg>`;

  const mixHtml = !isHost && !isVenue ? (mixLink ? `
    <button onclick="openMiniPlayer('${safeName}','${mixLink}','🎧')"
      style="position:relative;overflow:hidden;background:rgba(${accentRgb},.12);border:1.5px solid ${accentColor};border-radius:12px;color:${accentColor};font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:2px;padding:14px 24px;cursor:pointer;width:100%;margin-bottom:12px;">
      ${_waveSvg}
      <span style="position:relative;z-index:1;"><svg viewBox="0 0 24 24" width="14" height="14" fill="var(--neon2)" style="vertical-align:middle;margin-right:6px;"><polygon points="6,3 20,12 6,21"/></svg>PLAY DEMO MIX</span>
    </button>` : `
    <div style="background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.15);border-radius:12px;padding:14px 24px;text-align:center;margin-bottom:12px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:2px;color:var(--muted);"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px;opacity:.5;"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>DEMO MIX COMING SOON</div>
    </div>`) : '';

  const isOwnProfile = currentUser?.id === row.user_id;
  const followBtn = !isOwnProfile && row.user_id && typeof buildFollowBtn === 'function'
    ? buildFollowBtn(row.user_id, row.type, name)
    : '';
  const inviteBtn = !isHost && !isVenue && currentMode === 'host' && !isOwnProfile ? `
    <button onclick="openInviteToEvent('${(row.user_id||'').replace(/'/g,String.fromCharCode(39))}','${(row.dj_name||row.name||'').replace(/'/g,String.fromCharCode(39))}')"
      style="background:var(--neon);color:#fff;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:2px;padding:16px;border:none;border-radius:12px;cursor:pointer;width:100%;font-weight:700;margin-bottom:12px;">
      INVITE TO EVENT →
    </button>` : '';
  const venueEnquireBtn = isVenue && !isOwnProfile && (row.contact_email || row.website || row.instagram) ? (() => {
    const contactTarget = row.contact_email
      ? `mailto:${row.contact_email}?subject=Venue%20Enquiry%20-%20${encodeURIComponent(name)}`
      : (row.website ? (row.website.startsWith('http') ? row.website : 'https://'+row.website) : `https://instagram.com/${(row.instagram||'').replace('@','')}`);
    return `<a href="${contactTarget}" target="_blank" rel="noopener"
      style="display:block;background:linear-gradient(135deg,#00E5A0,#00B4D8);color:#0a0a14;font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:2px;padding:16px;border:none;border-radius:12px;cursor:pointer;width:100%;font-weight:700;margin-bottom:12px;text-align:center;text-decoration:none;box-sizing:border-box;">
      📩 ENQUIRE / BOOK THIS VENUE
    </a>`;
  })() : '';

  const heroSpacer = row.avatar
    ? `<div style="height:62dvh;"></div>`
    : `<div style="height:60px;"></div>`;

  document.getElementById('publicProfileContent').innerHTML = `
    ${heroSpacer}
    <div style="text-align:center;margin-bottom:20px;position:relative;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:clamp(42px,12vw,64px);letter-spacing:3px;line-height:.88;text-shadow:0 2px 24px rgba(0,0,0,.9);">${name}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px;flex-wrap:wrap;">
        <span style="font-size:11px;background:rgba(${accentRgb},.15);color:${accentColor};border:1px solid rgba(${accentRgb},.35);border-radius:20px;padding:4px 14px;font-family:'Bebas Neue',sans-serif;letter-spacing:1px;">${typeLabel}</span>
        ${location ? `<span style="font-size:13px;color:rgba(232,232,240,.75);"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px;"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>${location}</span>` : ''}
      </div>
      ${row.years ? `<span style="position:absolute;bottom:0;right:0;font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:2px;color:#fff;">EST. ${row.years}</span>` : ''}
    </div>
    ${(() => { const _OLD_CATS = new Set(['ELECTRONIC','BANDS','SPOKEN','SPOKEN WORD','RAVE','FESTIVAL']); const _tl = (row.tagline||'').trim(); const _isOldCats = _tl.split(' · ').every(t => _OLD_CATS.has(t.trim().toUpperCase())); return _tl && !_isOldCats ? `<div style="text-align:center;font-size:18px;letter-spacing:1px;margin-bottom:14px;padding:0 8px;background:linear-gradient(135deg,${accentColor},${grad2});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-family:'Bebas Neue',sans-serif;">${_tl}</div>` : ''; })()}
    ${mixHtml}
    ${row.sound ? (() => { const ds = (typeof dedupeSound === 'function') ? dedupeSound(row.sound, row.genre_string || '') : row.sound; return ds ? `<div style="position:relative;background:rgba(19,19,31,.92);backdrop-filter:blur(12px);border-radius:14px;padding:18px 22px;margin-bottom:12px;text-align:center;overflow:hidden;">
      <div style="position:absolute;inset:0;border-radius:14px;padding:1px;background:linear-gradient(135deg,${accentColor},${grad2});-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;"></div>
      <div style="font-size:15px;color:#e8e8f0;font-style:italic;line-height:1.6;position:relative;z-index:1;">${ds}</div>
    </div>` : ''; })() : ''}
    ${mainGenre.length ? `
    <div style="position:relative;background:rgba(19,19,31,.88);backdrop-filter:blur(10px);border-radius:12px;padding:16px;margin-bottom:12px;overflow:hidden;cursor:${mainGenre.length>5?'pointer':'default'};" onclick="(function(el){const h=el.querySelector('.genre-hidden');if(h){h.style.display=h.style.display==='none'?'flex':'none';const btn=el.querySelector('.genre-more');if(btn)btn.style.display=h.style.display==='none'?'':'none';};})(this)">
      <div style="position:absolute;inset:0;border-radius:12px;padding:1px;background:linear-gradient(135deg,${accentColor},${grad2});-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;"></div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:2px;color:${accentColor};margin-bottom:8px;">GENRE</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${mainGenre.slice(0,5).map(g => `<span style="background:rgba(0,229,255,.08);border:1px solid rgba(0,229,255,.25);border-radius:20px;font-size:12px;padding:4px 12px;color:var(--neon2);">${g}</span>`).join('')}
        ${mainGenre.length > 5 ? `<span class="genre-more" style="background:rgba(0,229,255,.05);border:1px solid rgba(0,229,255,.15);border-radius:20px;font-size:12px;padding:4px 12px;color:var(--muted);cursor:pointer;">+${mainGenre.length-5} more</span>` : ''}
      </div>
      ${mainGenre.length > 5 ? `<div class="genre-hidden" style="display:none;flex-wrap:wrap;gap:6px;margin-top:6px;">${mainGenre.slice(5).map(g => `<span style="background:rgba(0,229,255,.08);border:1px solid rgba(0,229,255,.25);border-radius:20px;font-size:12px;padding:4px 12px;color:var(--neon2);">${g}</span>`).join('')}</div>` : ''}
    </div>` : ''}
    ${row.bio ? `
    <div style="position:relative;background:rgba(19,19,31,.88);backdrop-filter:blur(10px);border-radius:12px;padding:16px;margin-bottom:12px;overflow:hidden;">
      <div style="position:absolute;inset:0;border-radius:12px;padding:1px;background:linear-gradient(135deg,${accentColor},${grad2});-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;"></div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:2px;color:${accentColor};margin-bottom:8px;">ABOUT</div>
      <div style="font-size:14px;color:var(--muted);line-height:1.7;">${row.bio}</div>
    </div>` : ''}
    ${!isHost ? `<div id="publicProfileAvailability" style="position:relative;background:rgba(19,19,31,.88);backdrop-filter:blur(10px);border-radius:12px;padding:16px;margin-bottom:12px;overflow:hidden;display:none;"><div style="position:absolute;inset:0;border-radius:12px;padding:1px;background:linear-gradient(135deg,${accentColor},${grad2});-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;"></div></div>` : ''}
    ${venueEnquireBtn}
    ${followBtn}
    ${inviteBtn}
    ${isVenue ? `
    <div id="venuePublicEvents" style="margin-bottom:12px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:2px;color:#00E5A0;margin-bottom:10px;">UPCOMING EVENTS HERE</div>
      <div style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0;">Loading events…</div>
    </div>
    <button onclick="openVenueAvailabilityModal()" style="width:100%;background:rgba(0,229,160,.08);border:1.5px solid rgba(0,229,160,.35);color:#00E5A0;font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:2px;padding:14px;border-radius:12px;cursor:pointer;margin-bottom:12px;">📅 CHECK AVAILABILITY</button>
    ` : ''}
    <div id="publicProfileGigs"></div>
    ${(() => {
      const _socials = [
        row.instagram ? { href: `https://instagram.com/${row.instagram.replace('@','')}`, color: '#E1306C', svg: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>` } : null,
        row.facebook ? { href: row.facebook.startsWith('http')?row.facebook:'https://'+row.facebook, color: '#1877F2', svg: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>` } : null,
        row.youtube ? { href: row.youtube.startsWith('http')?row.youtube:'https://'+row.youtube, color: '#FF0000', svg: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/></svg>` } : null,
        row.soundcloud ? { href: row.soundcloud.startsWith('http')?row.soundcloud:'https://'+row.soundcloud, color: '#FF5500', svg: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 13.5A3.5 3.5 0 0 0 5.5 17h11a3 3 0 0 0 .5-5.965V11a5 5 0 0 0-9.3-2.5"/><path d="M5 11.5v1M7 10v3M9 9.5v4"/></svg>` } : null,
        row.mixcloud ? { href: row.mixcloud.startsWith('http')?row.mixcloud:'https://'+row.mixcloud, color: '#52aad8', svg: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>` } : null,
        row.website ? { href: row.website.startsWith('http')?row.website:'https://'+row.website, color: 'var(--neon2)', svg: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>` } : null,
      ].filter(Boolean);
      if (!_socials.length) return '';
      return `<div style="display:flex;justify-content:center;gap:16px;flex-wrap:wrap;padding:20px 0 8px;">
        ${_socials.map(s=>`<a href="${s.href}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;color:${s.color};text-decoration:none;opacity:.85;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.85'">${s.svg}</a>`).join('')}
      </div>`;
    })()}
  `;
  show('publicProfileScreen');

  if (isVenue && row.user_id) {
    if (typeof loadVenuePublicSections === 'function') {
      loadVenuePublicSections(row.user_id, name, accentColor, accentRgb, grad2, { email: row.contact_email, website: row.website, instagram: row.instagram });
    }
  } else if (!isHost && row.user_id) {
    loadPublicProfileGigs(row.user_id, accentColor, accentRgb, grad2);
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

async function loadPublicProfileGigs(userId, accentColor, accentRgb, grad2 = '#BF5FFF') {
  const container = document.getElementById('publicProfileGigs'); if (!container) return;
  try {
    const claimRows = await sbRest(
      `claims?user_id=eq.${userId}&select=slot_id,event_id`,
      { method: 'GET' }, currentSession?.access_token || null
    );
    console.log('[gigs] claims:', claimRows);
    if (!claimRows?.length) return;
    const eventIds = [...new Set(claimRows.map(c => c.event_id).filter(Boolean))];
    if (!eventIds.length) return;
    const today = new Date().toISOString().slice(0,10);
    const events = await sbRest(
      `events?id=in.(${eventIds.join(',')})&select=id,name,config&order=id.asc`,
      { method: 'GET' }, currentSession?.access_token || null
    );
    console.log('[gigs] events:', events);
    if (!events?.length) return;

    const upcoming = events;
    console.log('[gigs] upcoming:', upcoming.length, upcoming.map(e=>e.config?.date));

    container.innerHTML = `
      <div style="position:relative;background:rgba(19,19,31,.88);backdrop-filter:blur(10px);border-radius:12px;overflow:hidden;margin-bottom:12px;">
        <div style="position:absolute;inset:0;border-radius:12px;padding:1px;background:linear-gradient(135deg,${accentColor},${grad2});-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;"></div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:2px;color:${accentColor};padding:14px 16px 0;">UPCOMING GIGS</div>
        ${upcoming.map(ev => {
          if (typeof calListCard === 'function') return calListCard(ev);
          // Fallback card if calListCard not in scope
          const cfg = ev.config || {};
          const poster = cfg.poster || '';
          const bg = poster ? `url('${poster}') center/cover no-repeat` : `linear-gradient(135deg,rgba(255,45,120,.5),rgba(0,229,255,.3))`;
          const venue = cfg.venue || '';
          const dateStr = cfg.date || '';
          return `<div onclick="calOpenEvent && calOpenEvent('${ev.id}')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer;">
            <div style="width:60px;height:60px;border-radius:10px;background:${bg};flex-shrink:0;"></div>
            <div style="flex:1;min-width:0;">
              <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:.5px;line-height:1;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${ev.name||'EVENT'}</div>
              <div style="font-size:11px;color:var(--muted);">${[venue,dateStr].filter(Boolean).join(' · ')}</div>
            </div>
          </div>`;
        }).join('')}
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
  if (!currentSession?.access_token || !currentUser?.email || currentUser.id === 'guest') return;
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
