import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../lib/db.js';

/** A fetch stub that records requests and plays scripted responses. */
function stubFetch(script) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      headers: { get: (k) => (k.toLowerCase() === 'content-range' ? step.contentRange ?? null : null) },
      json: async () => step.body ?? [],
      text: async () => JSON.stringify(step.body ?? ''),
    };
  };
  fn.calls = calls;
  return fn;
}

test('every request carries BOTH headers — apikey alone answers as anon', async () => {
  const f = stubFetch([{ status: 206, body: [], contentRange: '0-0/0' }]);
  const db = makeDb({ url: 'https://x.supabase.co', serviceKey: 'KEY', fetchImpl: f });
  await db.read('account_segments?select=user_id');
  const h = f.calls[0].init.headers;
  assert.equal(h.apikey, 'KEY');
  assert.equal(h.Authorization, 'Bearer KEY');
});

test('analytics schema reads carry Accept-Profile; public reads do not', async () => {
  const f = stubFetch([{ status: 206, body: [], contentRange: '0-0/0' }]);
  const db = makeDb({ url: 'https://x.supabase.co', serviceKey: 'K', fetchImpl: f });
  await db.read('account_segments?select=user_id');                 // default: analytics
  await db.read('usage_events?select=id', { schema: 'public' });
  assert.equal(f.calls[0].init.headers['Accept-Profile'], 'analytics');
  assert.equal('Accept-Profile' in f.calls[1].init.headers, false);
});

test('readAll pages past the 1,000-row cap and reports completeness honestly', async () => {
  const page = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));
  const f = stubFetch([
    { status: 206, body: page(1000), contentRange: '0-999/1500' },
    { status: 206, body: page(500), contentRange: '1000-1499/1500' },
  ]);
  const db = makeDb({ url: 'https://x.supabase.co', serviceKey: 'K', fetchImpl: f });
  const out = await db.readAll('account_segments?select=user_id&order=user_id.asc');
  assert.equal(out.rows.length, 1500);
  assert.equal(out.total, 1500);
  assert.equal(out.complete, true);
  assert.equal(f.calls.length, 2);
});

test('a capped read says INCOMPLETE rather than pretending it saw everything', async () => {
  const page = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));
  const f = stubFetch([{ status: 206, body: page(1000), contentRange: '0-999/5000' }]);
  const db = makeDb({ url: 'https://x.supabase.co', serviceKey: 'K', fetchImpl: f });
  const out = await db.readAll('t?order=id.asc', { cap: 1000 });
  assert.equal(out.rows.length, 1000);
  assert.equal(out.complete, false);
});

test('checkExposure names each failure world', async () => {
  const worlds = [
    [{ status: 406, body: {} }, /Exposed schemas/],
    [{ status: 404, body: {} }, /AV0\/AV1/],
    [{ status: 206, body: [], contentRange: '0-0/1' }, null],
  ];
  for (const [step, expect] of worlds) {
    const db = makeDb({ url: 'https://x.supabase.co', serviceKey: 'K', fetchImpl: stubFetch([step]) });
    const out = await db.checkExposure();
    if (expect === null) assert.equal(out.ok, true);
    else { assert.equal(out.ok, false); assert.match(out.reason, expect); }
  }
});

test('the error path never includes the service key', async () => {
  const f = stubFetch([{ status: 500, body: { message: 'boom' } }]);
  const db = makeDb({ url: 'https://x.supabase.co', serviceKey: 'SECRET-KEY', fetchImpl: f });
  await assert.rejects(
    () => db.read('account_segments?select=user_id'),
    (e) => !String(e.message).includes('SECRET-KEY')
  );
});
