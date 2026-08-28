import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailySeries } from '../lib/daily.js';

const row = (iso, over) => ({ name: 'opened_app', device_id: 'd', user_id: null, session_id: 's-' + iso, created_at: iso, ...over });

test('events bucket by the SYDNEY day, not the UTC slice', () => {
  // 2026-08-20T20:00Z is 06:00 on 21 Aug in Sydney (+10). A UTC slice
  // would file it under the 20th — the exact dates-law bug.
  const out = dailySeries([row('2026-08-20T20:00:00Z')], {
    population: 'public', segments: {}, linkedDevices: new Set(),
    fromDay: '2026-08-20', toDay: '2026-08-21',
  });
  assert.equal(out.find((d) => d.day === '2026-08-20').metrics.events, 0);
  assert.equal(out.find((d) => d.day === '2026-08-21').metrics.events, 1);
});

test('a quiet day is a zero row, never a gap', () => {
  const out = dailySeries([row('2026-08-20T02:00:00Z'), row('2026-08-22T02:00:00Z')], {
    population: 'public', segments: {}, linkedDevices: new Set(),
    fromDay: '2026-08-20', toDay: '2026-08-22',
  });
  assert.equal(out.length, 3);
  assert.equal(out[1].day, '2026-08-21');
  assert.equal(out[1].metrics.events, 0);
});

test('the daily metrics ARE the canonical metrics — same classifier, same shapes', () => {
  const seg = { users: { 'u-int': 'internal' }, devices: {} };
  const rows = [
    row('2026-08-20T02:00:00Z', { user_id: 'u-int' }),   // internal — excluded from public
    row('2026-08-20T03:00:00Z', { user_id: 'u-pub' }),
  ];
  const out = dailySeries(rows, {
    population: 'public', segments: seg, linkedDevices: new Set(),
    fromDay: '2026-08-20', toDay: '2026-08-20',
  });
  assert.equal(out[0].metrics.events, 1);
  assert.equal(out[0].metrics.authenticated_people, 1);
  assert.equal('sessions_null_rows' in out[0].metrics, true, 'denominators travel with days too');
});

test('weekday labels come from the Sydney calendar', () => {
  const out = dailySeries([], {
    population: 'public', segments: {}, linkedDevices: new Set(),
    fromDay: '2026-08-24', toDay: '2026-08-24', // a Monday
  });
  assert.equal(out[0].weekday, 'Mon');
});
