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


/**
 * Source with comments removed.
 *
 * ⚠ THE GUARANTEES BELOW ARE ABOUT CODE, NOT PROSE. A first version of these
 * tests matched raw source and failed because MiniPlayer's header says it knows
 * nothing about Voiceys — the comment explaining the rule tripped the rule. A
 * test that punishes documentation is worse than the defect it guards.
 *
 * String-aware rather than a regex: stripping // naively would eat the rest of
 * any line containing a url, taking real code with it.
 */
const BACKSLASH = String.fromCharCode(92);
const NEWLINE   = String.fromCharCode(10);

function code(src) {
  let out = '', i = 0, quote = null;
  while (i < src.length) {
    const c = src[i], next = src[i + 1];
    if (quote) {
      if (c === BACKSLASH) { i += 2; continue; }   // escaped char, never a delimiter
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && next === '/') { while (i < src.length && src[i] !== NEWLINE) i++; continue; }
    if (c === '/' && next === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

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

// ── PHASE 2 · THE MINIPLAYER IS THE LONG SOURCE ───────────────────────

const miniPlayer = readFileSync(new URL('../components/MiniPlayer.jsx', import.meta.url), 'utf8');

test('MiniPlayer registers with the media session manager', () => {
  assert.match(miniPlayer, /from '\.\.\/lib\/mediaSession'/);
  assert.match(miniPlayer, /createResumableSource/,
    'resumability comes from the shared factory, not from bespoke logic here');
});

test('⚠ MiniPlayer knows NOTHING about short-form media', () => {
  // The whole point of the layering: adding Spotify or a livestream must never
  // require editing interruption policy, and this component must never grow an
  // opinion about what interrupted it.
  const mp = code(miniPlayer);
  for (const forbidden of ['Voicey', 'voicey', 'SHORT', 'finishAudio']) {
    assert.ok(!mp.includes(forbidden),
      `MiniPlayer references ${forbidden} — interruption policy has leaked into a provider`);
  }
});

test('⚠ the manager contains no provider-specific logic', () => {
  const manager = code(readFileSync(new URL('./mediaSession.js', import.meta.url), 'utf8'));
  for (const forbidden of ['SoundCloud', 'soundcloud', 'Mixcloud', 'mixcloud', 'iframe', 'postMessage']) {
    assert.ok(!manager.includes(forbidden),
      `mediaSession references ${forbidden} — every new provider would need arbitration edited`);
  }
});

test('MiniPlayer claims audio when playback starts', () => {
  assert.match(miniPlayer, /claimAudio\(/);
});

test('⚠ MiniPlayer releases rather than finishes on a manual pause', () => {
  // finishAudio would resume whatever this had interrupted — but a LONG source
  // interrupts nothing, and pausing it is a request for silence.
  assert.match(miniPlayer, /releaseAudio\(/);
  assert.ok(!code(miniPlayer).includes('finishAudio'));
});

test('⚠ resume waits on readiness, never on a timer', () => {
  const providers = code(readFileSync(new URL('./mediaProviders.js', import.meta.url), 'utf8'));
  assert.match(providers, /await whenReady\(\)/);
  assert.ok(!/setTimeout/.test(providers),
    'a timer-driven resume is too slow on a bad connection and dead air on a good one');
});

// ── DEMO MIX PROVIDER MODEL ───────────────────────────────────────────

const registrySrc = code(readFileSync(new URL('./demoMixProviders.js', import.meta.url), 'utf8'));

test('⚠ MiniPlayer builds no embed urls and no adapters of its own', () => {
  const mp = code(miniPlayer);
  // ⚠ SCOPED TO WHAT ACTUALLY MOVED. The SoundCloud widget API script is still
  // loaded here — that is attachment, covered by the known-gap test below, and
  // asserting against it would be claiming a guarantee this work did not
  // deliver. What DID move is embed-url construction and adapter creation.
  for (const leak of ['auto_play=true', 'widget/iframe', 'soundcloudAdapter', 'mixcloudAdapter']) {
    assert.ok(!mp.includes(leak),
      `MiniPlayer constructs ${leak} — that belongs to the provider registry`);
  }
  assert.match(mp, /providerFor\(/, 'it resolves a provider rather than testing the url itself');
});

test('the registry is the single place a provider is declared', () => {
  for (const id of ['soundcloud', 'mixcloud', 'upload']) {
    assert.ok(registrySrc.includes(`'${id}'`), `${id} must be registered`);
  }
});

/**
 * ⚠ KNOWN GAP, DELIBERATELY RECORDED RATHER THAN HIDDEN.
 *
 * Embed-url construction and adapter creation have moved to the registry, so a
 * new provider no longer touches those. ATTACHMENT has not: the SoundCloud
 * widget binding, the Mixcloud postMessage listener and the per-provider oEmbed
 * endpoint still live in MiniPlayer behind `isSC` / `isMC`.
 *
 * So the amendment's promise — "adding a provider requires no changes to
 * MiniPlayer" — is NOT yet fully true, and this test asserts the CURRENT state
 * so nobody mistakes partial progress for a finished guarantee. When attachment
 * moves into the provider interface, this test should start failing and be
 * replaced by its opposite.
 */
test('⚠ attachment logic is STILL provider-specific — the guarantee is incomplete', () => {
  const mp = code(miniPlayer);
  assert.ok(mp.includes('isSC') || mp.includes('isMC'),
    'if this now fails, attachment has been moved into the providers — delete this test and assert the opposite');
});
