/**
 * PROFILE ASSET TYPES — tests
 *
 * ── WHY THESE TESTS EARN THEIR KEEP ──────────────────────────────────
 *
 *   1. `key` IS STORED — in `profile_assets.asset_type` and inside every
 *      opportunity's requirement list. Renaming one orphans live files and
 *      silently turns a satisfied requirement into a missing one. This pins the
 *      nine keys so a rename has to be a deliberate act, not a tidy-up.
 *   2. THE PATH IS THE AUTHORIZATION INPUT. Storage RLS reads
 *      `can_act_as(safe_uuid(foldername(name)[1]))` — segment one must be the
 *      profile id. If assetPath() ever stops putting it there, the policy stops
 *      matching and files become unreadable (or worse, readable). Nothing in the
 *      client would throw.
 *   3. ONE REGISTRY, NOT TWO. requirements.js derives its asset keys from this
 *      module. If someone re-declares them there, these tests catch the drift —
 *      the exact failure mode that produced mix_link/epk_link/video_link.
 *   4. `OTHER` IS NOT REQUESTABLE. "We require an Other" is unsatisfiable, and
 *      an unsatisfiable requirement in a tick-list is a trap.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_ASSET_TYPES, ASSET_TYPE_KEYS, ASSET_REQUIREMENT_KEYS,
  assetType, assetLabel, isMulti, assetPath,
  ASSETS_BUCKET, ASSET_MAX_BYTES, ASSET_MIME_TYPES,
} from './profileAssets.js';
import { REQUIREMENT_KEYS } from './requirements.js';

test('the nine stored keys are pinned — renaming one orphans live files', () => {
  assert.deepEqual(ASSET_TYPE_KEYS, [
    'PRESS_KIT', 'STAGE_PLOT', 'TECH_RIDER', 'HOSPITALITY_RIDER', 'PUBLIC_LIABILITY',
    'PROMO_PHOTOS', 'LOGO_PACK', 'MEDIA_KIT', 'OTHER',
  ]);
  assert.equal(new Set(ASSET_TYPE_KEYS).size, ASSET_TYPE_KEYS.length, 'duplicate key');
  for (const t of PROFILE_ASSET_TYPES) {
    assert.ok(t.label, `${t.key} has no label`);
    assert.ok(['single', 'many'].includes(t.cardinality), `${t.key} has a bogus cardinality`);
  }
});

test('promo photos and logo packs are collections; a press kit is one file', () => {
  assert.equal(isMulti('PROMO_PHOTOS'), true);
  assert.equal(isMulti('LOGO_PACK'), true);
  assert.equal(isMulti('OTHER'), true);
  assert.equal(isMulti('PRESS_KIT'), false);
  assert.equal(isMulti('PUBLIC_LIABILITY'), false);
});

test('an unrecognised key is not guessed at', () => {
  assert.equal(assetType('NOPE'), null);
  // ...but it still renders as something rather than an empty row.
  assert.equal(assetLabel('NOPE'), 'NOPE');
  assert.equal(isMulti('NOPE'), false);
});

test('THE PATH IS THE RLS INPUT — segment one is the profile id', () => {
  const path = assetPath('11111111-2222-3333-4444-555555555555', 'PRESS_KIT', 'My Kit.PDF');
  const segments = path.split('/');
  assert.equal(segments[0], '11111111-2222-3333-4444-555555555555',
    'storage RLS reads foldername(name)[1] as the profile id — do not reorder');
  assert.equal(segments[1], 'PRESS_KIT');
  assert.ok(segments[2].endsWith('.pdf'), 'extension is lower-cased');
  assert.equal(segments.length, 3);
});

test('two uploads in the same second do not collide', () => {
  const a = assetPath('p', 'OTHER', 'a.pdf');
  const b = assetPath('p', 'OTHER', 'a.pdf');
  assert.notEqual(a, b);
});

test('a file with no extension still produces a valid path', () => {
  const path = assetPath('p', 'OTHER', 'rider');
  assert.ok(path.endsWith('.bin'));
  assert.equal(path.split('/').length, 3);
});

test('OTHER is not requestable — an unsatisfiable requirement is a trap', () => {
  assert.ok(!ASSET_REQUIREMENT_KEYS.includes('OTHER'));
  assert.equal(ASSET_REQUIREMENT_KEYS.length, 8);
});

test('ONE REGISTRY: requirements.js derives its asset keys from this module', () => {
  for (const key of ASSET_REQUIREMENT_KEYS) {
    const def = REQUIREMENT_KEYS[key];
    assert.ok(def, `${key} is missing from REQUIREMENT_KEYS — the derivation broke`);
    assert.equal(def.kind, 'asset');
    assert.equal(def.section, 'assets', 'a file is always the Assets section (design I6)');
    assert.equal(def.assetType, key);
    assert.equal(def.label, assetLabel(key), 'label drifted from the asset registry');
  }
  assert.ok(!REQUIREMENT_KEYS.OTHER, 'OTHER must not leak into the requirement namespace');
});

test('the bucket is private and its limits are stated once', () => {
  assert.equal(ASSETS_BUCKET, 'profile-assets');
  assert.equal(ASSET_MAX_BYTES, 15728640);
  // No video, no archives — a zip cannot be previewed or trusted.
  assert.ok(!ASSET_MIME_TYPES.some(m => m.startsWith('video/') || m.includes('zip')));
  assert.ok(ASSET_MIME_TYPES.includes('application/pdf'));
});
