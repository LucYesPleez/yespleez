import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* The real client reads `import.meta.env`, which plain Node has not got. ⛔ The
   stub is deliberately EMPTY: every test passes its own client explicitly, so
   reaching the default here would throw rather than pass quietly. */
mock.module('./supabase', { exports: { supabase: {} } });

const {
  referencedPerformanceIds, orphanedNotifIds, findOrphanedOffers,
} = await import('./orphanedOffers.js');

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ── ⛔⛔ FOUR ORPHANS, THREE OF THEM OLDER THAN THE CODE THAT FOUND THEM ──────
 *
 * Of six readable slot_offer / event_invite rows in a real inbox, FOUR named a
 * performance that no longer exists — 10 July (×2), 16 July, and the 17 August
 * fixture offer. ⛔ Not a regression: a live condition with ACCEPT buttons that
 * could never have worked, because deleting a SLOT cascades to its performance
 * and no application code runs at all.
 */
const ORPHANS = [
  { id: 'f20c85ae-0000-0000-0000-000000000001', type: 'slot_offer', created_at: '2026-07-10T09:00:00Z', responded_at: null, data: { performance_id: 'perf-jul10-a' } },
  { id: 'f20c85ae-0000-0000-0000-000000000002', type: 'slot_offer', created_at: '2026-07-10T09:05:00Z', responded_at: null, data: { performance_id: 'perf-jul10-b' } },
  { id: 'dd24ef5b-0000-0000-0000-000000000003', type: 'slot_offer', created_at: '2026-07-16T09:00:00Z', responded_at: null, data: { performance_id: 'perf-jul16' } },
  { id: '806534f0-0000-0000-0000-000000000004', type: 'slot_offer', created_at: '2026-08-17T09:00:00Z', responded_at: null, data: { performance_id: 'perf-fixture' } },
];
/** The two that were answered, whose performance is alive. */
const ANSWERED = [
  { id: 'answered-1', type: 'slot_offer', responded_at: '2026-08-01T00:00:00Z', data: { performance_id: 'perf-live-1' } },
  { id: 'answered-2', type: 'slot_offer', responded_at: '2026-08-02T00:00:00Z', data: { performance_id: 'perf-live-2' } },
];
const LIVE_OFFER = { id: 'live-offer', type: 'slot_offer', responded_at: null, data: { performance_id: 'perf-live-3' } };

/** A stub PostgREST chain that records what it was asked. */
function stubClient(liveIds, { error = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        select(cols) {
          return {
            in(col, ids) {
              calls.push({ table, cols, col, ids });
              if (error) return Promise.resolve({ data: null, error });
              return Promise.resolve({ data: ids.filter(id => liveIds.includes(id)).map(id => ({ id })), error: null });
            },
          };
        },
        update() { throw new Error('⛔ orphan detection must never write'); },
        insert() { throw new Error('⛔ orphan detection must never write'); },
        delete() { throw new Error('⛔ orphan detection must never write'); },
      };
    },
  };
}

test('⛔⛔ the four orphaned offers are not actionable', async () => {
  const notifs = [...ORPHANS, ...ANSWERED];
  const client = stubClient(['perf-live-1', 'perf-live-2']);
  const stale = await findOrphanedOffers(notifs, client);
  for (const o of ORPHANS) {
    assert.ok(stale.has(o.id), `${o.id} (${o.created_at}) still offers an answer it cannot honour`);
  }
  assert.equal(stale.size, ORPHANS.length);
});

test('⭐ a live slot_offer stays actionable', async () => {
  const client = stubClient(['perf-live-3']);
  const stale = await findOrphanedOffers([LIVE_OFFER], client);
  assert.equal(stale.has(LIVE_OFFER.id), false, 'a live offer must keep its ACCEPT');
  assert.equal(stale.size, 0);
});

test('⭐ existing answered notifications are untouched by the check', async () => {
  /* Even with their performance GONE, an answered row is history that already
     reads as RESPONDED — ⛔ it must not be re-labelled. */
  const client = stubClient([]);
  const stale = await findOrphanedOffers(ANSWERED, client);
  assert.equal(stale.size, 0);
  assert.equal(client.calls.length, 0, 'an answered row must not even be looked up');
});

test('⭐ ONE batched read for the whole inbox, never one per notification', async () => {
  const client = stubClient([]);
  await findOrphanedOffers([...ORPHANS, LIVE_OFFER], client);
  assert.equal(client.calls.length, 1, 'the lookup must be batched');
  assert.equal(client.calls[0].table, 'performances');
  assert.equal(client.calls[0].ids.length, 5, 'every referenced set time in one query');
});

test('⭐ nothing is looked up when no notification names a set time', async () => {
  const client = stubClient([]);
  const stale = await findOrphanedOffers(
    [{ id: 'invite', type: 'event_invite', responded_at: null, data: { event_id: 'e1' } }], client);
  assert.equal(stale.size, 0, 'an invite names no set time and is never gated');
  assert.equal(client.calls.length, 0);
});

/**
 * ⛔⛔ A MISSING PERFORMANCE MUST NOT ALTER THE NOTIFICATION ROW. The record is
 * honest history — the artist genuinely WAS offered that set time. ⛔ Not
 * `responded_at` (they did not respond), ⛔ not `expired_at` (no window closed),
 * ⛔ not `dismissed_at` (that is the recipient hiding a row, SEC-6a). And the
 * UPDATE policy — auth.uid() = to_user_id — makes it impossible anyway.
 */
test('⛔⛔ a missing performance writes nothing to notifications', async () => {
  /* The stub throws on any write verb, so reaching one fails the test. */
  const client = stubClient([]);
  await findOrphanedOffers(ORPHANS, client);
  assert.deepEqual(client.calls.map(c => c.table), ['performances'],
    'the only table touched is performances, and only to READ it');

  const src = readFileSync(join(SRC, 'lib/orphanedOffers.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.equal(/\.from\('notifications'\)/.test(src), false, 'it must not touch notifications at all');
  assert.equal(/\.update\(|\.insert\(|\.delete\(/.test(src), false, 'it must not write');
  for (const col of ['responded_at', 'expired_at', 'dismissed_at']) {
    assert.equal(new RegExp(`${col}\\s*:`).test(src), false, `it must not stamp ${col}`);
  }
});

/**
 * ⚠ IT FAILS OPEN. On a read error every row keeps today's behaviour, so a live
 * offer can still be answered — and since 9d44851 the answer itself refuses to
 * announce a write that did not land. ⛔ The worst case is an honest error on the
 * row, not a lie.
 */
test('⚠ a failed lookup leaves every row as it was', async () => {
  const client = stubClient([], { error: new Error('network') });
  const stale = await findOrphanedOffers([...ORPHANS, LIVE_OFFER], client);
  assert.equal(stale.size, 0);
});

test('the referenced ids are de-duplicated', () => {
  const dupe = { id: 'x', type: 'slot_offer', responded_at: null, data: { performance_id: 'perf-jul10-a' } };
  assert.deepEqual(referencedPerformanceIds([ORPHANS[0], dupe]), ['perf-jul10-a']);
});

test('the test is the PERFORMANCE, not the placement', () => {
  /* ⛔ "do they still hold that slot" is a different question and would
     mislabel a re-offer. The handlers key on performance_id, so its existence
     is the correct test. */
  const reoffered = { id: 'r', type: 'slot_offer', responded_at: null, data: { performance_id: 'perf-new', slot_id: 'slot-1' } };
  assert.equal(orphanedNotifIds([reoffered], ['perf-new']).size, 0);
});

/** ⛔ NotifPanel and NotificationsScreen are twins — change one, change both. */
test('⛔ both notification surfaces gate on the orphan check', () => {
  for (const file of ['components/NotifPanel.jsx', 'screens/NotificationsScreen.jsx']) {
    const src = readFileSync(join(SRC, file), 'utf8');
    assert.match(src, /findOrphanedOffers/, `${file} does not derive staleness`);
    assert.match(src, /const actionable = !responded && answerable && !orphaned;/,
      `${file} still offers an answer for a set time that no longer exists`);
    assert.match(src, /This set time no longer exists\./, `${file} does not say why`);
  }
});
