import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROUTE_ACCESS, ACCESS, routesWithAccess } from './routeAccess.js';

/**
 * ⭐⭐ THE ROUTER AND lib/routeAccess.js MUST NEVER DRIFT APART, AND THE AUTH
 * WALL MUST NEVER COME BACK (owner, 2026-08-12).
 *
 * Discovery is anonymous; participation is identified. routeAccess.js is the
 * one client-side statement of which surfaces are which — but a declaration
 * nothing checks is decoration. These tests hold it and App.jsx's <Route>
 * tree equal in BOTH directions, and pin the two architectural facts O1
 * established: the router mounts unconditionally, and "guest" is not a state.
 *
 * ⚠ routeAccess.js is the UX boundary only. RLS (SEC-1/SEC-2) is the
 * security boundary, and it holds even if this table is wrong. If the two
 * ever disagree, RLS wins — fix the table, never the policies, to make a
 * screen's behaviour come out right.
 *
 * Source-level, per the codebase idiom — and per its known trap: anchored on
 * CODE (`<Route path="…"`, identifiers), never on words that also appear in
 * explanation, with comments stripped first so prose cannot trip a match.
 */

const APP_SRC = readFileSync(fileURLToPath(new URL('../App.jsx', import.meta.url)), 'utf8');

// Strip /* … */ blocks (JSX comments included) and whitespace-led // lines,
// leaving only code. `//` inside a URL string ("http://…") survives because
// it is preceded by `:`, not whitespace.
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

const APP_CODE = code(APP_SRC);

const routedPaths = [...APP_CODE.matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1]);
const declaredPaths = Object.keys(ROUTE_ACCESS);

// ── The declaration and the router agree, both ways ─────────────────────────

test('every <Route> the router serves is declared in ROUTE_ACCESS', () => {
  assert.ok(routedPaths.length > 0, 'found no <Route path="…"> in App.jsx — the extraction anchor broke');
  for (const p of routedPaths) {
    assert.ok(p in ROUTE_ACCESS,
      `App.jsx routes "${p}" but lib/routeAccess.js does not declare it — a new route must declare its access class to exist`);
  }
});

test('every declared route exists in the router (no ghost declarations)', () => {
  for (const p of declaredPaths) {
    assert.ok(routedPaths.includes(p),
      `lib/routeAccess.js declares "${p}" but App.jsx has no such <Route> — remove the declaration or add the route`);
  }
});

test('a path is declared exactly once and routed exactly once', () => {
  const seen = new Set();
  for (const p of routedPaths) {
    assert.ok(!seen.has(p), `App.jsx routes "${p}" twice`);
    seen.add(p);
  }
});

test('every declared access class is a real one', () => {
  const valid = new Set(Object.values(ACCESS));
  for (const [p, { access }] of Object.entries(ROUTE_ACCESS)) {
    assert.ok(valid.has(access), `"${p}" declares unknown access "${access}"`);
  }
});

test('routesWithAccess partitions the table completely', () => {
  const total = Object.values(ACCESS).reduce((n, a) => n + routesWithAccess(a).length, 0);
  assert.equal(total, declaredPaths.length);
});

// ── The wall stays down ─────────────────────────────────────────────────────

test('the router mounts unconditionally — AuthScreen renders only as the /auth route', () => {
  // The wall's shape was `return <AuthScreen …/>` before <HashRouter> ever
  // mounted. In code (comments stripped), every render of <AuthScreen must
  // now sit on the /auth Route line and nowhere else.
  const renders = [...APP_CODE.matchAll(/<AuthScreen[\s/>]/g)];
  assert.equal(renders.length, 1, 'AuthScreen renders more than once in App.jsx — the auth wall is coming back');
  const line = APP_CODE.slice(APP_CODE.lastIndexOf('\n', renders[0].index) + 1,
                              APP_CODE.indexOf('\n', renders[0].index));
  assert.match(line, /<Route\s+path="\/auth"/,
    'AuthScreen renders outside the /auth <Route> — authentication must be a route, never the boot condition');
});

test('"guest" is not a state — the flag and its storage key are gone from App.jsx', () => {
  assert.ok(!/\bisGuest\b/.test(APP_CODE), 'isGuest is back in App.jsx — !session is the only meaning of signed-out');
  assert.ok(!/yp_guest/.test(APP_CODE), 'the yp_guest storage key is back in App.jsx');
  assert.ok(!/\bsessionStorage\b/.test(APP_CODE),
    'App.jsx touches sessionStorage — the guest-persistence mechanism must not return in any form');
});

test('/auth is declared PUBLIC and the discovery surfaces stay PUBLIC', () => {
  // The floor of the ratified model: these render real content with no
  // session. Reclassifying any of them is an architecture change, not a tweak.
  for (const p of ['/', '/discover', '/event/:id', '/profile/:id', '/my-scene', '/auth']) {
    assert.equal(ROUTE_ACCESS[p]?.access, ACCESS.PUBLIC,
      `"${p}" must be PUBLIC — discovery is anonymous; participation is identified`);
  }
});
