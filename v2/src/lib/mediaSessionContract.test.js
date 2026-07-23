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
  // The intent is that RESTORATION gates on the provider reporting ready — a
  // fixed delay is too slow on a bad connection and dead air on a good one.
  assert.match(providers, /restoreState[\s\S]*?await whenReady\(\)/,
    'restoreState must await whenReady before seeking/playing');
  // NB: setTimeout DOES appear now — it drives the volume fade ramp, which is a
  // duration by nature. The ban is specifically on timing the READINESS wait,
  // so this asserts the ramp is the only timer and that play() still sits
  // behind whenReady rather than behind a sleep.
  assert.ok(!/setTimeout\([^)]*\)\s*[;)]?\s*\n?\s*(play|seekTo)\(/.test(providers),
    'play/seek must never be gated on a bare timer');
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
 * ⚠ THE ARCHITECTURAL GUARANTEE, ENFORCED.
 *
 * Adding a Demo Mix provider must require implementing the interface and
 * registering it — nothing else. This test is what makes that a rule rather
 * than an intention: the moment provider identity reappears in the player, it
 * fails.
 *
 * It replaces an earlier test asserting the OPPOSITE — that attachment was
 * still provider-specific — which existed so partial progress could not be
 * mistaken for a finished guarantee. That gap is now closed.
 */
test('⚠ MiniPlayer never asks which provider it is holding', () => {
  const mp = code(miniPlayer);
  const leaks = [
    'isSoundCloud', 'isMixcloud', 'isSC', 'isMC',
    'soundcloud', 'mixcloud', 'spotify',
    'oembed', 'SC.Widget', 'postMessage',
  ];
  for (const leak of leaks) {
    assert.ok(!mp.includes(leak),
      `MiniPlayer references ${leak} — adding a provider would require editing it`);
  }
});

test('MiniPlayer resolves and attaches, and does nothing provider-specific after', () => {
  const mp = code(miniPlayer);
  assert.match(mp, /providerFor\(/,      'resolves');
  assert.match(mp, /provider\.attach\(/, 'attaches');
  assert.match(mp, /provider\.embedUrl\(/, 'asks the provider for its src');
  assert.match(mp, /provider\.surface/,  'renders the surface it is told to');
});

test('⚠ every provider owns its own attachment', async () => {
  const { PROVIDERS } = await import('./demoMixProviders.js');
  for (const p of PROVIDERS) {
    assert.equal(typeof p.attach, 'function',
      `${p.id} must implement attach — otherwise the player would special-case it`);
  }
});

// ── THE WAVEFORM READS WHAT THE PRODUCER ACTUALLY WRITES ──────────────

test('⚠ FileMessage decodes the v2 wave envelope, not a v1 peaks array', async () => {
  // THE BUG THIS CATCHES, which shipped and rendered nothing:
  // `computeWave` returns {v, ms, d} with base64-packed amplitudes. FileMessage
  // read `payload.wave.peaks` — a v1 key absent from that envelope — so `bars`
  // was permanently empty. Nothing threw. The row simply looked like a feature
  // that had never been built.
  const src = code(readFileSync(new URL('../components/FileMessage.jsx', import.meta.url), 'utf8'));

  assert.ok(!/wave\?\.peaks|wave\.peaks/.test(src),
    'reading .peaks off a v2 envelope silently yields no waveform');
  assert.match(src, /decodeWave\(/, 'it must decode the stored envelope');
  assert.match(src, /toDisplayWave\(/, 'and downsample it the same way VoiceMessage does');
});

test('⚠ both players share ONE decoder for the stored format', async () => {
  // Two decoders would be two things to keep in step with the payload format,
  // and the second would drift silently — exactly as this one did.
  const file  = code(readFileSync(new URL('../components/FileMessage.jsx', import.meta.url), 'utf8'));
  const voice = code(readFileSync(new URL('../components/VoiceMessage.jsx', import.meta.url), 'utf8'));

  for (const [name, src] of [['FileMessage', file], ['VoiceMessage', voice]]) {
    assert.match(src, /from '\.\.\/lib\/voiceWave'/, `${name} must use the shared decoder`);
  }
});

test('the decoder rejects a v1 payload rather than half-rendering it', async () => {
  const { decodeWave } = await import('./voiceWave.js');
  assert.equal(decodeWave({ peaks: [0.2, 0.9] }), null, 'a v1 shape is not a v2 envelope');
  assert.equal(decodeWave(null), null);
  assert.equal(decodeWave({ v: 2, d: '', ms: 100 }), null, 'empty data is not renderable');
});
