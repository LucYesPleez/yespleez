/**
 * THE DEMO QUEUE — forward, back, and the promise that they are inverses.
 *
 * ⚠⚠ THE OLD QUEUE ATE WHAT IT PLAYED, and nothing was visibly wrong: the
 * player only went forwards, so the discarded entry was never missed. It became
 * a defect the moment a back button existed, and the symptom would have been a
 * demo silently vanishing from the queue — which reads as "it glitched", not as
 * a bug anybody can name.
 *
 * ⭐ Tested here rather than through the player because the preview pane cannot
 * play media at all — position and duration both read 0 — so a test driving the
 * real thing would pass while proving nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, rewind, hasNext, hasPrev } from './playerQueue.js';

const A = { url: 'a', artistName: 'A' };
const B = { url: 'b', artistName: 'B' };
const C = { url: 'c', artistName: 'C' };

/** A queue playing A with B and C waiting. */
const start = () => ({ ...A, playlist: [B, C], played: [] });

test('advancing plays the next demo and remembers the one it left', () => {
  const s = advance(start());
  assert.equal(s.url, 'b');
  assert.deepEqual(s.playlist.map(x => x.url), ['c']);
  assert.deepEqual(s.played.map(x => x.url), ['a']);
});

test('⭐⭐ back and forward are EXACT inverses', () => {
  const q = start();
  const there = advance(q);
  const andBack = rewind(there);
  assert.equal(andBack.url, q.url);
  assert.deepEqual(andBack.playlist.map(x => x.url), q.playlist.map(x => x.url));
  assert.deepEqual(andBack.played.map(x => x.url), q.played.map(x => x.url));
});

test('⚠ the demo stepped back FROM returns to the front of the queue', () => {
  // Otherwise stepping back and forward again would skip it entirely — the
  // "it glitched" symptom.
  const s = rewind(advance(start()));
  assert.deepEqual(s.playlist.map(x => x.url), ['b', 'c']);
  assert.equal(advance(s).url, 'b', 'forward again lands where it started');
});

test('a full walk forward and back returns the original queue', () => {
  let s = start();
  s = advance(s);            // B
  s = advance(s);            // C
  assert.equal(s.url, 'c');
  assert.deepEqual(s.played.map(x => x.url), ['a', 'b']);
  s = rewind(s);             // B
  s = rewind(s);             // A
  assert.equal(s.url, 'a');
  assert.deepEqual(s.playlist.map(x => x.url), ['b', 'c']);
  assert.deepEqual(s.played, []);
});

test('⛔ history does NOT nest — stepping back and forward cannot grow it', () => {
  // A carried `played`/`playlist` on a stored entry would compound every time.
  let s = start();
  for (let i = 0; i < 6; i++) s = i % 2 === 0 ? advance(s) : rewind(s);
  assert.equal(s.played.length <= 1, true, `history grew to ${s.played.length}`);
  s.played.forEach(e => {
    assert.equal(e.played, undefined, 'a remembered entry carries no history of its own');
    assert.equal(e.playlist, undefined, 'nor its own queue');
  });
});

test('⚠ advancing an empty queue returns NULL — the caller closes the player', () => {
  assert.equal(advance({ ...A, playlist: [], played: [] }), null);
  assert.equal(advance(null), null);
});

test('⛔ going back with no history returns the state UNCHANGED, never null', () => {
  // Back at the start of a queue is a restart, which the player handles. If
  // this returned null it would close the player instead — the one moment a
  // listener is most likely to press it.
  const q = start();
  assert.equal(rewind(q), q);
  assert.equal(rewind(null), null);
});

test('the two predicates answer what the buttons need', () => {
  assert.equal(hasNext(start()), true);
  assert.equal(hasPrev(start()), false);
  const s = advance(start());
  assert.equal(hasPrev(s), true);
  assert.equal(hasNext(s), true);
  assert.equal(hasNext(advance(s)), false, 'the last demo has nothing after it');
});
