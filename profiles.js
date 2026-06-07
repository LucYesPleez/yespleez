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
  `;
  show('publicProfileScreen');
}
