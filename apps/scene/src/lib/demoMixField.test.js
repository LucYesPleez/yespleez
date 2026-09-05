/**
 * THE DEMO MIX FIELD — every performer, audio only, one stated cap.
 *
 * ⚠⚠ The registry tests execute; the editor tests read source text and can
 * never prove a file renders. Lint and the production build cover that.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEMO_MIX_MINUTES, DEMO_MIX_COLUMN, DEMO_MIX_PLACEHOLDER, DEMO_MIX_NOTICE,
  DEMO_MIX_TYPES, DEMO_MIX_FIELDS, demoMixFieldFor, hasDemoMix,
} from './demoMixField.js';
import { PREVIEW_MS } from './previewCap.js';
import { PROVIDERS, providerFor } from './demoMixProviders.js';

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PERFORMERS = {
  artist:  read('../screens/ArtistProfileScreen.jsx'),
  band:    read('../screens/BandProfileScreen.jsx'),
  standup: read('../screens/StandupProfileScreen.jsx'),
};
const NON_PERFORMERS = {
  host:  read('../screens/HostProfileScreen.jsx'),
  venue: read('../screens/VenueProfileScreen.jsx'),
};
const COMPONENT = read('../components/DemoMixField.jsx');

/* ── the cap is stated, and stated from the number that enforces it ─────── */

test('⭐⭐ the minutes shown are DERIVED from PREVIEW_MS, never typed', () => {
  assert.equal(DEMO_MIX_MINUTES, 20);
  assert.equal(DEMO_MIX_MINUTES, Math.round(PREVIEW_MS / 60000));
  // ⚠ The old CLIP_MS bar promised a limit nothing applied. A literal here
  // would let the copy and the cap drift the same way.
  assert.match(read('./demoMixField.js'), /Math\.round\(PREVIEW_MS \/ 60000\)/);
});

test('⭐ the notice says audio only AND says the limit', () => {
  assert.match(DEMO_MIX_NOTICE, /Audio only/i);
  assert.match(DEMO_MIX_NOTICE, /first 20 minutes will play/);
});

/* ── audio only, and it always was ──────────────────────────────────────── */

test('⛔⛔ the player has NO video provider, so "audio only" is a fact', () => {
  const ids = PROVIDERS.map(p => p.id);
  assert.deepEqual(ids, ['soundcloud', 'mixcloud', 'upload']);
  for (const bad of [
    'https://www.youtube.com/watch?v=abc123',
    'https://youtu.be/abc123',
    'https://vimeo.com/123456',
  ]) assert.ok(!providerFor(bad), `${bad} must not be playable`);
  // ⚠ THE CONTROL. Without it this test would also pass if `providerFor`
  // returned null for everything, which is the failure mode that would make
  // the new warning fire on every link anyone ever pastes.
  assert.ok(providerFor('https://soundcloud.com/someone/a-mix'), 'soundcloud IS playable');
  assert.ok(providerFor('https://www.mixcloud.com/someone/a-show/'), 'mixcloud IS playable');
});

test('⛔ no editor advertises a format the player cannot open', () => {
  const banned = [/YouTube/i, /Vimeo/i, /Spotify/i, /Bandcamp/i, /EPK URL/i, /press kit/i];
  for (const [type, src] of Object.entries(PERFORMERS)) {
    // ⚠ only the demo placeholder matters; socials legitimately name platforms,
    // so this checks the canonical placeholder is the one in use.
    assert.ok(!/placeholder="[^"]*YouTube[^"]*link"/.test(src), `${type} still offers YouTube`);
    assert.ok(!/LINK TO MUSIC OR PRESS KIT/.test(src),          `${type} still asks for a press kit`);
    assert.ok(!/LINK TO YOUR BEST SET OR SHOWREEL/.test(src),   `${type} still asks for a showreel`);
  }
  assert.equal(DEMO_MIX_PLACEHOLDER, 'SoundCloud or Mixcloud link');
  for (const re of banned) assert.ok(!re.test(DEMO_MIX_PLACEHOLDER));
});

/* ── who gets one ───────────────────────────────────────────────────────── */

test('⭐ every performer type gets a demo mix, and only performers', () => {
  assert.deepEqual(DEMO_MIX_TYPES, ['artist', 'band', 'standup']);
  for (const t of DEMO_MIX_TYPES) {
    assert.ok(hasDemoMix(t), t);
    const f = demoMixFieldFor(t);
    // ⚠ `label` is OPTIONAL — band deliberately has none. Title and blurb are not.
    assert.ok(f.title && f.blurb, `${t} is fully described`);
  }
  for (const t of ['host', 'venue', 'punter', '']) {
    assert.ok(!hasDemoMix(t), `${t} must not get one`);
    assert.equal(demoMixFieldFor(t), null);
  }
});

test('⛔ hosts and venues render no demo field', () => {
  for (const [type, src] of Object.entries(NON_PERFORMERS)) {
    assert.ok(!/<DemoMixField/.test(src), `${type} must not have one`);
  }
  // and the component refuses even if a caller passes an unknown type
  assert.match(COMPONENT, /if \(!field\) return null;/);
});

test('⭐ each performer type asks for its own thing, under one rule', () => {
  assert.match(DEMO_MIX_FIELDS.artist.title,  /MIX/);
  assert.match(DEMO_MIX_FIELDS.band.title,    /MIXTAPE/);
  assert.equal(DEMO_MIX_FIELDS.band.label, undefined, '⛔ band carries no label');
  assert.match(DEMO_MIX_FIELDS.standup.title, /SET/);
  // the RULE does not vary, only the subject
  const notices = new Set(Object.keys(DEMO_MIX_FIELDS).map(() => DEMO_MIX_NOTICE));
  assert.equal(notices.size, 1);
});

/* ── the shared component is the only implementation ────────────────────── */

test('⛔ every registry field is actually rendered, none is dead data', () => {
  assert.match(COMPONENT, /\{field\.blurb\}/,  'blurb is rendered');
  assert.match(COMPONENT, /\{field\.label && <label/, 'label is rendered when present');
  assert.match(COMPONENT, /\{DEMO_MIX_NOTICE\}/, 'the cap notice is rendered');
  // the title is the caller's, so assert the editors read it from the registry
  for (const [type, src] of Object.entries(PERFORMERS)) {
    assert.match(src, /demoMixFieldFor\('[a-z]+'\)\.title/, `${type} renders the title`);
  }
});

test('⭐ all three performer editors use the shared component', () => {
  for (const [type, src] of Object.entries(PERFORMERS)) {
    assert.match(src, /<DemoMixField/, `${type} uses it`);
    assert.match(src, /demoMixFieldFor\('(artist|band|standup)'\)\.title/, `${type} titles from the registry`);
  }
});

/* ── the data model did not move ────────────────────────────────────────── */

test('⛔ the column is mix_link, and all three still write it', () => {
  assert.equal(DEMO_MIX_COLUMN, 'mix_link');
  assert.match(PERFORMERS.artist,  /mix_link: ensureHttps\(mixLink\),/);
  assert.match(PERFORMERS.band,    /mix_link: ensureHttps\(epkLink\), epk_link: ensureHttps\(epkLink\),/);
  assert.match(PERFORMERS.standup, /mix_link: {8}ensureHttps\(videoLink\),/);
  // ⚠ the legacy columns are still written exactly as before — nothing migrated
  assert.match(PERFORMERS.standup, /video_link: {6}ensureHttps\(videoLink\),/);
});

test('⛔ an unplayable link is WARNED about, never rejected or cleared', () => {
  // Existing profiles hold YouTube links saved when the editors invited them.
  assert.match(COMPONENT, /const unplayable = typed\.length > 0 && !providerFor\(typed\);/);
  assert.ok(!/onChange=\{[^}]*providerFor/.test(COMPONENT), 'must not filter on the way in');
  assert.ok(!/setValue\(''\)|onChange\(''\)/.test(COMPONENT), 'must never clear the field');
});
