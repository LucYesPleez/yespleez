/**
 * REQUIREMENTS ENGINE — tests
 *
 * ── WHY THESE TESTS EARN THEIR KEEP ──────────────────────────────────
 *
 * Every failure mode in this module is a WRONG NUMBER, and a wrong percentage
 * is indistinguishable from a right one by eye. Nothing throws. You would only
 * catch a regression by filling in a profile completely and noticing it still
 * said 88%, which is exactly how the band/comedy ceiling survived until the
 * 2026-08 audit.
 *
 *   1. THE OLD CLOSURES ARE THE ORACLE. The three field lists this module
 *      replaces are reproduced verbatim below and run against the same
 *      fixtures. artist/host/venue must agree to the decimal — that is the
 *      design's I4 ("no user loses anything") enforced rather than asserted.
 *      If you change a key list or a predicate for those types, this fails.
 *   2. THE CEILING IS GONE. A fully-filled comedy profile reaches 100%. Under
 *      the old shared list it maxed out at 76% because it was scored on four
 *      columns its editor never writes. This is the bug the module exists for.
 *   3. `'N/A'` IS NOT MISSING. Declining a social completes it; leaving a bio
 *      blank does not. R1 (Absent ≠ Withheld) lives or dies here.
 *   4. `has_abn: false` COUNTS. It is falsy but it IS an answer — the single
 *      easiest predicate to break, and it silently costs every user a point.
 *   5. EVERY TICKED ITEM BLOCKS, field or asset (2026-08-03 override of
 *      design §5.2 — the owner wants a mandatory press kit to actually gate
 *      a submission). Only an UNRECOGNISED key stays non-blocking. If this
 *      reverts, a host's mandatory upload becomes silently optional.
 *   6. AN UNKNOWN KEY NEITHER VANISHES NOR TRAPS. A venue's requirement must
 *      not disappear, and a stale key must not block an applicant forever.
 *   7. EVERY COMPLETION KEY RESOLVES. A typo'd key would score as permanently
 *      absent and cap that type below 100% — the original bug, re-entering by
 *      the back door.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, completionFor, COMPLETION_KEYS, COMPLETION_COLUMNS, REQUIREMENT_KEYS, REQUESTABLE_KEYS, SECTIONS, requestableBySection, requirementLabel, snapshotEvaluation, columnsFor, FESTIVAL_ROLE_REQUESTABLE_KEYS } from './requirements.js';
import { ASSET_REQUIREMENT_KEYS } from './profileAssets.js';

// ── The oracles: the exact closures this module replaced ──────────────
// ArtistDashboard.jsx:330, HostDashboard.jsx:327, VenueDashboard.jsx:193 as of
// 2026-08-02. Copied byte-for-byte, including HostDashboard's plain `Boolean`.

function oldArtistPct(profile) {
  const filled = v => !!(v && v !== 'N/A');
  const done   = v => !!(v === 'N/A' || (v && v.trim && v.trim()));
  const fields = [
    filled(profile.name), filled(profile.avatar), filled(profile.location),
    filled(profile.sound), filled(profile.tagline), filled(profile.bio),
    filled(profile.genre_string), filled(profile.mix_link), filled(profile.card_pills),
    filled(profile.fee_type), filled(profile.emergency_name),
    profile.has_abn !== null && profile.has_abn !== undefined,
    done(profile.soundcloud), done(profile.mixcloud), done(profile.instagram),
    done(profile.youtube), done(profile.facebook),
  ];
  return fields.filter(Boolean).length / fields.length * 100;
}

function oldHostPct(profile) {
  return [profile.name, profile.avatar, profile.location, profile.sound, profile.tagline,
    profile.genre_string, profile.bio, profile.website].filter(Boolean).length / 8 * 100;
}

function oldVenuePct(profile) {
  const filled = v => !!(v && v !== 'N/A');
  const done   = v => !!(v === 'N/A' || (v && String(v).trim()));
  const fields = [
    filled(profile.name), filled(profile.avatar), filled(profile.location), filled(profile.state),
    filled(profile.venue_type), filled(profile.capacity), filled(profile.sound),
    filled(profile.tagline), filled(profile.bio), filled(profile.genre_string),
    done(profile.website), done(profile.instagram), done(profile.contact_email),
  ];
  return fields.filter(Boolean).length / fields.length * 100;
}

// ── Fixtures ──────────────────────────────────────────────────────────
// Only fields an editor can actually set to 'N/A' carry it (socials, website,
// contact email). The editors never offer 'N/A' for a name or a bio, so those
// values are not exercised — the new `filled` predicate on host identity fields
// is stricter than the old plain `Boolean`, but that divergence is unreachable
// through the UI.

const ARTIST_FULL = {
  name: 'Cosmatik', avatar: 'a.webp', location: 'Bellingen', sound: 'Deep', tagline: 'T',
  bio: 'B', genre_string: 'Techno', mix_link: 'https://x', card_pills: 'a · b',
  fee_type: 'fixed', emergency_name: 'Jo', has_abn: true,
  soundcloud: 'https://sc', mixcloud: 'N/A', instagram: 'https://ig',
  youtube: 'N/A', facebook: 'https://fb',
};
const ARTIST_PARTIAL = { name: 'Half', avatar: '', location: 'Coffs', bio: 'B', has_abn: false, instagram: 'N/A' };
const ARTIST_EMPTY = {};

const HOST_FULL = {
  name: 'H', avatar: 'a.webp', location: 'Bello', sound: 'S', tagline: 'T',
  genre_string: 'ELECTRONIC', bio: 'B', website: 'N/A',
};
const HOST_PARTIAL = { name: 'H', location: 'Bello' };

const VENUE_FULL = {
  name: 'Brewery', avatar: 'a.webp', location: 'Bellingen', state: 'NSW', venue_type: 'Bar',
  capacity: 200, sound: 'Live', tagline: 'T', bio: 'B', genre_string: 'BANDS',
  website: 'https://w', instagram: 'N/A', contact_email: 'a@b.c',
};
const VENUE_PARTIAL = { name: 'V', capacity: 0, state: 'NSW', contact_email: 'N/A' };

test('artist / host / venue percentages are unchanged — the old closures are the oracle', () => {
  for (const p of [ARTIST_FULL, ARTIST_PARTIAL, ARTIST_EMPTY]) {
    assert.equal(completionFor(p, 'artist').pct, oldArtistPct(p),
      'artist arithmetic drifted from the closure it replaced');
  }
  for (const p of [HOST_FULL, HOST_PARTIAL]) {
    assert.equal(completionFor(p, 'host').pct, oldHostPct(p),
      'host arithmetic drifted from the closure it replaced');
  }
  for (const p of [VENUE_FULL, VENUE_PARTIAL]) {
    assert.equal(completionFor(p, 'venue').pct, oldVenuePct(p),
      'venue arithmetic drifted from the closure it replaced');
  }
});

test('a fully-filled artist reaches 100%', () => {
  assert.equal(completionFor(ARTIST_FULL, 'artist').pct, 100);
});

test('THE CEILING: band and comedy can now reach 100% — they could not before', () => {
  // Everything BandProfileScreen.save() actually writes. Under the old shared
  // artist list this scored 15/17 = 88%, because `sound` and `mixcloud` are
  // columns the band editor never writes.
  const bandFull = {
    name: 'Dusky Waters', avatar: 'a.webp', location: 'Bellingen', tagline: 'T', bio: 'B',
    genre_string: 'Rock', mix_link: 'https://x', card_pills: 'a', fee_type: 'fixed',
    emergency_name: 'Jo', has_abn: true,
    soundcloud: 'https://sc', spotify: 'https://sp', instagram: 'https://ig',
    youtube: 'https://yt', facebook: 'https://fb',
  };
  assert.equal(completionFor(bandFull, 'band').pct, 100);
  assert.ok(oldArtistPct(bandFull) < 100, 'fixture must be one the OLD closure capped');

  // Everything StandupProfileScreen.save() writes. Old list: 13/17 = 76%.
  const comedyFull = {
    name: 'Test Comedian', avatar: 'a.webp', location: 'Bellingen', tagline: 'T', bio: 'B',
    genre_string: 'comedy', mix_link: 'https://x', card_pills: 'a', fee_type: 'fixed',
    emergency_name: 'Jo', has_abn: true,
    instagram: 'https://ig', tiktok: 'https://tt', facebook: 'https://fb',
  };
  assert.equal(completionFor(comedyFull, 'standup').pct, 100);
  assert.ok(oldArtistPct(comedyFull) < 80, 'fixture must be one the OLD closure capped hard');
});

test('band and comedy are not scored on fields their editors never write', () => {
  assert.ok(!COMPLETION_KEYS.band.includes('SOUND'), 'band editor writes no `sound`');
  assert.ok(!COMPLETION_KEYS.band.includes('MIXCLOUD'), 'band editor writes no `mixcloud`');
  for (const k of ['SOUND', 'SOUNDCLOUD', 'MIXCLOUD', 'YOUTUBE']) {
    assert.ok(!COMPLETION_KEYS.standup.includes(k), `comedy editor writes no \`${k.toLowerCase()}\``);
  }
});

test("'N/A' completes a social but not a bio — Absent ≠ Withheld", () => {
  const withheld = evaluate(['INSTAGRAM'], { profile: { instagram: 'N/A' } });
  assert.equal(withheld.items[0].state, 'withheld');
  assert.equal(withheld.satisfiedCount, 1, 'declining is an answer — it completes');

  const declinedBio = evaluate(['BIO'], { profile: { bio: 'N/A' } });
  assert.equal(declinedBio.items[0].state, 'absent', "'N/A' is not an accepted answer for a bio");
  assert.equal(declinedBio.satisfiedCount, 0);

  const blank = evaluate(['INSTAGRAM'], { profile: { instagram: '' } });
  assert.equal(blank.items[0].state, 'absent');
});

test('has_abn: false is an ANSWER, not a gap', () => {
  assert.equal(evaluate(['ABN'], { profile: { has_abn: false } }).items[0].state, 'satisfied');
  assert.equal(evaluate(['ABN'], { profile: { has_abn: true } }).items[0].state, 'satisfied');
  assert.equal(evaluate(['ABN'], { profile: {} }).items[0].state, 'absent');
  assert.equal(evaluate(['ABN'], { profile: { has_abn: null } }).items[0].state, 'absent');
});

test('a ticked field and a ticked file block identically (2026-08-03 override)', () => {
  const noneOfIt = evaluate(['BIO', 'PRESS_KIT', 'STAGE_PLOT', 'PUBLIC_LIABILITY'], { profile: {} });
  assert.equal(noneOfIt.canSubmit, false, 'a missing bio must block');
  assert.equal(noneOfIt.blockingCount, 4, 'the field AND all three files block — nothing ticked is optional');

  const bioOnly = evaluate(['BIO', 'PRESS_KIT', 'PUBLIC_LIABILITY'], { profile: { bio: 'B' } });
  assert.equal(bioOnly.canSubmit, false, 'the two missing documents must still gate the submission');
  assert.equal(bioOnly.blockingCount, 2);
  assert.equal(bioOnly.satisfiedCount, 1);
});

test('assets resolve against the dossier once P2 supplies them', () => {
  const assets = [{ asset_type: 'PRESS_KIT', is_current: true }];
  const r = evaluate(['PRESS_KIT', 'STAGE_PLOT'], { profile: {}, assets });
  assert.equal(r.items[0].state, 'satisfied');
  assert.equal(r.items[1].state, 'absent');

  const superseded = evaluate(['PRESS_KIT'], { profile: {}, assets: [{ asset_type: 'PRESS_KIT', is_current: false }] });
  assert.equal(superseded.items[0].state, 'absent', 'a superseded version is not the current asset');
});

test('an unknown key is surfaced but never traps the applicant', () => {
  const r = evaluate(['BIO', 'NOT_A_REAL_KEY'], { profile: { bio: 'B' } });
  assert.equal(r.totalCount, 2, 'the requirement must not silently vanish');
  assert.equal(r.items[1].state, 'unknown');
  assert.equal(r.canSubmit, true, 'a stale key must not block a submission forever');
});

test('every completion key resolves to a real registry entry', () => {
  for (const [type, keys] of Object.entries(COMPLETION_KEYS)) {
    for (const k of keys) {
      assert.ok(REQUIREMENT_KEYS[k], `${type} references unknown key ${k}`);
      assert.ok(REQUIREMENT_KEYS[k].kind !== 'asset', `${type} scores ${k}, an asset — assets arrive at P2`);
    }
    assert.equal(new Set(keys).size, keys.length, `${type} has a duplicate key`);
  }
});

test('sections are reported for the readiness breakdown', () => {
  const r = completionFor(ARTIST_FULL, 'artist');
  assert.equal(r.sections.identity.pct, 100);
  assert.equal(r.sections.media.pct, 100);
  assert.ok(r.sections.commercial.total > 0, 'fee and ABN are commercial');
});

test('no profile, or a type with no list, yields null — the bar hides', () => {
  assert.equal(completionFor(null, 'artist'), null);
  assert.equal(completionFor({ name: 'x' }, 'punter'), null);
  assert.equal(completionFor({ name: 'x' }, 'vendor'), null);
});

// ── 8 · A PARTIAL SELECT MUST NOT SILENTLY LOWER A SCORE ──────────────
// The dashboard failure mode, not the engine's: VenueDashboard batch-fetches
// applicant profiles with an explicit column list and hands the row to
// completionFor(). An unselected column arrives as `undefined`, which every
// predicate reads as `absent` — so a 100% act renders as 70% and nothing
// anywhere throws. COMPLETION_COLUMNS exists to make that list derivable
// instead of hand-kept; this test is what makes the derivation true.
//
// Projecting a full fixture THROUGH the column list is the point: a column
// dropped from the derivation vanishes from the projection, and the
// percentage falls below 100. Asserting the list against COMPLETION_KEYS
// directly would just restate the derivation back to itself.
test('a row projected through COMPLETION_COLUMNS still scores 100%', () => {
  const project = row => Object.fromEntries(
    COMPLETION_COLUMNS.filter(c => c in row).map(c => [c, row[c]])
  );
  for (const [type, full] of [['artist', ARTIST_FULL], ['host', HOST_FULL], ['venue', VENUE_FULL]]) {
    assert.equal(completionFor(project(full), type).pct, 100,
      `${type} loses points when fetched with only COMPLETION_COLUMNS — a column is missing from the list`);
  }
});

test('COMPLETION_COLUMNS is deduped and holds no blanks', () => {
  assert.equal(new Set(COMPLETION_COLUMNS).size, COMPLETION_COLUMNS.length);
  assert.ok(COMPLETION_COLUMNS.every(c => typeof c === 'string' && c.length > 0));
  // A canary: `has_abn` is the one column whose value is legitimately falsy,
  // so it is the easiest to lose from a select without anyone noticing.
  assert.ok(COMPLETION_COLUMNS.includes('has_abn'));
});

// ── 9 · A CHECKLIST MUST NOT OFFER A PHANTOM ─────────────────────────
// The engine deliberately tolerates an unrecognised key: it surfaces as
// `unknown` and non-blocking, so a requirement deleted from the registry
// degrades instead of trapping an applicant. That tolerance is correct for a
// STALE key on an old opportunity and wrong for a FRESH tick-list — a host who
// ticks something unresolvable creates a requirement no applicant can ever
// satisfy, and neither side is told why.
//
// Design §5.4 lists `SOCIALS` and `AVAILABLE_ON_DATE`, neither of which
// resolves yet. This test is what stops either being added to the checklist
// ahead of its predicate.
test('every requestable key resolves in the registry', () => {
  for (const key of REQUESTABLE_KEYS) {
    assert.ok(REQUIREMENT_KEYS[key], `checklist offers ${key}, which the engine cannot resolve`);
  }
  assert.equal(new Set(REQUESTABLE_KEYS).size, REQUESTABLE_KEYS.length, 'duplicate key in the checklist');
});

test('a ticked requirement evaluates without ever landing in `unknown`', () => {
  // The whole list against an empty dossier: every item must reach a real
  // state. `unknown` here would mean the checklist and the engine disagree.
  const { items } = evaluate(REQUESTABLE_KEYS, { profile: {}, assets: [] });
  assert.equal(items.length, REQUESTABLE_KEYS.length);
  assert.equal(items.filter(it => it.state === 'unknown').length, 0);
});

test('grouping covers the whole list, in section order, with no empty groups', () => {
  const groups = requestableBySection();
  assert.deepEqual(
    groups.flatMap(g => g.keys).sort(),
    [...REQUESTABLE_KEYS].sort(),
    'a requestable key is missing from the checklist, or appears twice',
  );
  assert.ok(groups.every(g => g.keys.length > 0), 'an empty section would render as a bare heading (R5)');
  const order = groups.map(g => g.section);
  assert.deepEqual(order, SECTIONS.filter(sec => order.includes(sec)), 'sections are out of canonical order');
});

test('a ticked FILE blocks exactly like a ticked field — 2026-08-03 override', () => {
  // A host ticks four documents. An applicant with none of them cannot submit.
  const docs = ['PRESS_KIT', 'STAGE_PLOT', 'TECH_RIDER', 'PUBLIC_LIABILITY'];
  const r = evaluate(docs, { profile: {}, assets: [] });
  assert.equal(r.canSubmit, false, 'a ticked file must gate submission, exactly like a ticked field');
  assert.equal(r.blockingCount, 4);
  assert.equal(r.satisfiedCount, 0);
});

test('a ticked field blocks exactly as before', () => {
  const r = evaluate(['BIO', 'PRESS_KIT'], { profile: {}, assets: [] });
  assert.equal(r.canSubmit, false);
  assert.equal(r.blockingCount, 2, 'both the field and the asset block now');
});

test('supplying a ticked asset clears the block, same as supplying a field', () => {
  const r = evaluate(['PRESS_KIT'], { profile: {}, assets: [{ asset_type: 'PRESS_KIT' }] });
  assert.equal(r.canSubmit, true);
  assert.equal(r.blockingCount, 0);
  assert.equal(r.satisfiedCount, 1);
});

test('an unrecognised key stays non-blocking — the ONE exception to "every ticked item blocks"', () => {
  // A stale requirement (its key deleted from the registry) must not trap an
  // applicant behind something they have no way to fix.
  const r = evaluate(['BIO', 'SOME_DELETED_KEY'], { profile: { bio: 'B' }, assets: [] });
  assert.equal(r.canSubmit, true);
  const unknown = r.items.find(it => it.key === 'SOME_DELETED_KEY');
  assert.equal(unknown.blocking, false);
});

test('no declared requirements is a clean pass, whether NULL or empty', () => {
  for (const keys of [null, undefined, []]) {
    const r = evaluate(keys, { profile: {}, assets: [] });
    assert.equal(r.canSubmit, true);
    assert.equal(r.totalCount, 0);
  }
});

test('requirementLabel names a stale key rather than rendering blank', () => {
  assert.equal(requirementLabel('BIO'), 'Bio');
  assert.equal(requirementLabel('SOCIALS'), 'SOCIALS');
});

// ── 10 · THE SUBMISSION SNAPSHOT (P5) ────────────────────────────────
// The snapshot exists so a verdict cannot be silently rewritten by later
// edits. Every test here is a way that could happen.

const AT = new Date('2026-08-03T04:12:55.019Z');

test('a snapshot records the verdict, never the profile', () => {
  const dossier = { profile: { bio: 'B', mix_link: 'https://x' }, assets: [] };
  const snap = snapshotEvaluation(evaluate(['BIO', 'DEMO_MIX', 'PRESS_KIT'], dossier), ['BIO', 'DEMO_MIX', 'PRESS_KIT'], AT);
  assert.deepEqual(snap.items, [
    { key: 'BIO',       state: 'satisfied' },
    { key: 'DEMO_MIX',  state: 'satisfied' },
    { key: 'PRESS_KIT', state: 'absent'    },
  ]);
  assert.equal(snap.satisfied, 2);
  assert.equal(snap.total, 3);
  assert.equal(snap.evaluated_at, '2026-08-03T04:12:55.019Z');
  // No profile values anywhere in the stored object — the whole point.
  const flat = JSON.stringify(snap);
  assert.ok(!flat.includes('https://x'), 'the snapshot leaked a profile value');
  assert.ok(!flat.includes('"B"'),       'the snapshot leaked a profile value');
});

test('the snapshot survives the host editing their checklist afterwards', () => {
  // This is why required_items is copied in rather than re-read from the event.
  const asked = ['BIO', 'PRESS_KIT'];
  const snap = snapshotEvaluation(evaluate(asked, { profile: { bio: 'B' }, assets: [] }), asked, AT);
  asked.push('TECH_RIDER');                       // host edits the event later
  assert.deepEqual(snap.required_items, ['BIO', 'PRESS_KIT'],
    'the verdict must keep naming what was actually asked at submission');
});

test('the snapshot survives the applicant changing their profile afterwards', () => {
  const dossier = { profile: { bio: 'B' }, assets: [{ asset_type: 'PRESS_KIT' }] };
  const snap = snapshotEvaluation(evaluate(['PRESS_KIT'], dossier), ['PRESS_KIT'], AT);
  dossier.assets.length = 0;                      // artist deletes it next week
  assert.equal(snap.items[0].state, 'satisfied');
  assert.equal(snap.satisfied, 1, 'a stored verdict must not follow the live profile');
});

test('a withheld answer counts as met in the snapshot, an absent one does not', () => {
  // R1 through to storage: 'N/A' is "asked and declined", which settles a
  // `done` key. Losing this makes declining look like ignoring.
  const snap = snapshotEvaluation(
    evaluate(['WEBSITE', 'BIO'], { profile: { website: 'N/A' }, assets: [] }),
    ['WEBSITE', 'BIO'], AT,
  );
  assert.deepEqual(snap.items, [
    { key: 'WEBSITE', state: 'withheld' },
    { key: 'BIO',     state: 'absent'   },
  ]);
  assert.equal(snap.satisfied, 1);
});

test('a snapshot of no requirements is empty rather than absent-looking', () => {
  const snap = snapshotEvaluation(evaluate([], { profile: {} }), [], AT);
  assert.deepEqual(snap.items, []);
  assert.equal(snap.total, 0);
  // The apply path stores NULL in this case; if one is ever built it must not
  // claim 0/0 met as a failure.
  assert.equal(snap.satisfied, 0);
});

test('snapshotEvaluation is defensive — a missing evaluation yields a shape, not a throw', () => {
  const snap = snapshotEvaluation(null, null, AT);
  assert.deepEqual(snap, { v: 1, evaluated_at: AT.toISOString(), required_items: [], items: [], satisfied: 0, total: 0 });
});

// ── 11 · columnsFor: only fetch what was asked ───────────────────────
test('columnsFor returns exactly the columns those keys read', () => {
  assert.deepEqual(columnsFor(['BIO', 'DEMO_MIX']), ['bio', 'mix_link']);
  assert.deepEqual(columnsFor(['PRESS_KIT']), [], 'assets resolve against dossier.assets, not a column');
  assert.deepEqual(columnsFor(['BIO', 'BIO']), ['bio'], 'deduped');
  assert.deepEqual(columnsFor(['NOPE']), [], 'an unknown key contributes nothing');
  assert.deepEqual(columnsFor(null), []);
});

test('a profile fetched with columnsFor evaluates identically to the full row', () => {
  // The silent-failure guard for the apply path, mirroring the dashboard one:
  // an unselected column reads as `absent` and a met requirement would report
  // as unmet with nothing thrown.
  const required = ['ACT_NAME', 'BIO', 'DEMO_MIX', 'FEE_EXPECTATION', 'ABN'];
  const full = { name: 'Dusky Waters', bio: 'B', mix_link: 'https://x', fee_type: 'fixed', has_abn: false, location: 'Bellingen' };
  const cols = columnsFor(required);
  const partial = Object.fromEntries(cols.filter(c => c in full).map(c => [c, full[c]]));
  assert.deepEqual(
    evaluate(required, { profile: partial }).items,
    evaluate(required, { profile: full }).items,
  );
  assert.equal(evaluate(required, { profile: partial }).canSubmit, true);
});

// ── FR1 · Festival role requirements must not leak into Scene ──────────────
/**
 * ⛔⛔ THE LEAK THIS PREVENTS. `requestableBySection()` returns the rows
 * `RequirementChecklist` renders. It used to return EVERY requestable key, so
 * adding Festival role requirements to the registry would have offered a VENUE
 * "Volunteer Experience" when it set its enquiry requirements — Festival
 * concepts appearing on a Scene surface, which is the same failure the
 * profile-type ruling exists to prevent.
 */
test('FR1 · Scene\'s default offer is unchanged by the festival keys', () => {
  const offered = requestableBySection().flatMap(g => g.keys);
  for (const k of ['VOLUNTEER_EXPERIENCE', 'CURRENT_PROFESSION', 'EXPERIENCE_DESCRIPTION',
                   'INDUSTRY_EXPERIENCE', 'SKILLS', 'QUALIFICATIONS', 'DOB']) {
    assert.ok(!offered.includes(k), `${k} must never be offered on a Scene surface`);
  }
});

test('FR1 · a caller can offer its own set', () => {
  const offered = requestableBySection(FESTIVAL_ROLE_REQUESTABLE_KEYS).flatMap(g => g.keys);
  assert.ok(offered.includes('VOLUNTEER_EXPERIENCE'));
  assert.ok(offered.includes('EMERGENCY_CONTACT'));
  // ⚠ Music-industry asks are irrelevant to a volunteer, but they arrive with
  // ASSET_REQUIREMENT_KEYS. That is deliberate — evidence is evidence — and
  // the PORTAL narrows the list it shows, not the engine.
  assert.ok(offered.length > 0);
});

test('FR1 · an empty or missing list falls back to Scene\'s, never to nothing', () => {
  // ⛔ A checklist that silently renders zero rows reads as "this asks for
  // nothing", which is the one thing a requirements UI must never imply.
  assert.deepEqual(requestableBySection([]), requestableBySection());
  assert.deepEqual(requestableBySection(undefined), requestableBySection());
});

test('FR1 · every festival role key resolves to a real registry entry', () => {
  for (const k of FESTIVAL_ROLE_REQUESTABLE_KEYS) {
    assert.ok(REQUIREMENT_KEYS[k], `${k} is offered but not defined — it would render as its own key`);
  }
});

test('FR1 · a clearance is evidence, not a boolean', () => {
  // Owner's ruling: a self-declared "has Blue Card" must not substitute for the
  // document. So the clearance is an ASSET key, and there is no boolean field.
  assert.ok(ASSET_REQUIREMENT_KEYS.includes('CLEARANCE'));
  assert.ok(!REQUIREMENT_KEYS.HAS_BLUE_CARD);
  assert.ok(!REQUIREMENT_KEYS.HAS_CLEARANCE);
});
