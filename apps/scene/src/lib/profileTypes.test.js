/**
 * RENDERING AN IDENTITY AND OFFERING A ROLE ARE DIFFERENT QUESTIONS.
 *
 * `profileTypes.js` answered both from one object until 2026-08-06, and nothing
 * exposed that until the platform grew an identity Scene must DRAW but must not
 * OFFER. A festival is created and administered in the Festival Portal; Scene
 * meets one when it owns a public event, sends a message, or is followed.
 *
 * Both directions of the split fail badly and quietly:
 *
 *   too narrow — a festival renders as UNKNOWN_PROFILE: grey, labelled
 *   "PROFILE", no image. That is the "something upstream is broken" state, and
 *   nothing is broken. It looks like a rendering fault forever.
 *
 *   too wide — festival reaches SCENE_ROLE_ORDER and every user is offered a
 *   FESTIVAL filter chip in FollowingSection and a festival colour and label in
 *   My Scene, for an identity Scene cannot create.
 *
 * ⛔ The eight festival ROLES (volunteer, market stall, food vendor, workshop,
 * decor, media, theme camp, performance artist) belong to the Portal's own
 * registry and must appear in NEITHER list. That split is what structurally
 * prevents vendors leaking into Scene's discovery — Scene has never heard of
 * them, so it cannot show them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_TYPES, SCENE_ROLE_ORDER, UNKNOWN_PROFILE, PUNTER_PROFILE, profileIdentity,
} from './profileTypes.js';

const SCENE_ROLES = ['venue', 'host', 'artist', 'band', 'standup'];

/** Roles the Festival Portal owns. Scene must not know how to draw these. */
const PORTAL_ROLES = [
  'volunteer', 'market_stall', 'food_vendor', 'workshop',
  'decor', 'media', 'theme_camp', 'performance_artist',
];

test('SCENE_ROLE_ORDER is exactly Scene\'s five roles, venue first', () => {
  assert.deepEqual(SCENE_ROLE_ORDER, SCENE_ROLES,
    'Venue-first is the canonical discovery order and several screens inherit ' +
    'it by iteration. A new entry here is offered to every user as something ' +
    'they can become — if you only needed it to RENDER, add it to ' +
    'PLATFORM_TYPES instead.');
});

test('a festival RENDERS with its own identity, not as unknown', () => {
  const festival = profileIdentity('festival');
  assert.notEqual(festival, UNKNOWN_PROFILE,
    'A festival resolving to UNKNOWN_PROFILE is the live bug this split fixed: ' +
    'Deliverance Festival rendered grey and unlabelled anywhere Scene showed it.');
  assert.equal(festival.label, 'FESTIVAL');
  assert.equal(festival.accent, '#BF5FFF', 'must match CATEGORY_BADGES.FESTIVAL');
  assert.equal(festival.rgb, '191,95,255', 'rgb is derived, never hand-typed');
});

test('...but a festival is NOT one of Scene\'s roles', () => {
  assert.ok(!SCENE_ROLE_ORDER.includes('festival'),
    'Scene renders festivals; it does not offer to create one. Including it ' +
    'here puts a FESTIVAL filter chip in front of every user.');
});

test('Scene has never heard of the Portal\'s eight festival roles', () => {
  for (const role of PORTAL_ROLES) {
    assert.ok(!(role in PROFILE_TYPES),
      `${role} belongs to the Festival Portal's registry. Scene not knowing it ` +
      'is what stops it reaching Scene discovery — that guarantee is structural ' +
      'and this is where it would be lost.');
    assert.ok(!SCENE_ROLE_ORDER.includes(role));
    assert.equal(profileIdentity(role), UNKNOWN_PROFILE);
  }
});

test('every renderable type carries a full token set', () => {
  // A half-filled entry does not throw — it renders `undefined` into a CSS
  // string, which browsers drop silently. The result is an identity with no
  // colour and no explanation.
  for (const [type, t] of Object.entries(PROFILE_TYPES)) {
    for (const field of ['accent', 'accent2', 'muted', 'label', 'shortLabel', 'gradient']) {
      assert.ok(t[field], `PROFILE_TYPES.${type}.${field} is missing`);
    }
    for (const field of ['rgb', 'accent2Rgb', 'mutedRgb']) {
      assert.match(t[field], /^\d{1,3},\d{1,3},\d{1,3}$/,
        `PROFILE_TYPES.${type}.${field} must be derived from the hex`);
    }
  }
});

test('unknown and punter stay outside both lists', () => {
  // Punter is a real, complete identity with no industry role; unknown is the
  // broken state. Folding either into the role registry would offer it as a
  // choice — and PROFILE_TYPES is a rendering map, which is why punter has its
  // own constant rather than an entry.
  assert.ok(!('punter' in PROFILE_TYPES));
  assert.ok(!SCENE_ROLE_ORDER.includes('punter'));
  assert.equal(profileIdentity('punter'), PUNTER_PROFILE);
  assert.equal(profileIdentity(null), UNKNOWN_PROFILE);
  assert.equal(profileIdentity('nonsense'), UNKNOWN_PROFILE);
});
