/**
 * SOUND BIO + TAGLINE — one definition, six editors.
 *
 * ⚠⚠ TWO KINDS OF TEST LIVE HERE AND THEY PROVE DIFFERENT THINGS. The registry
 * tests execute real code. The editor-wiring tests read source text, which can
 * never prove a file compiles or renders — `npm run lint` and the production
 * build are what cover that, and both must pass alongside this file.
 *
 * The bug this exists to keep closed: band and standup showed a box under a
 * heading reading YOUR SOUND / YOUR STYLE that wrote `tagline`, while every
 * card, application row, enquiry and lineup in the app reads `sound`. Both
 * profile types fell back to genres on every surface a promoter uses.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PROFILE_BLURB_FIELDS, BLURB_SECTION_TITLE, BLURB_PROFILE_TYPES,
  BLURB_MAX_LENGTHS, BLURB_PLACEHOLDERS, blurbFieldsFor, blurbPlaceholdersFor,
} from './profileBlurbFields.js';

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Block and line comments out, so an assertion is about code, not prose. */
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const EDITORS = {
  artist:  read('../screens/ArtistProfileScreen.jsx'),
  band:    read('../screens/BandProfileScreen.jsx'),
  standup: read('../screens/StandupProfileScreen.jsx'),
  host:    read('../screens/HostProfileScreen.jsx'),
  venue:   read('../screens/VenueProfileScreen.jsx'),
};
const LEGACY    = read('../screens/ProfileEditScreen.jsx');
const COMPONENT = read('../components/BlurbFields.jsx');

const byKey = k => PROFILE_BLURB_FIELDS.find(f => f.key === k);

/* ── 1-4 · the canonical definition ──────────────────────────────────────── */

test('1 · SOUND BIO is the `sound` column', () => {
  const f = byKey('sound');
  assert.equal(f.label, 'SOUND BIO');
  assert.equal(f.column, 'sound');
  assert.equal(f.hint, 'What you sound like');
});

test('2 · TAGLINE is the `tagline` column', () => {
  const f = byKey('tagline');
  assert.equal(f.label, 'TAGLINE');
  assert.equal(f.column, 'tagline');
  assert.equal(f.hint, 'Your event / performance personality');
});

test('3 · SOUND BIO maxLength is 50', () => {
  assert.equal(byKey('sound').maxLength, 50);
  assert.equal(BLURB_MAX_LENGTHS.sound, 50);
});

test('4 · TAGLINE maxLength is 120', () => {
  assert.equal(byKey('tagline').maxLength, 120);
  assert.equal(BLURB_MAX_LENGTHS.tagline, 120);
});

test('⭐ the section heading is canonical and there are exactly two fields', () => {
  assert.equal(BLURB_SECTION_TITLE, 'YOUR SOUND & STYLE');
  assert.equal(PROFILE_BLURB_FIELDS.length, 2);
});

test('⭐⭐ TAGLINE renders FIRST, and the registry is the only place that decides', () => {
  // Owner, 2026-09-05. The array IS the render order, so this one assertion
  // covers all six editors — none of them orders the two boxes itself.
  assert.deepEqual(PROFILE_BLURB_FIELDS.map(f => f.column), ['tagline', 'sound']);
  for (const src of Object.values(EDITORS)) {
    assert.ok(!/<input[^>]*value=\{sound\}/.test(src), 'an editor renders its own sound box');
  }
});

/* ── 5-11 · every editor's load / save / column mapping ──────────────────── */

/* ⛔⛔ THE FIX FOR BAND AND STANDUP. `sound` state, loaded from `data.sound`,
   and present in the save payload — all three, or the field is decorative. */
for (const type of ['band', 'standup']) {
  test(`${type === 'band' ? '5-6' : '7-8'} · ${type} loads and saves BOTH columns`, () => {
    const src = EDITORS[type];
    assert.match(src, /const \[sound, +setSound\] += useState\(''\);/, 'sound state');
    assert.match(src, /const \[tagline, +setTagline\] += useState\(''\);/, 'tagline state');
    assert.match(src, /setSound\(data\.sound \|\| ''\);/, 'loads profiles.sound');
    assert.match(src, /setTagline\(data\.tagline \|\| ''\);/, 'loads profiles.tagline');
    assert.match(src, /\n {6}sound, tagline, bio,/, 'saves both columns');
  });
}

test('9 · artist sound/tagline remain correctly mapped', () => {
  const src = EDITORS.artist;
  assert.match(src, /setSound\(data\.sound \|\| ''\);/);
  assert.match(src, /setTagline\(data\.tagline \|\| ''\);/);
  assert.match(src, /\n {6}sound, tagline, bio,/);
});

test('10 · host sound/tagline remain correctly mapped', () => {
  const src = EDITORS.host;
  assert.match(src, /setSound\(data\.sound \|\| ''\);/);
  assert.match(src, /setTagline\(data\.tagline \|\| ''\);/);
  assert.match(src, /\n {6}tagline, sound, bio,/);
});

test('11 · venue sound/tagline remain correctly mapped', () => {
  const src = EDITORS.venue;
  assert.match(src, /setSound\(p\.sound \|\| ''\);/);
  assert.match(src, /setTagline\(p\.tagline \|\| ''\);/);
  assert.match(src, /sound: {12}sound\.trim\(\),/);
  assert.match(src, /tagline: {10}tagline\.trim\(\),/);
  // ⚠ Venue's explicit select must still ASK for both, unlike the other four
  // which use select('*'). A canonical editor over a column it never fetched
  // would load blank and then save blank over real data.
  assert.match(src, /\.select\('[^']*\bsound\b[^']*\btagline\b[^']*'\)/);
});

/* ── 12 · the downstream fallback is untouched ───────────────────────────── */

test('12 · an empty sound still falls back to genres downstream', () => {
  // ⛔ NOT MODIFIED BY THIS WORK (owner). The point of giving band and standup
  // a real `sound` is that these consumers start receiving a real value; the
  // fallback stays for everyone who has not written one yet.
  const consumers = [
    ['../components/ProfileCard.jsx',   /item\.sound \|\| genreLabels\(item\.genre_string\)\.slice\(0, 3\)\.join\(' · '\) \|\| ''/],
    ['../components/EnquiryCard.jsx',   /p\.sound \|\| genreLabels\(p\.genre_string\)\.slice\(0, 3\)\.join\(' · '\) \|\| ''/],
    ['../components/InviteSheet.jsx',   /artist\.sound \|\| genreLabels\(artist\.genre_string\)\.slice\(0, 3\)\.join\(' · '\) \|\| ''/],
    ['../components/PortraitCard.jsx',  /\{p\?\.sound &&/],
  ];
  for (const [rel, re] of consumers) assert.match(read(rel), re, rel);
});

/* ── 13-14 · the two columns cannot overwrite each other ─────────────────── */

test('13-14 · sound and tagline have separate values and separate handlers', () => {
  // One shared `onChange` reused for both fields would make each keystroke in
  // one box write the other column. The component keys both by field.
  assert.match(COMPONENT, /const values += \{ sound, tagline \};/);
  assert.match(COMPONENT, /const handlers += \{ sound: onSoundChange, tagline: onTaglineChange \};/);
  assert.match(COMPONENT, /const value += values\[f\.key\] \|\| '';/);
  assert.match(COMPONENT, /handlers\[f\.key\] && handlers\[f\.key\]\(e\.target\.value\)/);

  // And every editor passes two DISTINCT setters, never the same one twice.
  for (const [type, src] of Object.entries(EDITORS)) {
    const m = src.match(/sound=\{[^}]+\} onSoundChange=\{([^}]+)\}\s*\n\s*tagline=\{[^}]+\} onTaglineChange=\{([^}]+)\}/);
    assert.ok(m, `${type} passes both handlers`);
    assert.notEqual(m[1].trim(), m[2].trim(), `${type} must not share one setter`);
  }
});

test('⛔ no editor writes one column from the other field', () => {
  for (const [type, src] of Object.entries(EDITORS)) {
    assert.ok(!/sound=\{tagline\}/.test(src), `${type} crossed sound<-tagline`);
    assert.ok(!/tagline=\{sound\}/.test(src), `${type} crossed tagline<-sound`);
  }
});

/* ── registry + component reach all five types ───────────────────────────── */

test('⭐ all five profile types receive BOTH fields', () => {
  assert.deepEqual(BLURB_PROFILE_TYPES, ['artist', 'band', 'standup', 'host', 'venue']);
  for (const t of BLURB_PROFILE_TYPES) {
    assert.deepEqual(blurbFieldsFor(t).map(f => f.column), ['tagline', 'sound'], t);
    const ph = blurbPlaceholdersFor(t);
    assert.ok(ph.sound && ph.tagline, `${t} has both placeholders`);
    assert.ok(BLURB_PLACEHOLDERS[t], `${t} has its own examples`);
  }
  assert.deepEqual(blurbFieldsFor('punter'), [], 'a punter has no blurb');
});

test('⭐ every editor renders the shared component, none rolls its own', () => {
  for (const [type, src] of Object.entries(EDITORS)) {
    assert.match(src, /<BlurbFields/, `${type} uses the shared component`);
    assert.match(src, /BLURB_SECTION_TITLE/, `${type} uses the canonical heading`);
  }
  assert.match(LEGACY, /<BlurbFields/, 'legacy /profile-edit too');
  assert.match(LEGACY, /BLURB_SECTION_TITLE/);
});

test('⛔ the competing labels and limits are gone from every editor', () => {
  const banned = [
    /<Section title="YOUR SOUND">/,
    /<Section title="YOUR STYLE">/,
    />YOUR VIBE </,
    />SOUND \/ VIBE BIO </,
    /label="SOUND \/ VIBE"/,
    /shows on your slot card/,
    /shows on your profile tile/,
    /shows on your listing/,
    /maxLength=\{35\}/,
    /maxLength=\{100\}/,
  ];
  for (const [type, src] of Object.entries({ ...EDITORS, legacy: LEGACY })) {
    for (const re of banned) assert.ok(!re.test(src), `${type} still has ${re}`);
  }
});

test('⛔ the legacy route no longer gates the sound field behind a flag', () => {
  // host/venue were `showSound: false` here while their own editors always had
  // the field, so the same profile gained or lost a box by editor.
  /* ⚠⚠ ASSERTED AGAINST CODE WITH THE COMMENTS STRIPPED. The comments
     recording why the flag was removed necessarily quote it, including
     `showSound: false`, and a raw substring check reads its own documentation
     as the regression. This is the general trap in a source-text test: it
     cannot tell prose from code unless you take the prose out first. */
  const code = stripComments(LEGACY);
  assert.ok(!/showSound:/.test(code),       'showSound key is gone');
  assert.ok(!/flags\.showSound/.test(code), 'nothing reads showSound');
  // and the control: the stripper did not simply empty the file
  assert.match(code, /const PROFILE_FLAGS = \{/);
});

test('⛔ nothing clamps with .slice() beside maxLength any more', () => {
  for (const [type, src] of Object.entries(EDITORS)) {
    assert.ok(!/setSound\(e\.target\.value\.slice/.test(src), `${type} double-clamps sound`);
    assert.ok(!/setTagline\(e\.target\.value\.slice/.test(src), `${type} double-clamps tagline`);
  }
});

test('⭐ counters render for both fields, from the registry not a literal', () => {
  assert.match(COMPONENT, /\{value\.length\} \/ \{f\.maxLength\}/);
  // and no editor keeps a hand-written counter for these two fields
  for (const [type, src] of Object.entries(EDITORS)) {
    assert.ok(!/\{sound\.length\} \//.test(src),   `${type} hand-rolls a sound counter`);
    assert.ok(!/\{tagline\.length\} \//.test(src), `${type} hand-rolls a tagline counter`);
  }
});

test('⛔ the database columns were not renamed', () => {
  assert.deepEqual([...PROFILE_BLURB_FIELDS].map(f => f.column).sort(), ['sound', 'tagline']);
});
