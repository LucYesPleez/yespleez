/**
 * A PROFILE TYPE MUST **ASK** TO BE A PERFORMER.
 *
 * ⛔⛔ THE BUG WAS A NEGATIVE LIST. `preferPerformer` filtered with
 * `.neq('type','punter').not('type','in','("host","venue")')`, which does not
 * say "a performer" — it says "not these three". `PLATFORM_TYPES.festival`
 * exists in lib/profileTypes.js and was never added to that list, so a legacy
 * `/profile/:userId?prefer=performer` link on an account that owns both a
 * festival and an act could resolve to the FESTIVAL and render it as the act.
 *
 * ⚠ It fails silently in the worst way: a real row comes back, the page
 * renders, and nothing anywhere says the wrong profile was chosen.
 *
 * ⭐ `lib/venueEventsFeed` already argues this exact point — "'not punter' is
 * a rule about the ONE type that must never be published, and it silently
 * accepts the other five" — and the reasoning had not been carried here.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

/** Records the filter the resolver applied, and returns nothing. */
const calls = [];
function builder() {
  const q = {
    select: () => q,
    eq:  (col, val) => { calls.push(['eq', col, val]);  return q; },
    in:  (col, val) => { calls.push(['in', col, val]);  return q; },
    neq: (col, val) => { calls.push(['neq', col, val]); return q; },
    not: (col, op, val) => { calls.push(['not', col, op, val]); return q; },
    limit: async () => ({ data: [] }),
  };
  return q;
}
mock.module('./supabase', { exports: { supabase: { from: () => builder() } } });

const { resolveProfileRoute, profileUrl } = await import('./profileResolution.js');
const { PERFORMER_TYPES } = await import('./actingProfile.js');

test('⛔⛔ preferPerformer filters by a POSITIVE list, ⛔ never by exclusion', async () => {
  calls.length = 0;
  await resolveProfileRoute('u-123', { preferPerformer: true });

  const positive = calls.filter(c => c[0] === 'in' && c[1] === 'type');
  assert.ok(positive.length > 0, 'the filter must name the types it wants');
  for (const [, , types] of positive) assert.deepEqual(types, PERFORMER_TYPES);

  assert.ok(!calls.some(c => c[0] === 'neq' || c[0] === 'not'),
    'no exclusion clause may survive on the performer path');
});

test('⛔ `festival` is not a performer, and neither is any other platform type', () => {
  for (const t of ['festival', 'host', 'venue', 'punter', 'personal']) {
    assert.ok(!PERFORMER_TYPES.includes(t), `${t} must not be resolvable as an act`);
  }
  assert.deepEqual(PERFORMER_TYPES, ['artist', 'band', 'standup']);
});

test('⚠ without preferPerformer the old broad filter is unchanged', async () => {
  /* This path is "show me whoever this id is, unless they are a punter", which
     is a different question — ⛔ do not tighten it here by accident. */
  calls.length = 0;
  await resolveProfileRoute('u-123');
  assert.ok(calls.some(c => c[0] === 'neq' && c[1] === 'type' && c[2] === 'punter'));
});

test('a typed filter still wins over both', async () => {
  calls.length = 0;
  await resolveProfileRoute('u-123', { typeFilter: 'venue', preferPerformer: true });
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'type' && c[2] === 'venue'));
  assert.ok(!calls.some(c => c[0] === 'in'), 'an explicit type is not a preference');
});

test('profileUrl carries the type when there is one', () => {
  assert.equal(profileUrl({ id: 'p1', type: 'band' }), '/profile/p1?type=band');
  assert.equal(profileUrl({ id: 'p1' }), '/profile/p1');
  assert.equal(profileUrl({}), null);
});
