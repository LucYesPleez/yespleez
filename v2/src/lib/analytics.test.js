/**
 * A1 · PRODUCT ANALYTICS — regression tests.
 *
 * These exercise the REAL analytics.js and the REAL messaging.js; only the
 * Supabase client is stubbed. Same approach as messaging.test.js.
 *
 * ── WHY THIS FILE IS WORTH MORE THAN USUAL ───────────────────────────
 *
 * Analytics has no user-visible failure mode. Every write is fire-and-forget
 * and every error is swallowed by design, so a broken metric does not crash,
 * does not warn, and does not look different from a working one — it just
 * reads zero, and nobody finds out until they are looking at a dashboard
 * three months from now trying to remember whether that number was ever
 * real. Nothing else in the app is this quiet when it breaks.
 *
 * So the tests target precisely the failures that would be silent:
 *
 *   1. A JS event name the database's CHECK does not accept. Every row
 *      rejected, forever, invisibly.
 *   2. A display_mode or platform value the CHECK does not accept — same,
 *      and it would take out the install metric specifically.
 *   3. `.select()` creeping onto the insert. There is deliberately no SELECT
 *      policy, so that one method call breaks every analytics write.
 *   4. The send path not firing, or firing on a FAILED send.
 *
 * Run: npm test   (see package.json — needs the resolve hook and mock flag)
 */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE      = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, '../../../supabase/migrations/20260724000001_a1_usage_events.sql');

const PROFILE = '11111111-1111-1111-1111-111111111111';
const CONV    = '33333333-3333-3333-3333-333333333333';
const USER    = '22222222-2222-2222-2222-222222222222';

/** Every insert issued, as {table, row}. Reset per test. */
let inserted = [];
/** Every query builder created, so we can assert what was NOT called. */
let queries = [];
/** Set to an error object to make the message insert fail. */
let sendError = null;
/** When true, the stub throws on .from() — the "analytics backend is down" case. */
let explode = false;

mock.module('./supabase', {
  exports: {
    supabase: {
      auth: {
        getUser:    async () => ({ data: { user: { id: USER } }, error: null }),
        getSession: async () => ({ data: { session: { user: { id: USER } } }, error: null }),
      },
      from(table) {
        if (explode) throw new Error('network is on fire');
        const q = {
          table,
          selectCalled: false,
          insert(row) { inserted.push({ table, row }); q.insertedRow = row; return q; },
          select(cols) { q.selectCalled = true; q.cols = cols; return q; },
          eq() { return q; },
          single: async () => (
            sendError ? { data: null, error: sendError }
                      : { data: { id: 'new-message', ...q.insertedRow }, error: null }
          ),
          then(resolve) { resolve({ data: null, error: null }); },
        };
        queries.push(q);
        return q;
      },
    },
  },
});

const {
  track, EVENTS, DISPLAY_MODES, PLATFORMS,
  displayMode, platform, newUuid, deviceId,
  __resetAnalyticsForTests,
} = await import('./analytics.js');
const { sendMessage } = await import('./messaging.js');

beforeEach(() => {
  inserted = [];
  queries  = [];
  sendError = null;
  explode = false;
  __resetAnalyticsForTests();
});

/** The usage_events rows written, ignoring everything else. */
const pings = () => inserted.filter(i => i.table === 'usage_events').map(i => i.row);

/** Pull the quoted literals out of one `CHECK (<col> IN ( … ))` in the migration. */
function checkValues(column) {
  const sql   = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf(`CHECK (${column} IN (`);
  assert.notEqual(start, -1, `no CHECK (${column} IN (…)) found in the A1 migration`);
  const end = sql.indexOf('))', start);
  assert.notEqual(end, -1, `unterminated CHECK for ${column}`);
  return [...sql.slice(start, end).matchAll(/'([a-z_-]+)'/g)].map(m => m[1]);
}

// ── 1 · THE JS↔SQL CONTRACTS ─────────────────────────────────────────
//
// The most valuable tests here. Drift between these two lists is invisible
// at runtime: Postgres rejects the row, track() ignores the rejection by
// design, and the chart reads zero while the app looks perfectly healthy.

test('every event name the client can send is accepted by the A1 CHECK', () => {
  const allowed = checkValues('name');
  for (const name of Object.values(EVENTS)) {
    assert.ok(
      allowed.includes(name),
      `EVENTS has '${name}' but the CHECK in the A1 migration does not. ` +
      'Every row carrying it will be rejected and the metric will read zero ' +
      'forever. Add it to the migration and apply it.',
    );
  }
});

test('the A1 CHECK lists no event name the client cannot send', () => {
  const allowed = checkValues('name');
  const known   = Object.values(EVENTS);
  for (const name of allowed) {
    assert.ok(
      known.includes(name),
      `the migration allows '${name}' but EVENTS does not define it — ` +
      'either a call site is missing or the name is dead contract.',
    );
  }
});

test('every display_mode the client can produce is accepted by the A1 CHECK', () => {
  const allowed = checkValues('display_mode');
  assert.deepEqual(
    [...DISPLAY_MODES].sort(), [...allowed].sort(),
    'DISPLAY_MODES and the migration CHECK must agree exactly — a mode this ' +
    'code can return but the database refuses takes out the install metric ' +
    'specifically, and silently',
  );
});

test('every platform the client can produce is accepted by the A1 CHECK', () => {
  const allowed = checkValues('platform');
  assert.deepEqual([...PLATFORMS].sort(), [...allowed].sort());
});

// ── 2 · THE `.select()` TRAP ─────────────────────────────────────────

test('the analytics insert never calls .select() — there is no SELECT policy', () => {
  track(EVENTS.OPENED_APP);

  const q = queries.find(x => x.table === 'usage_events');
  assert.ok(q, 'expected an insert into usage_events');
  assert.equal(
    q.selectCalled, false,
    'usage_events has no SELECT policy on purpose (the anon key is public). ' +
    'INSERT ... RETURNING is governed by the SELECT policy, so adding ' +
    '.select() here makes EVERY analytics write fail. Remove the .select(); ' +
    'do not add a policy.',
  );
});

// ── 3 · THE ROW SHAPE ────────────────────────────────────────────────

test('a tracked event carries the device context the dashboard groups by', () => {
  track(EVENTS.OPENED_APP, { reason: 'load' });

  assert.equal(pings().length, 1);
  const row = pings()[0];
  assert.ok(row.device_id, 'device_id is not nullable in A1');
  assert.ok(DISPLAY_MODES.includes(row.display_mode));
  assert.ok(PLATFORMS.includes(row.platform));
  assert.deepEqual(row.props, { reason: 'load' });
});

test('an unknown event name is dropped before it reaches the network', () => {
  track('not_a_real_event');
  assert.equal(pings().length, 0,
    'sending it would mean one rejected insert per user action, invisibly');
});

test('track never throws, even when the client itself blows up', () => {
  explode = true;
  // Rule 1: analytics failing must be indistinguishable from analytics
  // working. A throw here would propagate into whatever the user just did —
  // a send button failing because a stats row could not be written.
  assert.doesNotThrow(() => track(EVENTS.SENT_MESSAGE));
});

// ── 4 · DETECTION ────────────────────────────────────────────────────

test('an undetectable display mode reports unknown, never browser', () => {
  // Under node there is no window.matchMedia, which is the undetectable case.
  // Defaulting to 'browser' would bias the single number this table exists to
  // measure, in the direction that makes the PWA look less successful.
  assert.equal(displayMode(), 'unknown');
});

test('platform falls back to a member of the allow-list', () => {
  assert.ok(PLATFORMS.includes(platform()));
});

test('a uuid is produced without crypto.randomUUID', () => {
  // ⚠ THE LAN-TESTING CASE. crypto.randomUUID is a secure-context API and is
  // undefined over plain http on a LAN address — exactly how this app gets
  // tested on a real phone. Without the fallback every phone test would
  // record nothing, and it would look like "the table is empty".
  const real = globalThis.crypto?.randomUUID;
  try {
    if (globalThis.crypto) globalThis.crypto.randomUUID = undefined;
    const id = newUuid();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      'must still be a valid v4-shaped uuid — the column type demands it');
  } finally {
    if (globalThis.crypto && real) globalThis.crypto.randomUUID = real;
  }
});

test('the device id is stable across calls within a page', () => {
  // localStorage does not exist under node, so this exercises the in-memory
  // fallback — the same path a browser with site data blocked takes.
  assert.equal(deviceId(), deviceId());
});

// ── 5 · THE PRODUCTION CALL PATH ─────────────────────────────────────
//
// A unit test of track() cannot catch a call site that never calls it. These
// go through the real sendMessage — the one insert every message kind routes
// through — so they fail if the instrumentation is removed or misplaced.

test('sending a message fires sent_message on the real send path', async () => {
  await sendMessage({ conversationId: CONV, fromProfileId: PROFILE, body: 'hello' });

  const p = pings();
  assert.equal(p.length, 1);
  assert.equal(p[0].name, EVENTS.SENT_MESSAGE);
  assert.equal(p[0].props.kind, 'text',
    'a plain text send omits `kind` so the column default applies; the ping ' +
    'normalises it rather than recording a hole');
});

test('sending a voice note fires sent_voicey, not sent_message', async () => {
  await sendMessage({
    conversationId: CONV, fromProfileId: PROFILE, body: 'Voice message', kind: 'voice',
  });

  const p = pings();
  assert.equal(p.length, 1);
  assert.equal(p[0].name, EVENTS.SENT_VOICEY,
    'Voiceys are counted separately — "are Voiceys being used" is one of the ' +
    'questions this table exists to answer');
});

test('a photo counts as a message, with its kind recorded', async () => {
  await sendMessage({
    conversationId: CONV, fromProfileId: PROFILE, body: 'Photo', kind: 'image',
  });

  const p = pings();
  assert.equal(p.length, 1);
  assert.equal(p[0].name, EVENTS.SENT_MESSAGE);
  assert.equal(p[0].props.kind, 'image');
});

test('a FAILED send records nothing', async () => {
  sendError = { message: 'rls: denied' };
  await sendMessage({ conversationId: CONV, fromProfileId: PROFILE, body: 'hello' });

  assert.equal(pings().length, 0,
    'counting attempts would make the messaging graph disagree with the ' +
    'messages table, and the disagreement would grow with every outage');
});

test('a send refused before the network records nothing', async () => {
  await sendMessage({ conversationId: CONV, fromProfileId: PROFILE, body: '   ' });
  assert.equal(pings().length, 0);
});
