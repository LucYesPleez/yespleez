import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * P12 — THE PROVENANCE CHAIN, END TO END.
 *
 *     acting profile's ROLE  →  resolver  →  stored key  →  registry label
 *
 * ⭐ The category is decided ONCE, at creation, and stored. ⛔ Never derived at
 * read time: profile types change and event config is editable, so a derived
 * category would silently rewrite what an old ask MEANT.
 */

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const sqlOf = rel => read(rel).split('\n').filter(l => !/^\s*--/.test(l)).join('\n');

const PROFILE = read('../screens/ProfileScreen.jsx');
const APPLY   = read('../screens/event/ApplyButton.jsx');
const DASH    = read('../screens/ArtistDashboard.jsx');
// ⚠ 2026-08-11: the outgoing fetch and the row that renders the chip moved out
// of ArtistDashboard when HostDashboard grew the same list. Same assertions,
// new home — and they now cover both dashboards at once.
const PIPE    = read('./outgoingPipeline.js');
const ROW     = read('../components/OutgoingEnquiryRow.jsx');
const INVITE  = read('../components/InviteSheet.jsx');
const P12     = sqlOf('../../../../supabase/migrations/20260810000006_p12_ask_category.sql');

// ── The column stores; it does not resolve ───────────────────────────────

test('P12 adds a nullable text column to both tables', () => {
  assert.match(P12, /ALTER TABLE public\.venue_enquiries\s+ADD COLUMN IF NOT EXISTS ask_category text;/);
  assert.match(P12, /ALTER TABLE public\.applications\s+ADD COLUMN IF NOT EXISTS ask_category text;/);
});

/**
 * ⛔ No DEFAULT, no trigger, no generated column, no CHECK. Resolution lives in
 * one place — the resolver. A second implementation in SQL would silently win
 * on any path that forgot to ask.
 */
test('the database never resolves a category', () => {
  assert.doesNotMatch(P12, /DEFAULT/i, 'the column defaults a value instead of storing what it was given');
  assert.doesNotMatch(P12, /CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER/i, 'resolution has leaked into SQL');
  assert.doesNotMatch(P12, /GENERATED/i);
  assert.doesNotMatch(P12, /CHECK \(/, 'a CHECK would reject the whole write when code ships ahead of data');
});

test('P12 backfills nothing', () => {
  assert.doesNotMatch(P12, /\bUPDATE\b/i, 'historical rows must stay NULL — no inference');
});

// ── Creation-time persistence ────────────────────────────────────────────

test('the enquiry stores the resolved category', () => {
  assert.match(PROFILE, /ask_category:\s*askCategory,/);
});

test('the application stores the resolved category', () => {
  // ⚠ Not `\([^)]*\)` — the argument contains its own parentheses
  // (`performers.find(...)`), which an earlier version of this test choked on.
  assert.match(APPLY, /ask_category: resolveAskCategory\(.+\)\.category,/);
});

/**
 * ⭐ Resolution happens BEFORE the send and is held, not recomputed inside the
 * insert. A value computed at write time and again at read time is two answers
 * waiting to disagree.
 */
test('the enquiry resolves once, into state, keyed on the acting profile', () => {
  assert.match(PROFILE, /const \{ category, needsChoice, applicable \} = resolveAskCategory\(enquiryProf\);/);
  assert.match(PROFILE, /\}, \[enquiryProf\]\);/,
    're-resolution is not keyed on the acting profile');
});

// ── ⛔ The choice path: never send a choice nobody made ───────────────────

test('a required choice blocks the send', () => {
  const fn = PROFILE.slice(PROFILE.indexOf('async function requestSendEnquiry'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /if \(askChoiceNeeded && !askCategory\)/,
    'an unmade choice would be frozen onto the record as null');
  assert.match(body, /setEnquiryError\(/, 'the refusal is silent');
});

test('the three resolver states are carried into state, not collapsed', () => {
  for (const name of ['askCategory', 'askChoiceNeeded', 'askOptions']) {
    assert.match(PROFILE, new RegExp(`const \\[${name},`), `${name} is not held — the states collapse`);
  }
});

/**
 * ⚠⚠ THE STALE-CATEGORY SEQUENCE. Switching acting profile must recompute, or
 * the previous act's category is frozen onto the new act's enquiry:
 *
 *     act as DJ        → music
 *     switch to comedy → MUST become performance_artist
 *     switch to host   → MUST become null
 *
 * The effect is keyed on the profile and sets all three states with NO early
 * return, so every switch overwrites all of them. An `if` guarding the setters
 * is what would leave one behind.
 */
test('switching acting profile recomputes every state, unconditionally', () => {
  const at = PROFILE.indexOf('const { category, needsChoice, applicable } = resolveAskCategory(enquiryProf);');
  assert.ok(at > 0, 'the resolver effect is gone');
  const body = PROFILE.slice(at, PROFILE.indexOf('}, [enquiryProf]);', at));
  for (const setter of ['setAskCategory(category)', 'setAskChoiceNeeded(needsChoice)', 'setAskOptions(applicable)']) {
    assert.ok(body.includes(setter), `${setter} is missing — that state would go stale on a switch`);
  }
  assert.doesNotMatch(body, /\bif\s*\(|\breturn\b/,
    'a branch or early return can leave the previous profile\'s category in place');
});

/**
 * ⛔ EVERY path that changes the acting profile must go through the same state,
 * or one of them bypasses the effect entirely. Clearing it (cancel, or after a
 * successful send) must clear the category too — `resolveAskCategory(null)`
 * returns `{ category: null, needsChoice: false, applicable: [] }`, which is why
 * the effect needs no special case for it.
 */
test('the acting profile has exactly one setter, so no path bypasses the effect', () => {
  const setters = PROFILE.match(/setEnquiryProf\(/g) || [];
  assert.ok(setters.length >= 4, 'the acting-profile paths changed shape — re-check them');
  assert.doesNotMatch(PROFILE, /enquiryProf\s*=\s*[^=]/, 'the acting profile is assigned outside state');
});

// ── Rendering ────────────────────────────────────────────────────────────

test('the chip reads the registry label, never the raw key', () => {
  assert.match(ROW, /askCategoryLabel\(enq\.ask_category\)/);
  assert.match(ROW, /\{askLabel && \(/, 'a null category must render no chip at all');
});

test('the outgoing fetch selects the column it renders', () => {
  assert.match(PIPE, /OUTGOING_ENQUIRY_COLUMNS =\s*\n?\s*'[^']*\bask_category\b/,
    'the chip would always be blank — the column is never fetched');
  assert.match(PIPE, /\.select\(OUTGOING_ENQUIRY_COLUMNS\)/,
    'the column list is declared but the fetch selects something else');
});

/**
 * ⛔ Two dimensions, never collapsed. The chip says what was asked FOR; the
 * pipeline badge says where it is up to.
 */
test('the chip never renders the interaction mechanism', () => {
  assert.doesNotMatch(ROW, /'ENQUIRY'|"ENQUIRY"|'APPLICATION'|"APPLICATION"/,
    'the chip is describing the mechanism rather than the ask');
});

// ── ⛔ Invitations stay out of it ─────────────────────────────────────────

/**
 * An invitation contains no statement of supply — only booking terms. Its
 * category source is explicitly unresolved (design §5a), so it must not acquire
 * one by accident.
 */
test('InviteSheet does not write an ask_category', () => {
  assert.doesNotMatch(INVITE, /ask_category/, 'invitations have gained a category the design left unresolved');
});

// ── The vocabulary is never duplicated ───────────────────────────────────

test('no screen maps roles to categories itself', () => {
  for (const [name, src] of [['ProfileScreen', PROFILE], ['ApplyButton', APPLY], ['ArtistDashboard', DASH]]) {
    assert.doesNotMatch(src, /'dj_prod':|'comedy':\s*'performance_artist'/,
      `${name} re-implements the resolver's mapping`);
  }
});
