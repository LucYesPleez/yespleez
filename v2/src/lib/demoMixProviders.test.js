import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PROVIDERS, providerFor, providerById } from './demoMixProviders.js';
import { createResumableSource } from './mediaProviders.js';
import { LONG } from './mediaSession.js';

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

test('⚠ anything else is a YesPleez upload — a PEER, not a fallback', () => {
  // An artist who uses no third-party platform is not a degraded case.
  const p = providerFor('https://storage.example/conv/abc.mp3');
  assert.equal(p.id, 'upload');
  assert.equal(p.surface, 'audio');
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
    assert.equal(typeof p.createAdapter, 'function', `${p.id}: createAdapter`);
    assert.ok(['iframe', 'audio'].includes(p.surface), `${p.id}: surface must be renderable`);
  }
});

test('⚠ the catch-all provider is LAST, or it would swallow the others', () => {
  // `upload.matches` accepts ANY url — that is what makes it the catch-all, so
  // asserting it does not match a platform address would be asserting the
  // opposite of the design. ORDER is the protection, so order is what is
  // tested: the named providers are asked first, and resolution proves it.
  assert.equal(PROVIDERS[PROVIDERS.length - 1].id, 'upload', 'the broad test must be asked last');
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
  const source = createResumableSource(
    provider.createAdapter({ el, url: 'https://storage.example/mix.mp3' })
  );

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
  const source = createResumableSource(provider.createAdapter({ el, url: 'x' }));

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
