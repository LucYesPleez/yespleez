import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setTimesEnabled, setTimesAnswered, withSetTimesEnabled } from './eventSetTimes.js';

/**
 * ⭐⭐ ABSENT MEANS "BEHAVE EXACTLY AS TODAY". There is ⛔ no backfill, so every
 * one of the 90 existing events must keep the shape it has right now: the old
 * derivation was "are there slots".
 */
test('⛔ an event that has never answered falls back to the OLD derivation', () => {
  assert.equal(setTimesEnabled({}, 5), true,  'has slots → set times, as today');
  assert.equal(setTimesEnabled({}, 0), false, 'no slots → none, as today');
  assert.equal(setTimesEnabled(null, 3), true);
  assert.equal(setTimesEnabled({ config: {} }, 0), false);
});

/**
 * ⛔⛔ ONCE STATED, THE STORED ANSWER WINS — including `true` at zero slots.
 * That is the whole point: "I want a running order, I just have not built it
 * yet" was indistinguishable from "this event has none".
 */
test('⛔⛔ a stored answer beats the slot count, in BOTH directions', () => {
  assert.equal(setTimesEnabled({ config: { set_times_enabled: true } }, 0), true,
    'enabled with no slots yet is a real, previously unrepresentable state');
  assert.equal(setTimesEnabled({ config: { set_times_enabled: false } }, 9), false,
    'disabled while slots still exist is exactly what makes it reversible');
});

test('setTimesAnswered distinguishes stated from inferred', () => {
  assert.equal(setTimesAnswered({ config: { set_times_enabled: false } }), true);
  assert.equal(setTimesAnswered({ config: { set_times_enabled: true } }), true);
  assert.equal(setTimesAnswered({ config: {} }), false);
  assert.equal(setTimesAnswered(null), false);
});

/* ⚠ Anything that is not a real boolean is NOT an answer. */
test('⚠ a junk value is treated as unanswered, ⛔ not as true', () => {
  assert.equal(setTimesEnabled({ config: { set_times_enabled: 'yes' } }, 0), false);
  assert.equal(setTimesEnabled({ config: { set_times_enabled: 1 } }, 0), false);
  assert.equal(setTimesAnswered({ config: { set_times_enabled: 'yes' } }), false);
});

/**
 * ⛔ MERGE, ⛔ NEVER REPLACE. `config` also carries days, poster, venue and
 * `set_times_locked` — a caller building a fresh object would drop the lot.
 */
test('⛔ the config patch preserves everything else', () => {
  const cfg = { days: [{ name: 'Fri' }], poster: 'p.jpg', set_times_locked: true };
  const next = withSetTimesEnabled(cfg, false);
  assert.deepEqual(next.days, cfg.days);
  assert.equal(next.poster, 'p.jpg');
  assert.equal(next.set_times_locked, true);
  assert.equal(next.set_times_enabled, false);
  assert.notEqual(next, cfg, 'a new object, ⛔ not a mutation');
});

test('the patch coerces to a real boolean', () => {
  assert.equal(withSetTimesEnabled({}, 1).set_times_enabled, true);
  assert.equal(withSetTimesEnabled({}, undefined).set_times_enabled, false);
  assert.equal(withSetTimesEnabled(null, true).set_times_enabled, true);
});
