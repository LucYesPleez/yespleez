import test from 'node:test';
import assert from 'node:assert/strict';
import { SPEEDS, nextSpeed, formatSpeed, loadSpeed } from './playbackSpeed.js';

test('the cycle runs 1× → 1.5× → 2× → back to 1×', () => {
  assert.equal(nextSpeed(1), 1.5);
  assert.equal(nextSpeed(1.5), 2);
  assert.equal(nextSpeed(2), 1, 'the cycle wraps rather than sticking at the ceiling');
});

test('an unrecognised speed resets to 1× instead of stranding the control', () => {
  // A stored value from a future build, or corruption, must not leave the
  // button showing something the cycle can never move off.
  assert.equal(nextSpeed(3), 1);
  assert.equal(nextSpeed(undefined), 1);
});

test('the label reads as a multiplier', () => {
  assert.equal(formatSpeed(1), '1×');
  assert.equal(formatSpeed(1.5), '1.5×');
  assert.equal(formatSpeed(2), '2×');
});

test('every offered speed formats and cycles without falling out of the set', () => {
  for (const s of SPEEDS) {
    assert.ok(SPEEDS.includes(nextSpeed(s)), `${s} cycles to a member`);
    assert.match(formatSpeed(s), /^\d(\.\d)?×$/);
  }
});

test('loadSpeed defaults to 1× when storage is unavailable or junk', () => {
  // Under node there is no window.localStorage, which is exactly the
  // storage-blocked path (Safari private mode, site data disabled). Playback
  // must not depend on a remembered speed existing.
  assert.equal(loadSpeed(), 1);
});
