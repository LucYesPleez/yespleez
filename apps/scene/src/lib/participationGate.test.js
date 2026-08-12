import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * THE PARTICIPATION GATE'S CONTRACT — source-level, per the codebase idiom.
 *
 * These lock the architectural facts a rendering test would not catch:
 * the gate stays SEPARATE from AccessRequiredScreen, guest hearts REQUEST
 * rather than return silently, an authenticated tap never touches the gate,
 * and public browsing is unchanged.
 *
 * ⚠ Anchored on CODE with comments stripped first — this repo has been
 * bitten three times by a source test matching the prose that EXPLAINS why
 * something is not done.
 */

const src = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const code = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/[^\n]*/g, '$1');

const GATE        = code(src('../components/ParticipationGate.jsx'));
const HEART       = code(src('../components/HeartBtn.jsx'));
const FOLLOW      = code(src('../components/FollowHeartBtn.jsx'));
const ACCESS_REQ  = code(src('../screens/AccessRequiredScreen.jsx'));
const AUTH        = code(src('../screens/AuthScreen.jsx'));
const APP         = code(src('../App.jsx'));
const WHATS_ON    = code(src('../screens/WhatsOnScreen.jsx'));
const DISCOVER    = code(src('../screens/DiscoverScreen.jsx'));

// ── asks 1 & 2: a guest tap opens the gate ──────────────────────────────────

test('a signed-out event heart REQUESTS participation instead of returning silently', () => {
  assert.match(HEART, /if\s*\(!session\?\.user\?\.id\)\s*\{\s*requestParticipation\('save_event'/,
    'HeartBtn must open the gate for a guest — the silent `return` was the dead tap O2 exists to fix');
  assert.match(HEART, /context:\s*\{\s*eventId:/, 'the intent context must carry the event id');
});

test('a signed-out follow heart REQUESTS participation instead of returning silently', () => {
  assert.match(FOLLOW, /if\s*\(!session\?\.user\?\.id\)\s*\{\s*requestParticipation\('follow_profile'/);
  assert.match(FOLLOW, /context:\s*\{\s*profileId:/);
});

// ── ask 8: an authenticated tap never sees the gate ─────────────────────────

test('the gate is reached ONLY on the no-session branch — an authed tap writes directly', () => {
  for (const [name, s] of [['HeartBtn', HEART], ['FollowHeartBtn', FOLLOW]]) {
    const calls = [...s.matchAll(/requestParticipation\(/g)];
    assert.equal(calls.length, 1, `${name} must request participation from exactly one place`);
    // The single call sits inside the `if (!session…)` guard, and the write
    // path below it is unconditional on the gate.
    const guardIdx = s.search(/if\s*\(!session\?\.user\?\.id\)/);
    assert.ok(guardIdx >= 0 && calls[0].index > guardIdx,
      `${name}'s gate call must be inside the signed-out guard`);
  }
});

test('ids only — no name, title or URL is written into a stored intent', () => {
  // The gate's `display` (copy-only) must never be spread into `context`.
  assert.doesNotMatch(GATE, /context:\s*\{[^}]*(name|title|url)/i);
  assert.doesNotMatch(HEART,  /context:\s*\{[^}]*(name|title|url)/i);
  assert.doesNotMatch(FOLLOW, /context:\s*\{[^}]*(name|title|url)/i);
});

// ── ask 10: AccessRequiredScreen is untouched and unmerged ──────────────────

test('⛔ the gate and AccessRequiredScreen stay separate concepts', () => {
  assert.doesNotMatch(GATE, /AccessRequired/,
    'the participation gate must not reference the resource-privacy screen');
  assert.doesNotMatch(ACCESS_REQ, /ParticipationGate|requestParticipation|returnIntent/,
    'AccessRequiredScreen must stay a privacy surface — it is not an auth gate');
  // Its own behaviour, unchanged: still the placeholder REQUEST ACCESS that
  // says it sends nothing.
  assert.match(ACCESS_REQ, /REQUEST ACCESS/);
  assert.match(ACCESS_REQ, /ACCESS REQUIRED/);
});

test('the gate never says "sign in required" — it names what an account enables', () => {
  assert.doesNotMatch(GATE, /sign[- ]?in required/i);
  assert.match(GATE, /KEEP THIS IN YOUR SCENE/);
  assert.match(GATE, /we'll save this event for you/);
  assert.match(GATE, /KEEP UP WITH/);
});

// ── the auth surface: one, and it consumes the intent ───────────────────────

test('the gate routes to the existing /auth — it does not build a second auth surface', () => {
  const navs = [...GATE.matchAll(/navigate\('([^']+)'/g)].map(m => m[1]);
    assert.deepEqual([...new Set(navs)], ['/auth']);
  assert.doesNotMatch(GATE, /signInWithPassword|signUp\(/,
    'the gate must never authenticate anyone itself');
});

test('AuthScreen resumes the intent and returns to its route', () => {
  assert.match(AUTH, /resumeIntent\(session\)/);
  assert.match(AUTH, /navigate\(resumed\.intent\.route/);
});

test('signing out clears any pending intent', () => {
  assert.match(APP, /clearIntent\(\)/);
});

// ── ask 9: public browsing is untouched ─────────────────────────────────────

test('the discovery screens gained no session or gate logic', () => {
  for (const [name, s] of [["What's On", WHATS_ON], ['Discover', DISCOVER]]) {
    assert.doesNotMatch(s, /requestParticipation|useParticipation/,
      `${name} must stay a pure browsing surface — the gate belongs to the CONTROLS it renders`);
  }
});

test('the provider wraps the app inside the router, so every heart shares one gate', () => {
  assert.match(APP, /<ParticipationProvider>/);
  const provider = APP.indexOf('<ParticipationProvider>');
  const routes   = APP.indexOf('<Routes>');
  assert.ok(provider > 0 && provider < routes,
    'the provider must enclose the routes — a gate mounted per screen would lose the intent on navigation');
});
