/**
 * BAND ACT TYPE — "what kind of act am I booking?"
 *
 * A free-text BAND TYPE box asked this in prose. Across 53 band profiles ONE
 * was filled in, and it held "Jazz / Blues" — a genre, typed into the act-type
 * field. Chips replace it, using the same role-key mechanism ARTIST_ROLES and
 * PERFORMANCE_ROLES already use.
 *
 * ⛔⛔ THE KEYS LIVE INSIDE `genre_string`, which is shared with genres,
 * subgenres and vibes. The load-bearing property is that they can never be
 * printed AS a genre — the `dj_prod` leak, which reached a real lineup card.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BAND_ROLES, VISIBLE_BAND_ROLES, ARTIST_ROLES, PERFORMANCE_ROLES,
  BAND_GENRES, BAND_SUBGENRES, BAND_VIBES,
  genreLabels, selectedBandRoleLabels,
  selectedArtistRoleLabels, selectedPerformanceRoleLabels,
  GENRE_SEP,
} from './profileTaxonomy.js';

/* ── 1-2 · the vocabulary is exactly V1 ──────────────────────────────────── */

test('1 · BAND_ROLES contains exactly the five approved keys, in order', () => {
  assert.deepEqual(BAND_ROLES.map(r => r.key), ['solo', 'duo', 'trio', 'band', 'ensemble']);
});

test('2 · the labels are exactly the approved display strings', () => {
  assert.deepEqual(BAND_ROLES.map(r => r.label), ['SOLO', 'DUO', 'TRIO', 'BAND', 'ENSEMBLE']);
});

test('⛔ V1 adds nothing else — no quartet, no instruments, no genres', () => {
  const banned = ['quartet', 'pianist', 'guitarist', 'vocalist', 'vocals', 'guitar',
    'piano', 'keys', 'bass', 'drums', 'singer/songwriter', 'instrumentalist',
    'acoustic', 'rock', 'jazz', 'blues'];
  const present = BAND_ROLES.flatMap(r => [r.key.toLowerCase(), r.label.toLowerCase()]);
  for (const b of banned) assert.ok(!present.includes(b), `${b} must not be in V1`);
  assert.equal(BAND_ROLES.length, 5);
});

test('⭐ it follows the established shape — key, label, enabled + a VISIBLE list', () => {
  for (const r of BAND_ROLES) {
    assert.equal(typeof r.key, 'string');
    assert.equal(typeof r.label, 'string');
    assert.equal(typeof r.enabled, 'boolean');
    assert.equal(r.label, r.label.toUpperCase(), 'CAPS at the source, like PERFORMANCE_ROLES');
  }
  assert.deepEqual(VISIBLE_BAND_ROLES, BAND_ROLES.filter(r => r.enabled));
});

test('⛔⛔ ENSEMBLE is RETIRED but its key still drops from genres', () => {
  /* Owner, 2026-09-05: no longer offered. ⚠ The row is kept `enabled: false`
     rather than deleted, because deleting it would drop `ensemble` from
     ALL_ROLE_KEYS and any profile already holding the key would start printing
     it as a genre — the `dj_prod` leak, reintroduced by a tidy-up. */
  assert.ok(!VISIBLE_BAND_ROLES.some(r => r.key === 'ensemble'), 'not offered');
  assert.deepEqual(VISIBLE_BAND_ROLES.map(r => r.key), ['solo', 'duo', 'trio', 'band']);
  assert.ok(BAND_ROLES.some(r => r.key === 'ensemble'), 'the key is still known');
  assert.deepEqual(genreLabels(['ensemble', 'Rock'].join(GENRE_SEP)), ['Rock'], 'still dropped');
  // and a profile that already stored it still reads back as ENSEMBLE
  assert.deepEqual(selectedBandRoleLabels('ensemble'), ['ENSEMBLE']);
});

/* ── 3-4 · multi-select, and it survives a round trip ────────────────────── */

test('3 · more than one act type can be selected', () => {
  const stored = ['solo', 'duo'].join(GENRE_SEP);
  assert.deepEqual(selectedBandRoleLabels(stored), ['SOLO', 'DUO']);
});

test('4 · act-type keys survive a save/load round trip alongside a full profile', () => {
  // Exactly what BandProfileScreen writes: acts, then genres, subs, vibes.
  const saved = [...['solo', 'trio'], ...['Rock', 'Blues'], ...['Original']].join(GENRE_SEP);
  const parts = new Set(saved.split(/,\s*|\s+·\s+/).map(x => x.trim()).filter(Boolean));
  assert.deepEqual(BAND_ROLES.filter(r => parts.has(r.key)).map(r => r.key), ['solo', 'trio']);
  assert.deepEqual(selectedBandRoleLabels(saved), ['SOLO', 'TRIO']);
});

/* ── 5-6 · ⛔⛔ the genre boundary ────────────────────────────────────────── */

test('5 · existing genres remain intact beside act-type keys', () => {
  const saved = ['solo', 'Rock', 'Blues', 'Original'].join(GENRE_SEP);
  assert.deepEqual(genreLabels(saved), ['Rock', 'Blues', 'Original']);
});

test('6 · ⛔⛔ NO act-type key can ever print as a genre', () => {
  /* The `dj_prod` leak: role keys stored in genre_string were printed raw on a
     lineup card's GENRES row. Every key must be in ALL_ROLE_KEYS. */
  for (const { key } of BAND_ROLES) {
    const out = genreLabels([key, 'Rock'].join(GENRE_SEP));
    assert.deepEqual(out, ['Rock'], `${key} leaked into genre output`);
  }
});

test('⛔ and no act-type key collides with a real band taxonomy value', () => {
  // A collision would make a genre undroppable — or drop a real genre.
  const values = new Set([...BAND_GENRES, ...BAND_SUBGENRES, ...BAND_VIBES].map(v => String(v).toLowerCase()));
  for (const { key } of BAND_ROLES) {
    assert.ok(!values.has(key.toLowerCase()), `${key} collides with a taxonomy value`);
  }
});

/* ── 7-8 · the other roles are untouched ─────────────────────────────────── */

test('7 · existing Artist roles still work, and still drop from genres', () => {
  assert.deepEqual(ARTIST_ROLES.map(r => r.key), ['dj_prod', 'mc']);
  assert.deepEqual(selectedArtistRoleLabels(['dj_prod', 'Techno'].join(GENRE_SEP)), ['DJ / PROD.']);
  assert.deepEqual(genreLabels(['dj_prod', 'Techno'].join(GENRE_SEP)), ['Techno']);
});

test('8 · existing Comedy / Poetry roles still work', () => {
  assert.deepEqual(PERFORMANCE_ROLES.map(r => r.key), ['comedy', 'poetry']);
  assert.deepEqual(selectedPerformanceRoleLabels(['comedy', 'Improv'].join(GENRE_SEP)), ['COMEDY']);
  assert.deepEqual(genreLabels(['comedy', 'Improv'].join(GENRE_SEP)), ['Improv']);
});

test('⛔ the readers do not cross over', () => {
  // A band's keys must not surface as artist roles, or vice versa.
  assert.deepEqual(selectedArtistRoleLabels('solo · duo'), []);
  assert.deepEqual(selectedBandRoleLabels('dj_prod · mc'), []);
  assert.deepEqual(selectedPerformanceRoleLabels('solo'), []);
});

/* ── 9-11 · existing data keeps working ──────────────────────────────────── */

test('9 · a band with no act type selected renders nothing, not a blank', () => {
  assert.deepEqual(selectedBandRoleLabels('Rock · Blues'), []);
  assert.deepEqual(selectedBandRoleLabels(''), []);
  assert.deepEqual(selectedBandRoleLabels(null), []);
  assert.deepEqual(selectedBandRoleLabels(undefined), []);
});

test('10 · legacy band_type data cannot break anything here', () => {
  /* The one populated row holds "Jazz / Blues". ⛔ It is NOT migrated and NOT
     interpreted as an act type — it lives in its own column and this taxonomy
     never sees it. Even if it were fed in, it selects nothing. */
  assert.deepEqual(selectedBandRoleLabels('Jazz / Blues'), []);
  assert.deepEqual(genreLabels('Jazz / Blues'), ['Jazz / Blues']);
});

test('11 · card_pills are a separate column and are not touched by any of this', () => {
  // card_pills is user-chosen sound description; act type is identity. The
  // taxonomy readers here only ever look at genre_string.
  assert.deepEqual(genreLabels('solo · Rock'), ['Rock']);
  assert.deepEqual(selectedBandRoleLabels('solo · Rock'), ['SOLO']);
});

/* ── 12 · the event/category taxonomy is a different concept entirely ────── */

test('12 · ⛔ Live Music terminology is untouched by the act-type work', () => {
  // 'Live Music' is an event/discovery category. It must not appear in, or be
  // affected by, the profile-role act-type vocabulary.
  const labels = BAND_ROLES.map(r => r.label.toLowerCase());
  assert.ok(!labels.includes('live music'));
  assert.ok(!labels.some(l => l.includes('live')));
  // And a profile string mentioning it keeps it as an ordinary genre token.
  assert.deepEqual(genreLabels('solo · Live Music'), ['Live Music']);
});
