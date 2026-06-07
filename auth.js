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
  showRoleSelector();
}

// ── Signup ─────────────────────────────────────────

async function doSignup() {
  const email = document.getElementById('signupEmail').value.trim();
  const pass  = document.getElementById('signupPassword').value;
  const errEl = document.getElementById('signupErr');
  errEl.classList.remove('show');
  if (!email || !pass) { errEl.textContent='Please fill in both fields.'; errEl.classList.add('show'); return; }
  if (pass.length < 6)  { errEl.textContent='Password must be at least 6 characters.'; errEl.classList.add('show'); return; }
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
    showRoleSelector();
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
    if (s.refresh_token) {
      try {
        const res = await sbAuthPost('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
        if (res.access_token) {
          clearCachedProfiles();
          currentSession = res; currentUser = res.user;
          localStorage.setItem('yp_session', JSON.stringify(res));
          return true;
        }
      } catch {}
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${s.access_token}` }
      });
      if (res.ok) {
        const user = await res.json();
        if (user.id) {
          clearCachedProfiles();
          currentSession = s; currentUser = user;
          return true;
        }
      }
    } catch {}
  } catch {}
  localStorage.removeItem('yp_session');
  return false;
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
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/applications?event_id=in.(${ids})&status=eq.pending&select=id`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${currentSession.access_token}` } }
    );
    if (res.ok) {
      const rows = await res.json();
      const badge = document.getElementById('appsBadge');
      if (rows.length > 0) { badge.textContent = rows.length; badge.style.display = 'inline'; }
      else badge.style.display = 'none';
    }
  } catch(e) {}
}
