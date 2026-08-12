import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * RETURN INTENT — the contract's guarantees, each one a test.
 *
 * The slot is UX state carrying "what I was doing" across auth. The rules
 * under test: one slot · exactly once · stale/foreign/malformed discarded ·
 * ids only travel · storage failure degrades to "no resume", never a crash.
 */

function makeStorage() {
  const m = new Map();
  return {
    getItem:    k => (m.has(k) ? m.get(k) : null),
    setItem:    (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _raw: m,
  };
}

globalThis.window = { sessionStorage: makeStorage() };

const { captureIntent, consumeIntent, clearIntent, INTENT_TTL_MS } =
  await import('./returnIntent.js');

const KEY = 'yp_return_intent';

beforeEach(() => { globalThis.window.sessionStorage = makeStorage(); });

// ── the round trip (asks 3 & 4: intent survives auth) ───────────────────────

test('a save intent survives capture → consume intact', () => {
  assert.equal(captureIntent({
    route: '/event/abc-123', action: 'save_event', context: { eventId: 'abc-123' },
  }), true);
  const intent = consumeIntent();
  assert.equal(intent.route,  '/event/abc-123');
  assert.equal(intent.action, 'save_event');
  assert.deepEqual(intent.context, { eventId: 'abc-123' });
});

test('a follow intent survives capture → consume intact', () => {
  captureIntent({ route: '/profile/p-9', action: 'follow_profile', context: { profileId: 'p-9' } });
  const intent = consumeIntent();
  assert.equal(intent.route,  '/profile/p-9');
  assert.equal(intent.action, 'follow_profile');
  assert.deepEqual(intent.context, { profileId: 'p-9' });
});

// ── exactly once (ask 5) ────────────────────────────────────────────────────

test('⭐ EXACTLY ONCE — the second consume finds an empty slot', () => {
  captureIntent({ route: '/event/x', action: 'save_event', context: { eventId: 'x' } });
  assert.ok(consumeIntent());
  assert.equal(consumeIntent(), null);
});

test('one slot: a second capture replaces the first, never queues behind it', () => {
  captureIntent({ route: '/event/first',  action: 'save_event',     context: { eventId: 'first' } });
  captureIntent({ route: '/profile/second', action: 'follow_profile', context: { profileId: 'second' } });
  assert.equal(consumeIntent().route, '/profile/second');
  assert.equal(consumeIntent(), null);
});

// ── staleness and tampering (ask 6) ─────────────────────────────────────────

test('an intent older than the TTL is discarded, not executed late', () => {
  captureIntent({ route: '/event/x', action: 'save_event', context: { eventId: 'x' } });
  assert.equal(consumeIntent(Date.now() + INTENT_TTL_MS + 1), null);
  // And discarding consumed it — nothing left to replay.
  assert.equal(consumeIntent(), null);
});

test('a version this code does not speak is discarded', () => {
  window.sessionStorage.setItem(KEY, JSON.stringify({
    v: 999, route: '/event/x', action: 'save_event', context: {}, ts: Date.now(),
  }));
  assert.equal(consumeIntent(), null);
});

test('unparseable and structurally wrong slots are discarded, never thrown', () => {
  window.sessionStorage.setItem(KEY, '{not json');
  assert.equal(consumeIntent(), null);

  // An absolute URL is not an in-app route — a forged slot must not be able
  // to navigate someone off the app.
  window.sessionStorage.setItem(KEY, JSON.stringify({
    v: 1, route: 'https://evil.example', action: 'save_event', context: {}, ts: Date.now(),
  }));
  assert.equal(consumeIntent(), null);

  window.sessionStorage.setItem(KEY, JSON.stringify({
    v: 1, route: '/event/x', action: 'save_event', context: {}, ts: 'yesterday',
  }));
  assert.equal(consumeIntent(), null);
});

test('capture refuses a route that is not an in-app path', () => {
  assert.equal(captureIntent({ route: 'https://evil.example', action: 'save_event' }), false);
  assert.equal(consumeIntent(), null);
});

// ── explicit dismissal and broken storage ───────────────────────────────────

test('clearIntent empties the slot — "Not now" must not ambush a later sign-in', () => {
  captureIntent({ route: '/event/x', action: 'save_event', context: { eventId: 'x' } });
  clearIntent();
  assert.equal(consumeIntent(), null);
});

test('unavailable storage degrades to no-resume, never a crash', () => {
  globalThis.window = {}; // Safari private mode's shape: accessing throws/undefined
  assert.equal(captureIntent({ route: '/event/x', action: 'save_event' }), false);
  assert.equal(consumeIntent(), null);
  clearIntent(); // must not throw
  globalThis.window = { sessionStorage: makeStorage() };
});
