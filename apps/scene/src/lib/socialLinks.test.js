import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSocialValue, socialProfileUrl, socialHandle } from './socialLinks.js';

/**
 * BANDCAMP IS THE ONE PLATFORM WHOSE HANDLE IS A SUBDOMAIN.
 *
 * Every other entry in PLATFORMS puts the handle in the path, so the shared
 * strip-the-domain logic works on all of them. Bandcamp does not:
 * `yourband.bandcamp.com`, never `bandcamp.com/yourband`. Before the
 * `subdomain` flag it was wrong in BOTH directions and neither was visible —
 * a pasted URL kept the entire host as the handle and rebuilt as
 * `bandcamp.com/yourband.bandcamp.com`, and a bare handle rebuilt as
 * `bandcamp.com/yourband`, which IS a real Bandcamp page, just not the
 * artist's. A link that 404s reads as a broken profile; a link that opens the
 * wrong page reads as correct.
 *
 * ⚠ THE ROUND TRIP IS THE PROPERTY UNDER TEST, not the intermediate handle.
 * What the editor stores and what the profile opens have to agree no matter
 * which of the accepted input shapes was typed, which is the same contract
 * every other platform here has.
 */
const BANDCAMP_INPUTS = [
  'https://yourband.bandcamp.com',
  'http://yourband.bandcamp.com',
  'yourband.bandcamp.com',
  'www.yourband.bandcamp.com',
  'yourband.bandcamp.com/',
  // A deep link to one release still identifies the artist — the path is
  // dropped rather than carried into the handle.
  'yourband.bandcamp.com/album/first-demo',
  'https://yourband.bandcamp.com/track/b-side?from=embed',
  'yourband',
  '@yourband',
];

for (const input of BANDCAMP_INPUTS) {
  test(`bandcamp: ${input} round-trips to the artist's own subdomain`, () => {
    assert.equal(normalizeSocialValue('bandcamp', input), 'yourband');
    assert.equal(socialProfileUrl('bandcamp', input), 'https://yourband.bandcamp.com');
    assert.equal(socialHandle('bandcamp', input), 'yourband');
  });
}

test('bandcamp: absence and refusal are preserved, not turned into a link', () => {
  assert.equal(normalizeSocialValue('bandcamp', ''), '');
  assert.equal(socialProfileUrl('bandcamp', ''), '');
  // 'N/A' is the explicit decline the editors write; it must never become a URL.
  assert.equal(normalizeSocialValue('bandcamp', 'N/A'), 'N/A');
  assert.equal(socialProfileUrl('bandcamp', 'N/A'), '');
});

/**
 * ⚠ THE CONTROL. `subdomain` is a per-platform flag, so the risk of adding it
 * is that it changes someone else's URL shape. These are the three structural
 * variants the map contains — plain path, fixed path prefix, and an @-prefix —
 * and none of them may move.
 */
test('the subdomain flag does not touch path-based platforms', () => {
  assert.equal(socialProfileUrl('instagram', 'https://instagram.com/foo'), 'https://instagram.com/foo');
  assert.equal(socialProfileUrl('linkedin', 'linkedin.com/in/foo'), 'https://linkedin.com/in/foo');
  assert.equal(socialProfileUrl('tiktok', '@foo'), 'https://tiktok.com/@foo');
  assert.equal(socialProfileUrl('beatport', 'www.beatport.com/artist/x/1'), 'https://beatport.com/artist/x/1');
});

/**
 * SPOTIFY HAS NO HANDLE, WHICH IS WHY THE EDITORS ASK FOR THE URL.
 *
 * `artist/<id>` is the stored value and the path is load-bearing. A bare id
 * cannot be repaired here — `open.spotify.com/<id>` is what it means — so this
 * pins the shape the placeholder asks for and documents the shape it does not.
 */
test('spotify keeps the artist path, and drops the ?si tracking param', () => {
  const url = 'https://open.spotify.com/artist/3TVXtAsR1Inumwj472S9r4?si=abc123';
  assert.equal(normalizeSocialValue('spotify', url), 'artist/3TVXtAsR1Inumwj472S9r4');
  assert.equal(socialProfileUrl('spotify', url),
    'https://open.spotify.com/artist/3TVXtAsR1Inumwj472S9r4');
});
