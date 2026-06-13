// ═══════════════════════════════════════════════════
//  auth.js — YesPleez Authentication Module
//  Depends on: SUPABASE_URL, SUPABASE_KEY (config.js)
//              currentUser, currentSession, allEvents (state.js)
//              show(), showToast() (navigation.js)
//              showRoleSelector() (navigation.js)
// ═══════════════════════════════════════════════════

// ── Supabase HTTP helpers ──────────────────────────

function sbHeaders(token) {
  const h = {
    'apikey': SUPABASE_KEY,
    'Content-Type': 'application/json',
  };
  if (token) h['Authorization'] = `Bearer ${token}`;
  else h['Authorization'] = `Bearer ${SUPABASE_KEY}`;
  return h;
}

async function sbAuthPost(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
    return res.json();
  } catch(e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') return { error: true, error_description: 'Request timed out — check your connection.' };
    return { error: true, error_description: 'Network error — check your connection.' };
  }
}

async function refreshSession() {
  const saved = localStorage.getItem('yp_session');
  if (!saved) return false;
  try {
    const s = JSON.parse(saved);
    if (!s.refresh_token) return false;
    const res = await sbAuthPost('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
    if (res.access_token) {
      currentSession = res;
      currentUser = res.user || currentUser;
      localStorage.setItem('yp_session', JSON.stringify(res));
      return true;
    }
  } catch {}
  return false;
}

async function sbRest(path, options = {}, token = null) {
  const makeReq = (t) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...sbHeaders(t),
      'Prefer': options.prefer || (options.method === 'POST' ? 'resolution=merge-duplicates,return=representation' : 'return=representation'),
      ...(options.headers || {})
    }
  });

  let res = await makeReq(token);

  // Auto-refresh on 401 (expired JWT) then retry once
  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await makeReq(token === null ? null : currentSession.access_token);
    } else {
      // Can't refresh — send user back to login
      currentUser = null; currentSession = null;
      localStorage.removeItem('yp_session');
      show('authScreen');
      throw new Error('Session expired — please sign in again.');
    }
  }

  if (res.status === 204 || res.status === 201) {
    try { return await res.json(); } catch { return []; }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Clear cached profiles (call on every login) ────

function clearCachedProfiles() {
  artistProfile = {};
  hostProfile   = {};
  if (typeof bandProfile    !== 'undefined') bandProfile    = {};
  if (typeof standupProfile !== 'undefined') standupProfile = {};
  if (typeof venueProfile   !== 'undefined') venueProfile   = {};
  localStorage.removeItem('yp_artist_profile');
  localStorage.removeItem('yp_host_profile');
}

// ── Auth tab UI ────────────────────────────────────

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) => t.classList.toggle('active', (i===0) === (tab==='login')));
  document.getElementById('loginForm').style.display  = tab === 'login'  ? '' : 'none';
  document.getElementById('signupForm').style.display = tab === 'signup' ? '' : 'none';
}

// ── Login ──────────────────────────────────────────

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginErr');
  errEl.classList.remove('show');
  if (!email || !pass) { errEl.textContent='Please fill in both fields.'; errEl.classList.add('show'); return; }
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'SIGNING IN...';
  const data = await sbAuthPost('token?grant_type=password', { email, password: pass });
  btn.disabled = false; btn.textContent = 'SIGN IN';
  if (data.error || !data.access_token) {
    errEl.textContent = data.error_description || data.msg || 'Invalid email or password.';
    errEl.classList.add('show'); return;
  }
  clearCachedProfiles();
  currentSession = data;
  currentUser = data.user;
  localStorage.setItem('yp_session', JSON.stringify(data));
  await checkPendingOffers(email, data.access_token);
  if (window._pendingSlotOffers?.length) {
    // Route artist straight to their dashboard so the notification bell is visible
    currentMode = 'artist';
    if (typeof enterArtistDashboard === 'function') {
      enterArtistDashboard().then(() => {
        setTimeout(() => { if (typeof flashPendingOffers === 'function') flashPendingOffers(); }, 1000);
      });
    } else {
      showCalendar();
      setTimeout(() => { if (typeof flashPendingOffers === 'function') flashPendingOffers(); }, 1000);
    }
    return;
  }
  if (typeof checkPostAuthAction === 'function') { checkPostAuthAction(); return; }
  // Show role selector on first 3 logins, then go straight to the scene
  const _seenRoles = parseInt(localStorage.getItem('yp_role_views') || '0');
  if (_seenRoles < 3) {
    localStorage.setItem('yp_role_views', _seenRoles + 1);
    showRoleSelector();
  } else {
    showCalendar();
  }
}

// ── Signup ─────────────────────────────────────────

async function doSignup() {
  const email   = document.getElementById('signupEmail').value.trim();
  const pass    = document.getElementById('signupPassword').value;
  const confirm = document.getElementById('signupPasswordConfirm').value;
  const errEl = document.getElementById('signupErr');
  errEl.classList.remove('show');
  if (!email || !pass) { errEl.textContent='Please fill in all fields.'; errEl.classList.add('show'); return; }
  if (pass.length < 6)  { errEl.textContent='Password must be at least 6 characters.'; errEl.classList.add('show'); return; }
  if (pass !== confirm) { errEl.textContent='Passwords do not match.'; errEl.classList.add('show'); return; }
  const btn = document.getElementById('signupBtn');
  btn.disabled = true; btn.textContent = 'CREATING...';
  const data = await sbAuthPost('signup', { email, password: pass });
  btn.disabled = false; btn.textContent = 'CREATE ACCOUNT';
  if (data.error || (!data.access_token && !data.id)) {
    errEl.textContent = data.msg || data.error_description || 'Signup failed — try again.';
    errEl.classList.add('show'); return;
  }
  if (data.access_token) {
    clearCachedProfiles();
    currentSession = data; currentUser = data.user;
    localStorage.setItem('yp_session', JSON.stringify(data));
    // Save email to profile row so slot offers can match by email
    sbRest('profiles', {
      method: 'POST',
      body: JSON.stringify({ user_id: data.user.id, email: email }),
      prefer: 'resolution=merge-duplicates,return=minimal'
    }, data.access_token).catch(() => {});
    await checkPendingOffers(email, data.access_token);
    if (window._pendingSlotOffers?.length) {
      currentMode = 'artist';
      if (typeof enterArtistDashboard === 'function') {
        enterArtistDashboard().then(() => {
          setTimeout(() => { if (typeof flashPendingOffers === 'function') flashPendingOffers(); }, 1000);
        });
      } else {
        showRoleSelector();
      }
    } else {
      showRoleSelector();
    }
  } else {
    showToast('✉️ Check your email to confirm your account, then sign in.', 'success');
    switchAuthTab('login');
  }
}

// ── Sign out ───────────────────────────────────────

async function doSignOut() {
  if (currentSession) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: sbHeaders(currentSession.access_token)
    }).catch(() => {});
  }
  currentUser = null; currentSession = null;
  localStorage.removeItem('yp_session');
  allEvents = []; currentEventId = null; eventData = null; isHost = false;
  clearCachedProfiles();
  if (pollTimer) clearInterval(pollTimer);
  show('authScreen');
}

// ── Session restore ────────────────────────────────

async function tryRestoreSession() {
  const saved = localStorage.getItem('yp_session');
  if (!saved) return false;
  try {
    const s = JSON.parse(saved);
    if (!s.access_token) return false;

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = s.expires_at || 0;

    // Token still fresh — use it directly, no network call needed
    if (expiresAt > now + 60) {
      currentSession = s; currentUser = s.user;
      return true;
    }

    // Token expired or expiring soon — attempt refresh
    if (s.refresh_token) {
      try {
        const res = await sbAuthPost('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
        if (res.access_token) {
          clearCachedProfiles();
          currentSession = res; currentUser = res.user;
          localStorage.setItem('yp_session', JSON.stringify(res));
          return true;
        }
        // Hard auth error (invalid/expired refresh token) — must re-login
        if (res.error || res.error_description) {
          localStorage.removeItem('yp_session');
          return false;
        }
      } catch {
        // Network failure — fall through and try the raw token
      }
    }

    // Last resort: validate the raw access_token (works if it hasn't expired yet)
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${s.access_token}` }
      });
      if (res.ok) {
        const user = await res.json();
        if (user.id) {
          currentSession = s; currentUser = user;
          return true;
        }
      }
    } catch {}

    // Network issue — keep the session in localStorage for next app open; don't force re-login
    return false;
  } catch {
    localStorage.removeItem('yp_session');
    return false;
  }
}

// ── Pending slot offers check (runs on login/signup) ──

async function checkPendingOffers(email, token) {
  if (!email || !token) return;
  try {
    const offers = await sbRest(
      `slot_offers?offered_to_email=eq.${encodeURIComponent(email)}&status=eq.pending&select=id,slot_id,event_id,slot_label,event_name,offered_by_name,offered_by_uid,offered_to_uid`,
      { method: 'GET' }, token
    );
    if (!offers || !offers.length) return;
    window._pendingSlotOffers = offers;

    // For offers that weren't linked to this user_id yet (offer was sent before they had a profile),
    // write the missing notification and link the uid so they can accept/decline from the bell.
    const userId = currentUser?.id;
    if (userId) {
      for (const o of offers) {
        if (!o.offered_to_uid) {
          // Link uid so future logins won't duplicate
          sbRest(`slot_offers?id=eq.${o.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ offered_to_uid: userId }),
            prefer: 'return=minimal'
          }, token).catch(() => {});

          // Write the notification that should have been sent at offer time
          if (typeof writeDbNotif === 'function') {
            const label = o.slot_label || 'a slot';
            const event = o.event_name || 'an event';
            const from  = o.offered_by_name || 'A host';
            writeDbNotif(userId, 'slot_offer',
              `${from} has offered you the ${label} slot at ${event}.`,
              { event_id: o.event_id, slot_id: o.slot_id, slot_label: o.slot_label,
                event_name: o.event_name, from_uid: o.offered_by_uid, from_name: from }
            ).catch(() => {});
          }
        }
      }
    }
  } catch(e) {
    // Table may not exist yet — silently ignore
  }
}

// Called from showRoleSelector / dashboard entry to surface pending offers
function flashPendingOffers() {
  const offers = window._pendingSlotOffers;
  if (!offers || !offers.length) return;
  window._pendingSlotOffers = null;
  offers.forEach(o => {
    const label = o.slot_label || 'a slot';
    const event = o.event_name || 'an event';
    showToast(`🎤 You've been offered ${label} at ${event} — check your slots!`, 'success', 6000);
  });
}

// ── Password reset ─────────────────────────────────

function showForgotPassword() {
  showToast('Password reset: use Supabase Auth or add your reset flow.', 'error');
}

// ── Pending applications badge ─────────────────────

async function loadPendingAppsBadge() {
  if (!allEvents.length) return;
  try {
    const ids = allEvents.map(e => e.id).join(',');
    const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${currentSession.access_token}` };

    const [pendingRes, acceptedRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/applications?event_id=in.(${ids})&status=eq.pending&select=id`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/applications?event_id=in.(${ids})&status=eq.accepted&select=id`, { headers })
    ]);

    if (pendingRes.ok) {
      const rows = await pendingRes.json();
      ['appsBadge','manageAppsBadge'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (rows.length > 0) { el.textContent = rows.length; el.style.display = 'inline'; }
        else el.style.display = 'none';
      });
    }

    if (acceptedRes.ok) {
      const rows = await acceptedRes.json();
      const prevCount = parseInt(sessionStorage.getItem('yp_accepted_apps') || '0');
      const newCount = rows.length;

      ['appsAcceptedBadge','manageAcceptedBadge'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (newCount > 0) { el.textContent = newCount; el.style.display = 'inline'; }
        else el.style.display = 'none';
      });

      // Trigger bell if count increased since last check
      if (newCount > prevCount) {
        pushNotif('✅', `${newCount - prevCount} artist${newCount - prevCount > 1 ? 's' : ''} accepted your invite`, 'host');
      }
      sessionStorage.setItem('yp_accepted_apps', newCount);
    }
  } catch(e) {}
}
