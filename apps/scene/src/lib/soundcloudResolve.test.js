/**
 * "IF IT PLAYS ON SOUNDCLOUD, IT PLAYS HERE."
 *
 * ⚠⚠ THE FAILURE THIS GUARDS IS COMPLETELY SILENT. The iframe mounts, is the
 * right size, has auto_play set — and loads a 404. Nothing on the page looks
 * broken, nothing logs, and the only symptom is that a player which appears to
 * be working plays nothing. It sat on a live profile unreported until somebody
 * happened to press it.
 *
 * Measured 2026-08-26 against the exact URL the app builds:
 *   share link     → 404
 *   canonical link → 200
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseSoundcloudInput, isSoundcloud, isShareLink,
  canonicalFromOEmbedHtml, resolveSoundcloud,
} from './soundcloudResolve.js';

const OEMBED_HTML = '<iframe width="100%" height="400" src="https://w.soundcloud.com/player/?visual=true&url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F2211026048&show_artwork=true"></iframe>';

test('⭐ a share link is recognised — it is what the share button hands out', () => {
  assert.equal(isShareLink('https://on.soundcloud.com/d9H1MbeRsJFLkSOqjg'), true);
  assert.equal(isShareLink('https://soundcloud.com/8ballaudio/enlil-mix'), false);
});

test('whatever gets pasted becomes a URL we can ask about', () => {
  assert.equal(normaliseSoundcloudInput('enlildnb'), 'https://soundcloud.com/enlildnb');
  assert.equal(normaliseSoundcloudInput('soundcloud.com/enlildnb'), 'https://soundcloud.com/enlildnb');
  assert.equal(normaliseSoundcloudInput('  https://soundcloud.com/enlildnb  '), 'https://soundcloud.com/enlildnb');
  assert.equal(normaliseSoundcloudInput(''), '');
  assert.equal(normaliseSoundcloudInput(null), '');
});

test('⚠ a bare handle is only assumed when there is no path — never for a URL', () => {
  // "8ballaudio/enlil-mix" has a slash, so it is a path, not a handle.
  assert.equal(normaliseSoundcloudInput('8ballaudio/enlil-mix'), 'https://8ballaudio/enlil-mix');
});

test('the canonical resource is lifted out of the oEmbed iframe', () => {
  assert.equal(canonicalFromOEmbedHtml(OEMBED_HTML), 'https://api.soundcloud.com/tracks/2211026048');
  assert.equal(canonicalFromOEmbedHtml('<iframe src="https://w.soundcloud.com/player/"></iframe>'), '');
  assert.equal(canonicalFromOEmbedHtml(''), '');
  assert.equal(canonicalFromOEmbedHtml(null), '');
});

test('⭐⭐ a share link resolves to something the widget accepts', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ html: OEMBED_HTML, title: 'ENLIL - 8Ball Audio Guest Mix #24' }) });
  const r = await resolveSoundcloud('https://on.soundcloud.com/d9H1MbeRsJFLkSOqjg', { fetchImpl });
  assert.equal(r.url, 'https://api.soundcloud.com/tracks/2211026048');
  assert.equal(r.resolved, true);
  assert.equal(r.title, 'ENLIL - 8Ball Audio Guest Mix #24');
});

test('⛔ oEmbed failing returns the URL UNCHANGED — never worse than before', async () => {
  const dead = async () => { throw new Error('offline'); };
  const r = await resolveSoundcloud('https://soundcloud.com/8ballaudio/enlil-mix', { fetchImpl: dead });
  assert.equal(r.url, 'https://soundcloud.com/8ballaudio/enlil-mix');
  assert.equal(r.resolved, false);

  const notOk = async () => ({ ok: false, json: async () => ({}) });
  const r2 = await resolveSoundcloud('https://soundcloud.com/x/y', { fetchImpl: notOk });
  assert.equal(r2.url, 'https://soundcloud.com/x/y');
  assert.equal(r2.resolved, false);
});

test('⚠ oEmbed answering without an embed url still yields a playable address', async () => {
  const odd = async () => ({ ok: true, json: async () => ({ title: 'Something', html: '<p>no iframe</p>' }) });
  const r = await resolveSoundcloud('https://soundcloud.com/enlildnb', { fetchImpl: odd });
  assert.equal(r.url, 'https://soundcloud.com/enlildnb', 'falls back to the input, not to empty');
  assert.equal(r.resolved, false);
});

test('⛔ a non-SoundCloud address is left completely alone', async () => {
  let called = false;
  const spy = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const r = await resolveSoundcloud('https://youtube.com/watch?v=abc', { fetchImpl: spy });
  assert.equal(called, false, 'no network call for a provider this does not serve');
  assert.equal(r.url, 'https://youtube.com/watch?v=abc');
});

test('isSoundcloud covers the share domain as well as the main one', () => {
  assert.equal(isSoundcloud('https://on.soundcloud.com/abc'), true);
  assert.equal(isSoundcloud('https://soundcloud.com/x'), true);
  assert.equal(isSoundcloud('https://mixcloud.com/x'), false);
});

/* ── pasted share text · feedback #10 ──────────────────────────────── */

/** The exact value stored on the Cosmatik profile, byte for byte. */
const COSMATIK_SHARE_TEXT =
  'Listen to Cosmatik @ Sub Terra 2023 by Cosmatik on #SoundCloud https://on.soundcloud.com/RiYsQ3kiKVMkPrhjdQ';

test('⭐⭐ THE SHARE SHEET GIVES A SENTENCE — the URL inside it is the address', () => {
  assert.equal(
    normaliseSoundcloudInput(COSMATIK_SHARE_TEXT),
    'https://on.soundcloud.com/RiYsQ3kiKVMkPrhjdQ',
  );
});

test('⛔ REGRESSION — the sentence must never become a URL by prefixing a scheme', () => {
  // This is what shipped: `https://Listen to Cosmatik @ Sub Terra 2023 …`,
  // which the widget received URL-encoded and played nothing.
  const out = normaliseSoundcloudInput(COSMATIK_SHARE_TEXT);
  assert.ok(!out.startsWith('https://Listen'), 'the sentence was prefixed with a scheme');
  assert.ok(!/\s/.test(out), 'a URL cannot contain whitespace');
});

test('⛔⛔ PROSE IS NOT AN ADDRESS — mentioning the domain is not owning a link', () => {
  assert.equal(normaliseSoundcloudInput('I love soundcloud.com so much'), '');
  assert.equal(normaliseSoundcloudInput('check my soundcloud.com page out'), '');
  assert.equal(normaliseSoundcloudInput('   '), '');
});

test('the URL wins wherever it sits in the text', () => {
  assert.equal(
    normaliseSoundcloudInput('https://soundcloud.com/a/b — my latest set'),
    'https://soundcloud.com/a/b',
  );
  assert.equal(
    normaliseSoundcloudInput('my latest set: https://soundcloud.com/a/b'),
    'https://soundcloud.com/a/b',
  );
});

test('trailing sentence punctuation is not part of the address', () => {
  assert.equal(normaliseSoundcloudInput('Listen at https://soundcloud.com/a/b.'), 'https://soundcloud.com/a/b');
  assert.equal(normaliseSoundcloudInput('(https://soundcloud.com/a/b)'), 'https://soundcloud.com/a/b');
});

test('every existing shape still normalises as it did', () => {
  // Bare URL — the six profiles that already worked.
  assert.equal(normaliseSoundcloudInput('https://soundcloud.com/luc-bruen/dragon-24-leftfield-1'),
    'https://soundcloud.com/luc-bruen/dragon-24-leftfield-1');
  // The share DOMAIN on its own, which resolveSoundcloud then canonicalises.
  assert.equal(normaliseSoundcloudInput('https://on.soundcloud.com/d9H1MbeRsJFLkSOqjg'),
    'https://on.soundcloud.com/d9H1MbeRsJFLkSOqjg');
  // A bare handle keeps the courtesy the social fields extend.
  assert.equal(normaliseSoundcloudInput('madspinbaby'), 'https://soundcloud.com/madspinbaby');
  // A schemeless address is still an address.
  assert.equal(normaliseSoundcloudInput('soundcloud.com/a/b'), 'https://soundcloud.com/a/b');
});
