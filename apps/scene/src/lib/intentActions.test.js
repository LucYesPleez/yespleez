/**
 * INTENT ACTIONS — the auto-complete boundary, test-enforced.
 *
 * The one rule that must never erode (ratified 2026-08-12): only idempotent,
 * reversible, content-free actions auto-execute after auth. ⛔ A message is
 * never sent and an application is never submitted by a resumed intent —
 * their names appearing in AUTO_ACTIONS is an architecture change and these
 * tests are the tripwire.
 *
 * Exercises the REAL intentActions.js + returnIntent.js with supabase,
 * participation and analytics stubbed — same approach as contactSync.test.js.
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let db = { events: {}, profiles: {} };
let saves = [];
let follows = [];
let saveError = null;
let followError = null;
let tracked = [];

mock.module('./supabase', {
  exports: {
    supabase: {
      from: table => ({
        select: () => ({
          eq: (_col, id) => ({
            maybeSingle: async () => ({ data: db[table]?.[id] ?? null, error: null }),
          }),
        }),
      }),
    },
  },
});

mock.module('./participation', {
  exports: {
    saveEvent:     async (uid, ev) => { saves.push({ uid, ev });   return { error: saveError }; },
    followProfile: async (uid, p)  => { follows.push({ uid, p });  return { error: followError }; },
  },
});

mock.module('./analytics', {
  exports: {
    track: (name, props) => tracked.push({ name, props }),
    EVENTS: { INTENT_RESUMED: 'intent_resumed' },
  },
});

function makeStorage() {
  const m = new Map();
  return {
    getItem:    k => (m.has(k) ? m.get(k) : null),
    setItem:    (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}
globalThis.window = { sessionStorage: makeStorage() };

const { AUTO_ACTIONS, resumeIntent } = await import('./intentActions.js');
const { captureIntent } = await import('./returnIntent.js');

const SESSION = { user: { id: 'user-1' } };

beforeEach(() => {
  db = { events: {}, profiles: {} };
  saves = []; follows = []; tracked = [];
  saveError = null; followError = null;
  globalThis.window.sessionStorage = makeStorage();
});

// ── ask 7: the auto-complete boundary ───────────────────────────────────────

test('⛔ AUTO_ACTIONS is exactly save_event + follow_profile — nothing that sends or submits', () => {
  assert.deepEqual(Object.keys(AUTO_ACTIONS).sort(), ['follow_profile', 'save_event']);
  for (const forbidden of ['message', 'send_message', 'apply', 'submit_application']) {
    assert.equal(AUTO_ACTIONS[forbidden], undefined,
      `"${forbidden}" must never be auto-completable — a resumed intent may not act with user content`);
  }
});

test('⛔ a message-shaped intent restores the route and executes NOTHING', async () => {
  captureIntent({ route: '/messages/c-1', action: 'send_message', context: { conversationId: 'c-1' } });
  const resumed = await resumeIntent(SESSION);
  assert.equal(resumed.intent.route, '/messages/c-1');   // the return trip still happens
  assert.equal(resumed.result.done, false);
  assert.equal(saves.length, 0);
  assert.equal(follows.length, 0);
});

// ── asks 3 & 5: save resumes, exactly once ──────────────────────────────────

test('a save intent completes after auth — with the freshly fetched event, once', async () => {
  db.events['ev-1'] = { id: 'ev-1', name: 'The Jazz Social' };
  captureIntent({ route: '/event/ev-1', action: 'save_event', context: { eventId: 'ev-1' } });

  const resumed = await resumeIntent(SESSION);
  assert.equal(resumed.result.done, true);
  assert.equal(resumed.intent.route, '/event/ev-1');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].uid, 'user-1');
  assert.equal(saves[0].ev.name, 'The Jazz Social'); // re-fetched, not trusted from the slot

  // ⭐ EXACTLY ONCE — the StrictMode double-invoke finds nothing.
  assert.equal(await resumeIntent(SESSION), null);
  assert.equal(saves.length, 1);
});

// ── ask 4: follow resumes ───────────────────────────────────────────────────

test('a follow intent completes after auth with the freshly fetched profile', async () => {
  db.profiles['p-1'] = { id: 'p-1', user_id: 'someone-else', type: 'artist', name: 'Chaperone' };
  captureIntent({ route: '/profile/p-1', action: 'follow_profile', context: { profileId: 'p-1' } });

  const resumed = await resumeIntent(SESSION);
  assert.equal(resumed.result.done, true);
  assert.equal(follows.length, 1);
  assert.equal(follows[0].p.id, 'p-1');
});

// ── validation: the action must still be valid after auth ───────────────────

test('a target that no longer resolves (gone, or RLS says no) fails quietly — route still restored', async () => {
  captureIntent({ route: '/event/gone', action: 'save_event', context: { eventId: 'gone' } });
  const resumed = await resumeIntent(SESSION);
  assert.equal(resumed.result.done, false);
  assert.equal(resumed.result.reason, 'not-visible');
  assert.equal(resumed.intent.route, '/event/gone');
  assert.equal(saves.length, 0);
});

test('the account that signed up may own the profile — never follow yourself', async () => {
  db.profiles['p-1'] = { id: 'p-1', user_id: 'user-1', type: 'artist', name: 'Me' };
  captureIntent({ route: '/profile/p-1', action: 'follow_profile', context: { profileId: 'p-1' } });
  const resumed = await resumeIntent(SESSION);
  assert.equal(resumed.result.reason, 'self');
  assert.equal(follows.length, 0);
});

test('already-saved (23505) counts as done — the asked-for state is the actual state', async () => {
  db.events['ev-1'] = { id: 'ev-1', name: 'x' };
  saveError = { code: '23505' };
  captureIntent({ route: '/event/ev-1', action: 'save_event', context: { eventId: 'ev-1' } });
  const resumed = await resumeIntent(SESSION);
  assert.equal(resumed.result.done, true);
});

test('a context without the required id never reaches the write', async () => {
  captureIntent({ route: '/event/ev-1', action: 'save_event', context: {} });
  const resumed = await resumeIntent(SESSION);
  assert.equal(resumed.result.reason, 'bad-context');
  assert.equal(saves.length, 0);
});

// ── with no intent, resume is a no-op ───────────────────────────────────────

test('no intent → null → the caller falls back to its ordinary post-auth path', async () => {
  assert.equal(await resumeIntent(SESSION), null);
  assert.equal(tracked.length, 0); // nothing resumed, nothing counted
});

// ── the funnel is measured, ids never travel ────────────────────────────────

test('intent_resumed is tracked once, with the action name and outcome only', async () => {
  db.events['ev-1'] = { id: 'ev-1', name: 'x' };
  captureIntent({ route: '/event/ev-1', action: 'save_event', context: { eventId: 'ev-1' } });
  await resumeIntent(SESSION);
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].name, 'intent_resumed');
  assert.deepEqual(tracked[0].props, { action: 'save_event', done: true });
});
