import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PROVIDERS, providerFor, providerById } from './demoMixProviders.js';
import { createResumableSource } from './mediaProviders.js';
import { LONG } from './mediaSession.js';

/** The callback bag every provider is handed. Nothing here asserts on it. */
const noopOn = { play() {}, pause() {}, finish() {}, metadata() {} };

/**
 * A Demo Mix is a logical media type. These prove the registry can resolve one
 * without anybody asking which platform it came from.
 */

test('a SoundCloud address resolves to the SoundCloud provider', () => {
  assert.equal(providerFor('https://soundcloud.com/artist/set').id, 'soundcloud');
});

test('a Mixcloud address resolves to the Mixcloud provider', () => {
  assert.equal(providerFor('https://www.mixcloud.com/artist/show/').id, 'mixcloud');
});

test('⚠ a direct audio FILE is a YesPleez upload — a PEER, not a fallback', () => {
  // An artist who uses no third-party platform is not a degraded case.
  const p = providerFor('https://storage.example/conv/abc.mp3');
  assert.equal(p.id, 'upload');
  assert.equal(p.surface, 'audio');
});

test('⚠ an unsupported LINK matches nothing, so nothing renders', () => {
  // A Spotify/Bandcamp/YouTube url is a page, not an audio file. It used to
  // fall through to the upload provider and produce a broken silent <audio>.
  // Now it resolves to null and MiniPlayer draws nothing — honest until those
  // providers exist.
  for (const link of [
    'https://open.spotify.com/track/abc',
    'https://artist.bandcamp.com/track/song',
    'https://www.youtube.com/watch?v=abc',
    'https://music.apple.com/us/album/x/123',
  ]) {
    assert.equal(providerFor(link), null, `${link} must not resolve to a player`);
  }
});

test('a YesPleez storage url is an upload even without an extension', () => {
  assert.equal(providerFor('https://doqz.supabase.co/storage/v1/object/sign/message-files/x').id, 'upload');
});

test('no url resolves to nothing rather than guessing', () => {
  assert.equal(providerFor(null), null);
  assert.equal(providerFor(''), null);
});

test('a captured session can be resolved back by its stored id', () => {
  for (const p of PROVIDERS) assert.equal(providerById(p.id).id, p.id);
  assert.equal(providerById('spotify'), null, 'an unknown provider is null, not a crash');
});

// ── THE INTERFACE IS UNIFORM ─────────────────────────────────────────

test('⚠ every provider implements the whole interface', () => {
  // The promise is that adding a provider needs no changes anywhere else. That
  // only holds if each one is complete — a provider missing `embedUrl` would
  // force a branch back into the player.
  for (const p of PROVIDERS) {
    assert.equal(typeof p.id, 'string', `${p.id}: id`);
    assert.equal(typeof p.label, 'string', `${p.id}: label`);
    assert.equal(typeof p.matches, 'function', `${p.id}: matches`);
    assert.equal(typeof p.embedUrl, 'function', `${p.id}: embedUrl`);
    // `attach` replaced `createAdapter`: a provider now owns its own widget
    // creation, listeners, metadata and readiness, not just its primitives.
    assert.equal(typeof p.attach, 'function', `${p.id}: attach`);
    assert.ok(['iframe', 'audio'].includes(p.surface), `${p.id}: surface must be renderable`);
  }
});

test('⚠ upload is asked LAST, so a platform url is never mistaken for a file', () => {
  // Upload no longer matches everything, but a SoundCloud CDN could still end
  // in a matchable extension, so order still matters: the named providers must
  // be consulted first.
  assert.equal(PROVIDERS[PROVIDERS.length - 1].id, 'upload', 'upload must be asked last');
  assert.equal(providerFor('https://soundcloud.com/a/b').id, 'soundcloud',
    'a platform url must never fall through to upload');
  assert.equal(providerFor('https://www.mixcloud.com/a/b/').id, 'mixcloud');
});

// ── AN UPLOAD IS A FULLY RESUMABLE LONG SOURCE ───────────────────────

test('⚠ a direct upload composes into a LONG source like any other', async () => {
  // The whole point: a media element and a SoundCloud widget are
  // indistinguishable to the manager.
  const el = {
    currentTime: 0, readyState: 4, paused: true, playCount: 0,
    play() { this.playCount++; this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    addEventListener() {},
  };
  el.currentTime = 61.5;

  const provider = providerFor('https://storage.example/mix.mp3');
  const { adapter } = provider.attach({ el, url: 'https://storage.example/mix.mp3', on: noopOn });
  const source = createResumableSource(adapter);

  assert.equal(source.kind, LONG);

  source.pause();
  assert.equal(el.paused, true);
  assert.equal(source.parkedState().positionMs, 61_500, 'seconds converted to ms in the adapter');

  await source.resume();
  // Compared with a tolerance rather than an equality: the round trip is
  // seconds → ms → seconds, and asserting an exact float here tests JavaScript's
  // rounding rather than the adapter's behaviour.
  assert.ok(Math.abs(el.currentTime - 61.5) < 0.01, `restored to ${el.currentTime}, expected ~61.5`);
  assert.equal(el.playCount, 1);
});

test('⚠ an upload waits for metadata before seeking', async () => {
  // Setting currentTime on an unloaded element is silently discarded, which
  // would resume from the beginning rather than not at all.
  let fire;
  const el = {
    currentTime: 0, readyState: 0, playCount: 0,
    play() { this.playCount++; return Promise.resolve(); },
    pause() {},
    addEventListener: (_e, cb) => { fire = cb; },
  };

  const provider = providerFor('https://storage.example/mix.mp3');
  const { adapter } = provider.attach({ el, url: 'x', on: noopOn });
  const source = createResumableSource(adapter);

  source.pause();
  source.parkedState().positionMs = 30_000;
  const resumed = source.resume();

  await Promise.resolve();
  assert.equal(el.playCount, 0, 'must not play before metadata exists');

  fire();
  await resumed;
  assert.equal(el.playCount, 1);
});

test('embed urls are built per provider, and an upload plays its own url', () => {
  assert.match(providerById('soundcloud').embedUrl('https://soundcloud.com/a/b'), /w\.soundcloud\.com\/player/);
  assert.match(providerById('mixcloud').embedUrl('https://www.mixcloud.com/a/b/'), /widget\/iframe/);
  assert.equal(providerById('upload').embedUrl('https://storage.example/x.mp3'), 'https://storage.example/x.mp3');
});

/* ── what actually reaches the player · feedback #10 ───────────────── */

const SC = PROVIDERS.find(p => p.id === 'soundcloud');

/** The exact value stored on the Cosmatik profile, byte for byte. */
const COSMATIK_SHARE_TEXT =
  'Listen to Cosmatik @ Sub Terra 2023 by Cosmatik on #SoundCloud https://on.soundcloud.com/RiYsQ3kiKVMkPrhjdQ';

/** What the widget is actually asked to load. */
const embedded = url => decodeURIComponent(/[?&]url=([^&]+)/.exec(SC.embedUrl(url))[1]);

test('⭐⭐ THE EMBED CARRIES THE URL, NOT THE SENTENCE — the #10 failure', () => {
  // Before: ?url=Listen%20to%20Cosmatik%20%40%20Sub%20Terra%202023%20…
  assert.equal(embedded(COSMATIK_SHARE_TEXT), 'https://on.soundcloud.com/RiYsQ3kiKVMkPrhjdQ');
});

test('⛔ REGRESSION — no whitespace may survive into the player URL', () => {
  const inner = embedded(COSMATIK_SHARE_TEXT);
  assert.ok(!/\s/.test(inner), `the player was handed "${inner.slice(0, 40)}…"`);
  assert.ok(!inner.startsWith('https://Listen'), 'the sentence reached the player');
});

test('⛔⛔ PROSE MENTIONING THE DOMAIN IS NOT A PROVIDER MATCH', () => {
  // Otherwise it opens a player that can never load anything.
  assert.equal(providerFor('I love soundcloud.com so much'), null);
  assert.equal(providerFor('check out my soundcloud.com page'), null);
});

test('the share text still MATCHES — it does own a real link', () => {
  assert.equal(providerFor(COSMATIK_SHARE_TEXT)?.id, 'soundcloud');
});

test('every shape that worked before still works', () => {
  assert.equal(providerFor('https://soundcloud.com/luc-bruen/dragon-24')?.id, 'soundcloud');
  assert.equal(providerFor('https://on.soundcloud.com/d9H1MbeRsJFLkSOqjg')?.id, 'soundcloud');
  assert.equal(providerFor('https://www.mixcloud.com/someone/a-set/')?.id, 'mixcloud');
  assert.equal(embedded('https://soundcloud.com/a/b'), 'https://soundcloud.com/a/b');
});

test('⚠ UPLOADED AUDIO HAS A PROVIDER, though no demo mix uses one today', () => {
  // Checked against production: 7 mix_link values, 6 soundcloud and 1 YouTube.
  // Nothing exercises this path yet, so it is covered here rather than assumed.
  assert.equal(providerFor('https://x.supabase.co/storage/v1/object/sign/d/mix.mp3')?.id, 'upload');
  assert.equal(providerFor('https://example.com/set.mp3')?.id, 'upload');
});

test('⛔ A LINK WITH NO IN-APP SURFACE STILL HAS NO PROVIDER', () => {
  // One real profile stores a YouTube link; opening it in a tab is correct.
  assert.equal(providerFor('https://youtube.com/watch?v=abc123'), null);
  assert.equal(providerFor(''), null);
  assert.equal(providerFor(null), null);
});
