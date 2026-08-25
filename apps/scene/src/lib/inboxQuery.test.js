/**
 * THE INBOX WARM-UP — every failure mode here is invisible.
 *
 * A warm-up that quietly declines leaves the app exactly as it was: Messages
 * still loads, just slowly, on the one visit where slow reads as EMPTY. A
 * warm-up that quietly over-fires costs every signed-in session a five-step
 * waterfall for a screen nobody opened — and in dev, StrictMode's double
 * effect makes that two. Neither shows up as an error.
 *
 * So the promises worth pinning are the two halves of the gate:
 *   1. it fires exactly once for a real user, and not at all for a guest;
 *   2. it never refetches over data the cache already holds.
 *
 * `prefetchInbox` takes the QueryClient as an argument precisely so this file
 * can hand it a stub and assert on the calls, with no React and no network.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

/* This module pulls in lib/messaging → lib/supabase, which reads
   import.meta.env at load time and throws under plain Node. The gate under
   test never reaches the network — it only inspects the cache — so a bare stub
   is enough to let the real module load unmodified. */
mock.module('./supabase', { exports: { supabase: { from: () => ({}) } } });

const { inboxKey, prefetchInbox } = await import('./inboxQuery.js');

/** Minimal stand-in for the bits of QueryClient prefetchInbox touches. */
function stubClient({ cached } = {}) {
  const calls = [];
  return {
    calls,
    getQueryData: key => (cached && key.join('|') === cached ? [] : undefined),
    prefetchQuery: opts => { calls.push(opts); return Promise.resolve(); },
  };
}

test('the key is per user, so one account never serves another its inbox', () => {
  assert.deepEqual(inboxKey('u-1'), ['inbox', 'u-1']);
  assert.notDeepEqual(inboxKey('u-1'), inboxKey('u-2'));
});

test('a signed-in user warms the cache once, under the key the screen reads', () => {
  const qc = stubClient();
  assert.equal(prefetchInbox(qc, 'u-1'), true);
  assert.equal(qc.calls.length, 1);
  assert.deepEqual(qc.calls[0].queryKey, inboxKey('u-1'));
  assert.equal(typeof qc.calls[0].queryFn, 'function');
});

test('⛔ a guest is never asked for an inbox — discovery is anonymous', () => {
  const qc = stubClient();
  assert.equal(prefetchInbox(qc, null), false);
  assert.equal(prefetchInbox(qc, undefined), false);
  assert.equal(prefetchInbox(qc, ''), false);
  assert.equal(qc.calls.length, 0, 'no round trip for a user who has no inbox');
});

test('⚠ already-cached declines — StrictMode\'s second pass must be free', () => {
  const qc = stubClient({ cached: 'inbox|u-1' });
  assert.equal(prefetchInbox(qc, 'u-1'), false);
  assert.equal(qc.calls.length, 0);
  // A DIFFERENT user is still cold, even while the first is warm.
  assert.equal(prefetchInbox(qc, 'u-2'), true);
  assert.equal(qc.calls.length, 1);
});

test('no client, no crash — the warm-up may never break app start', () => {
  assert.equal(prefetchInbox(null, 'u-1'), false);
  assert.equal(prefetchInbox(undefined, 'u-1'), false);
});

test('⚠ a throwing cache is swallowed, not surfaced', () => {
  const qc = {
    getQueryData() { throw new Error('cache exploded'); },
    prefetchQuery() { throw new Error('should not be reached'); },
  };
  assert.equal(prefetchInbox(qc, 'u-1'), false, 'declines instead of throwing into App');
});
