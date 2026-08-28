import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAttributionParams, coalesceTouches, attributionStrength, funnel, MEDIUMS } from '../lib/attribution.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// ── parsing ──────────────────────────────────────────────────────────

test('the poster case: ?src=bar_qr parses with medium inferred from the convention', () => {
  const p = parseAttributionParams('?src=bar_qr&c=rel-aug-launch&pl=front-window&cr=v2-gold');
  assert.deepEqual(p, { source: 'bar_qr', medium: 'qr', campaign: 'rel-aug-launch', placement: 'front-window', creative: 'v2-gold' });
});

test('no src means no touch — null, never a junk row', () => {
  assert.equal(parseAttributionParams('?c=campaign-alone'), null);
  assert.equal(parseAttributionParams(''), null);
});

test('an explicit medium wins; an invalid one falls back to the convention', () => {
  assert.equal(parseAttributionParams('?src=ig_bio&m=share').medium, 'share');
  assert.equal(parseAttributionParams('?src=ig_bio&m=billboard').medium, 'link');
  assert.equal(parseAttributionParams('?src=poster_qr&m=billboard').medium, 'qr');
});

test('params are sanitised to tokens — injection and noise cannot enter the vocabulary', () => {
  assert.equal(parseAttributionParams('?src=bar qr'), null);          // space
  assert.equal(parseAttributionParams("?src=bar'--"), null);           // quoting
  const long = parseAttributionParams('?src=' + 'a'.repeat(100));
  assert.equal(long.source.length, 64);
});

// ── coalescing ───────────────────────────────────────────────────────

test('repeat scans coalesce to one reporting line; raw rows stay countable', () => {
  const t = (over) => ({ campaign: 'rel', source: 'bar_qr', medium: 'qr', device_id: 'd1', session_id: 's1', platform: 'ios', created_at: '2026-08-01T10:00:00Z', ...over });
  const out = coalesceTouches([t(), t({ session_id: 's2', created_at: '2026-08-03T10:00:00Z' }), t({ device_id: 'd2' })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].touches, 3);
  assert.equal(out[0].devices, 2);
  assert.equal(out[0].sessions, 2);
  assert.equal(out[0].first_seen, '2026-08-01T10:00:00Z');
  assert.equal(out[0].last_seen, '2026-08-03T10:00:00Z');
});

// ── strength ─────────────────────────────────────────────────────────

const TOUCHES = [{ device_id: 'dev-scan', session_id: 'sess-scan' }];
const LINKS = [{ device_id: 'dev-scan', user_id: 'u-artist' }, { device_id: 'dev-home', user_id: 'u-artist' }];

test('same session → session-attributed (the strongest, chosen first)', () => {
  assert.equal(attributionStrength({ device_id: 'dev-scan', session_id: 'sess-scan' }, TOUCHES, LINKS), 'session-attributed');
});

test('same device, days later → device-attributed', () => {
  assert.equal(attributionStrength({ device_id: 'dev-scan', session_id: 'sess-later' }, TOUCHES, LINKS), 'device-attributed');
});

test('the person on ANOTHER device, through an explicit link → person-attributed', () => {
  assert.equal(attributionStrength({ device_id: 'dev-home', session_id: 's9', user_id: 'u-artist' }, TOUCHES, LINKS), 'person-attributed');
});

test('an ANONYMOUS row on another device is unattributed — resolution never claims anonymous authorship', () => {
  assert.equal(attributionStrength({ device_id: 'dev-home', session_id: 's9', user_id: null }, TOUCHES, LINKS), 'unattributed');
});

test('a stranger is unattributed', () => {
  assert.equal(attributionStrength({ device_id: 'dev-x', session_id: 'sx', user_id: 'u-other' }, TOUCHES, LINKS), 'unattributed');
});

// ── funnel ───────────────────────────────────────────────────────────

test('a funnel splits every stage by strength, and totals are the sum of named parts', () => {
  const events = [
    { name: 'screen_view', props_path: '/event/rel', device_id: 'dev-scan', session_id: 'sess-scan', user_id: null, platform: 'ios' },
    { name: 'screen_view', props_path: '/event/rel', device_id: 'dev-scan', session_id: 'later', user_id: null, platform: 'ios' },
    { name: 'applied', device_id: 'dev-home', session_id: 's9', user_id: 'u-artist', platform: 'desktop' },
    { name: 'applied', device_id: 'stranger', session_id: 'sz', user_id: 'u-other', platform: 'android' },
  ];
  const stages = funnel(TOUCHES, events, LINKS, [
    { key: 'event_view', match: (e) => e.name === 'screen_view' && e.props_path?.startsWith('/event/') },
    { key: 'applied', match: (e) => e.name === 'applied' },
  ]);
  assert.equal(stages[0].attributed_events, 2);
  assert.deepEqual(stages[0].by_strength, { 'session-attributed': 1, 'device-attributed': 1, 'person-attributed': 0 });
  assert.equal(stages[1].attributed_events, 1, "the stranger's application is not in the funnel");
  assert.deepEqual(stages[1].by_strength, { 'session-attributed': 0, 'device-attributed': 0, 'person-attributed': 1 });
  const sum = Object.values(stages[0].by_strength).reduce((a, b) => a + b, 0);
  assert.equal(stages[0].attributed_events, sum);
});

test('iOS stages carry the storage-sandbox caveat; platform split is always present', () => {
  const events = [{ name: 'applied', device_id: 'dev-scan', session_id: 'sess-scan', user_id: null, platform: 'ios' }];
  const [stage] = funnel(TOUCHES, events, LINKS, [{ key: 'applied', match: (e) => e.name === 'applied' }]);
  assert.equal(stage.by_platform.ios, 1);
  assert.match(stage.ios_caveat, /lower bound/);
});

// ── migration contract ───────────────────────────────────────────────

const migrations = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations');
const av4 = readFileSync(join(migrations, '20260828000006_av4_attribution_touches.sql'), 'utf8');

test('AV4: A1 asymmetry verbatim — insert-only for clients, no read path', () => {
  assert.match(av4, /FOR INSERT/);
  assert.match(av4, /WITH CHECK \(user_id IS NULL OR user_id = auth\.uid\(\)\)/);
  assert.match(av4, /GRANT INSERT ON public\.attribution_touches TO anon, authenticated/);
  assert.doesNotMatch(av4, /CREATE POLICY[^;]*FOR (SELECT|UPDATE|DELETE)/);
});

test('AV4: the medium CHECK matches the module vocabulary exactly', () => {
  assert.match(av4, new RegExp("medium IN \\(" + MEDIUMS.map((m) => "'" + m + "'").join(', ').replace(/[()]/g, '\\$&')));
});

test('AV4: lives in public with the documented deviation, keeping the analytics schema sealed', () => {
  assert.match(av4, /public\.attribution_touches/);
  assert.doesNotMatch(av4, /CREATE TABLE[^;]*analytics\.attribution_touches/);
  assert.match(av4, /deviation from the Blueprint/i);
});

test('AV4: no IP, user-agent or geolocation', () => {
  assert.doesNotMatch(av4, /\bip_address\b|\buser_agent\b|\bgeolocation\b|\binet\b/i);
});
