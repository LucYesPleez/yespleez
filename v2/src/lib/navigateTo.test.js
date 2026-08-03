/**
 * NAVIGATION HAND-OFF — tests
 *
 * ── WHY THESE EARN THEIR KEEP ────────────────────────────────────────
 *
 * This is a control whose entire job is to LEAVE the app, and every failure is
 * silent on the device it matters on. You cannot see an Android chooser from a
 * desktop browser, and you cannot see iOS ignoring `geo:` from anywhere at all.
 *
 *   1. ANDROID GETS `geo:` — the only scheme that produces the OS app chooser.
 *      If this ever becomes an https URL, the chooser is gone and Waze/OsmAnd
 *      users are silently forced into whatever claims the link.
 *   2. iOS NEVER GETS `geo:` — it routes nothing and the tap does nothing.
 *      This is the single worst outcome and the easiest mistake to make while
 *      "simplifying" the platform branch away.
 *   3. iPadOS REPORTS ITSELF AS A MAC. Without the touch check it falls to the
 *      desktop branch, which is wrong on a device people hold.
 *   4. COORDINATES BEAT THE ADDRESS. A typed address is re-geocoded by the
 *      receiving app and can land on a different "Church St".
 *   5. NOWHERE TO GO → null, so the caller renders no link rather than one
 *      that opens a map of the ocean.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navigationUrl, isAndroid, isIOS } from './navigateTo.js';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile';
const IPHONE  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120';

const AT = { lat: -30.4547, lng: 152.8983, label: 'Bellingen Memorial Hall' };

test('ANDROID gets a geo: intent — the only thing that shows the app chooser', () => {
  const url = navigationUrl({ ...AT, agent: ANDROID });
  assert.ok(url.startsWith('geo:0,0?q='), `expected a geo: intent, got ${url}`);
  assert.ok(decodeURIComponent(url).includes('-30.4547,152.8983'));
  assert.ok(decodeURIComponent(url).includes('(Bellingen Memorial Hall)'), 'the pin should be named');
});

test('iOS NEVER gets geo: — it routes nothing and the tap would do nothing', () => {
  const url = navigationUrl({ ...AT, agent: IPHONE });
  assert.ok(!url.startsWith('geo:'), 'geo: fails silently on iOS');
  assert.ok(url.startsWith('https://maps.apple.com/?daddr='));
  assert.ok(decodeURIComponent(url).includes('-30.4547,152.8983'));
});

test('iPadOS masquerades as a Mac and must still be treated as iOS', () => {
  const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
  assert.equal(isIOS(IPAD, 0), false, 'without touch points it is a real Mac');
  assert.equal(isIOS(IPAD, 5), true, 'a touch-capable "Mac" is an iPad');
  assert.equal(isIOS(IPHONE, 0), true, 'an iPhone says so outright');
});

test('desktop and unknown agents get the web map', () => {
  const url = navigationUrl({ ...AT, agent: DESKTOP });
  assert.ok(url.startsWith('https://www.google.com/maps/dir/?api=1&destination='));
  assert.equal(isAndroid(DESKTOP), false);
  assert.equal(isIOS(DESKTOP), false);
});

test('coordinates beat the address on every platform', () => {
  for (const agent of [ANDROID, IPHONE, DESKTOP]) {
    const url = decodeURIComponent(navigationUrl({ ...AT, address: '32 Hyde St, Bellingen', agent }));
    assert.ok(url.includes('-30.4547,152.8983'), `coords should win on ${agent.slice(0, 20)}`);
    assert.ok(!url.includes('Hyde'), 'the address must not be the destination when coords exist');
  }
});

test('the address is used only when there are no coordinates', () => {
  const url = navigationUrl({ address: '32 Hyde St, Bellingen NSW', agent: DESKTOP });
  assert.ok(decodeURIComponent(url).includes('32 Hyde St, Bellingen NSW'));
});

test('nowhere to go yields null, so the caller renders no link', () => {
  assert.equal(navigationUrl({ agent: DESKTOP }), null);
  assert.equal(navigationUrl({ address: '   ', agent: DESKTOP }), null);
  assert.equal(navigationUrl({ lat: -30.45, agent: DESKTOP }), null, 'half a coordinate is nowhere');
  assert.equal(navigationUrl(), null);
});
