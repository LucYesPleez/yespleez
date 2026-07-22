import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * THE WIRING CONTRACT.
 *
 * `mediaSession.test.js` proves the manager's policy with fake sources. It
 * cannot prove that a real player USES it correctly — a component that forgets
 * `finishAudio` passes every manager test and silently never resumes the music.
 * That is the failure this file exists to catch, and it is invisible except to
 * someone listening.
 *
 * Asserting on source text is the established pattern here; see
 * `messageKindContract.test.js`, which guards the double-tap the same way.
 */

const read = f => readFileSync(new URL(`../components/${f}`, import.meta.url), 'utf8');

const PLAYERS = [
  ['VoiceMessage.jsx', read('VoiceMessage.jsx')],
  ['FileMessage.jsx',  read('FileMessage.jsx')],
];

for (const [name, src] of PLAYERS) {
  test(`${name} arbitrates through the media session manager`, () => {
    assert.match(src, /from '\.\.\/lib\/mediaSession'/,
      'a second arbitration singleton means two players can sound at once');
    assert.ok(!src.includes('voicePlayback'),
      'voicePlayback is retired — it could not see sources claimed through mediaSession');
  });

  test(`${name} registers as a SHORT source`, () => {
    assert.match(src, /kind:\s*SHORT/,
      'a message player declared LONG would be parked and resumed like a demo mix');
  });

  test(`${name} claims before playing`, () => {
    assert.match(src, /claimAudio\(/);
  });

  test(`⚠ ${name} calls finishAudio on ended — this is what resumes the music`, () => {
    assert.match(src, /onEnded=\{[^}]*finishAudio\(/,
      'without this a Voicey pauses a demo mix forever');
  });

  test(`⚠ ${name} does not release on a natural finish`, () => {
    // Some browsers fire `pause` alongside `ended`. Releasing first clears the
    // claim, so finishAudio finds nothing to resume and the music stays dead.
    assert.match(src, /onPause=\{[^}]*\.ended\)?\s*releaseAudio\(|onPause=\{[^}]*!\w+\.currentTarget\.ended/,
      'onPause must be guarded on `ended` before it calls releaseAudio');
  });

  test(`${name} releases on unmount, so a dead component frees audio`, () => {
    assert.match(src, /releaseAudio\(/);
  });

  test(`⚠ ${name} holds ONE stable source object`, () => {
    // A new object per render makes every claim look like a different source,
    // defeating the guards that stop a stale release clearing a newer claim.
    assert.match(src, /sessionRef\s*=\s*useRef\(/);
    assert.match(src, /if \(!sessionRef\.current\)/,
      'built once, not on every render');
  });
}

test('no component talks to the retired module', () => {
  for (const [name, src] of PLAYERS) {
    assert.ok(!/claimPlayback|releasePlayback/.test(src), `${name} still uses the old API`);
  }
});
