import { buildPriorities, derivePhase } from './priorities.js';
import assert from 'node:assert';
import { test } from 'node:test';

const now = new Date('2026-08-07T10:00:00');
const ev = o => ({ id: 'e1', name: 'Echo Valley 2026', isPublic: false, applicationsOpen: false, startsOn: null, endsOn: null, ...o });
const cat = o => ({ key: 'music', label: 'Music', appliesAs: ['artist'], state: 'closed', closesAt: null, ...o });

test('no event → one item, and it is the only thing that matters', () => {
  const r = buildPriorities({ event: null, now });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'no-event');
});

test('calm state is reachable — empty means nothing needs you', () => {
  const r = buildPriorities({ event: ev(), categories: [cat()], now });
  assert.deepEqual(r, []);
});

test('broken outranks everything, including unreleased decisions', () => {
  const r = buildPriorities({
    event: ev({ applicationsOpen: true }), categories: [cat({ state: 'closed' })],
    pendingRelease: 9, awaitingReview: 40, now,
  });
  assert.equal(r[0].id, 'broken-no-open-category');
});

test('unreleased decisions outrank volume', () => {
  const r = buildPriorities({
    event: ev({ applicationsOpen: true }), categories: [cat({ state: 'open' })],
    pendingRelease: 1, awaitingReview: 300, now,
  });
  assert.equal(r[0].id, 'pending-release');
  assert.equal(r[1].id, 'awaiting-review');
});

test('an open category nobody can apply to is BROKEN, not a warning', () => {
  const r = buildPriorities({
    event: ev({ applicationsOpen: true }),
    categories: [cat({ state: 'open' }), cat({ key: 'decor', label: 'Decor', appliesAs: [], state: 'open' })],
    now,
  });
  assert.equal(r[0].id, 'broken-no-eligible-profile');
  assert.match(r[0].signal, /Decor/);
});

test('every item has signal, reason, action and exactly one destination', () => {
  const r = buildPriorities({
    event: ev({ applicationsOpen: true, isPublic: true }),
    categories: [cat({ state: 'open', closesAt: '2026-08-09' }), cat({ key: 'decor', label: 'Decor', appliesAs: [], state: 'open' })],
    pendingRelease: 3, awaitingReview: 12, oldestSubmittedAt: '2026-07-19T10:00:00Z', now,
  });
  assert.ok(r.length >= 4);
  for (const i of r) {
    assert.ok(i.signal && i.reason && i.actionLabel && i.to, `incomplete: ${i.id}`);
    assert.ok(!('dismissed' in i), 'items must not carry dismissal state');
  }
});

test('age drives the reason, not the count', () => {
  const r = buildPriorities({
    event: ev({ applicationsOpen: true }), categories: [cat({ state: 'open' })],
    awaitingReview: 2, oldestSubmittedAt: '2026-07-19T10:00:00Z', now,
  });
  assert.match(r[0].reason, /19 days/);
});

test('phase gates eligibility: a draft cannot have a closing deadline', () => {
  const r = buildPriorities({
    event: ev({ applicationsOpen: false }),
    categories: [cat({ state: 'open', closesAt: '2026-08-08' })], now,
  });
  assert.equal(r.find(i => i.id === 'closing-soon'), undefined);
});

test('derivePhase', () => {
  assert.equal(derivePhase({ event: null, now }), 'no_event');
  assert.equal(derivePhase({ event: ev(), now }), 'draft');
  assert.equal(derivePhase({ event: ev({ applicationsOpen: true }), now }), 'applications_open');
  assert.equal(derivePhase({ event: ev({ startsOn: '2026-08-06', endsOn: '2026-08-09' }), now }), 'event_live');
  assert.equal(derivePhase({ event: ev({ startsOn: '2026-07-01', endsOn: '2026-07-04' }), now }), 'completed');
});
