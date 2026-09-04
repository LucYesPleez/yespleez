import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REQUIREMENT_KEYS, FESTIVAL_ROLE_REQUESTABLE_KEYS } from '@yespleez/requirements';
import PARTICIPANT_TYPES from '../config/participantTypes.js';
import { CATEGORIES } from '../config/categories.js';
import { VOLUNTEER_PROFILE_FIELDS } from '../config/volunteerProfile.js';
import {
  VOLUNTEER_ROLE_KEY, VOLUNTEER_DATA_KEYS, isKnownRoleKey,
  emptyVolunteerData, readVolunteerData, writeVolunteerData,
  volunteerHeldValues, evaluateVolunteerProfile,
} from './volunteerRoleProfile.js';

/**
 * THE MODEL BETWEEN THE CONFIG AND THE SCREEN.
 *
 * ⚠ `config/volunteerProfile.test.mjs` pins what a FIELD IS. These pin what
 * happens to a value on its way in and out of the database — which is where
 * the layer boundary either holds or quietly stops holding.
 */

// ── The role key is a foreign key ──────────────────────────────────────────
test('⛔ the role key resolves through participation_type_ceiling', () => {
  /**
   * `festival_role_profiles.role_key` references
   * `participation_type_ceiling.participant_type`, and `participantTypes.js` is
   * this app's copy of exactly those rows. A key that does not resolve here is
   * an insert the database rejects — at the moment somebody presses Save.
   */
  assert.equal(VOLUNTEER_ROLE_KEY, 'volunteer');
  assert.ok(isKnownRoleKey(VOLUNTEER_ROLE_KEY), 'volunteer must be a real participation type');
  assert.ok(PARTICIPANT_TYPES[VOLUNTEER_ROLE_KEY], 'and it must be the roster registry that says so');
  assert.ok(!isKnownRoleKey('vollys'), 'a plausible-looking near-miss must not pass');
});

/**
 * ⛔⛔ THE TRIPWIRE FOR A DEFERRED DECISION — ⛔ NOT A MAPPING.
 *
 * `category_key` (what you apply to) and `role_key` (what you participate as)
 * are different concepts that happen to share the spelling `volunteer`. The
 * mapping between them is DELIBERATELY UNDESIGNED, and nothing here invents
 * one: no lookup table, no translation function, no defaulting.
 *
 * ⚠⚠ BUT THE IDENTITY IS ALREADY LOAD-BEARING IN RLS. The live policy
 * `festival_role_profiles_read_applied` joins `a.category_key =
 * festival_role_profiles.role_key`, so the day the two stop matching, an
 * organiser reading an applicant's background silently gets NOTHING — which
 * reads as "they filled in nothing", not as a mapping fault.
 *
 * ⭐ So this test exists to FAIL LOUDLY at that moment rather than let it be
 * discovered as missing data. If it ever breaks: ⛔ do not "fix" it by editing
 * the assertion. Stop, and design the mapping explicitly — the policy has to
 * change with it.
 */
test('⛔⛔ volunteer category_key and role_key are still identical — design the mapping before they are not', () => {
  const category = CATEGORIES.find(c => c.key === VOLUNTEER_ROLE_KEY);
  assert.ok(
    category,
    `No festival category is keyed "${VOLUNTEER_ROLE_KEY}". The category key and the role key have `
    + 'diverged, and festival_role_profiles_read_applied joins them as equal. STOP and design the '
    + 'category_key <-> role_key mapping before going further.',
  );
});

// ── The form shape ─────────────────────────────────────────────────────────
test('an empty form carries every field, so no input flips to controlled mid-type', () => {
  const empty = emptyVolunteerData();
  assert.deepEqual(Object.keys(empty).sort(), [...VOLUNTEER_DATA_KEYS].sort());
  assert.ok(Array.isArray(empty.capabilities), 'a multi-select starts as a list, never ""');
  assert.equal(empty.currentProfession, '');
});

test('the editor learns a field is multi-select from the CONFIG, never from its key', () => {
  // ⛔ A renderer that hardcodes `key === 'capabilities'` stops working silently
  // the day a second multi-select field is added.
  const quals = VOLUNTEER_PROFILE_FIELDS.find(f => f.key === 'capabilities');
  const experience = VOLUNTEER_PROFILE_FIELDS.find(f => f.key === 'volunteerExperience');
  assert.equal(quals.multiple, true);
  assert.ok(!experience.multiple, 'one answer, not a list');
  assert.ok(quals.choices && experience.choices, 'both carry choices — `multiple` is the only difference');
});

// ── Reading: tolerant of values, strict about keys ─────────────────────────
test('a row and a bare data blob read the same', () => {
  const blob = { skills: 'Rigging' };
  assert.deepEqual(readVolunteerData({ id: 'r1', role_key: 'volunteer', data: blob }), readVolunteerData(blob));
});

test('null, undefined and rubbish read as an empty form rather than throwing', () => {
  // Nobody has a role profile yet, and a screen that throws on the absence of
  // one is a screen nobody can use to create it.
  assert.deepEqual(readVolunteerData(null), emptyVolunteerData());
  assert.deepEqual(readVolunteerData(undefined), emptyVolunteerData());
  assert.deepEqual(readVolunteerData({ data: null }), emptyVolunteerData());
});

test('⚠ an unrecognised CAPABILITY is kept, because a stored claim must still show', () => {
  /**
   * `capabilityLabel()` already renders an unknown key as itself for this
   * reason. Deleting somebody's claim because this build has not heard of it is
   * data loss wearing the costume of validation.
   */
  const form = readVolunteerData({ capabilities: ['BLUE_CARD', 'FORKLIFT_TICKET'] });
  assert.deepEqual(form.capabilities, ['BLUE_CARD', 'FORKLIFT_TICKET']);
});

test('⛔⛔ an unrecognised FIELD is dropped — that is how application answers leak in', () => {
  /**
   * The asymmetry with the test above is deliberate and is the whole boundary.
   * An unknown VALUE is a future vocabulary; an unknown FIELD is availability or
   * a department that has escaped from an application, and one of those in a
   * permanent profile is this architecture's defining failure.
   */
  const form = readVolunteerData({
    skills: 'Rigging',
    days: ['2026-11-12'], departments: ['Front Gate'], motivation: 'because',
  });
  assert.equal(form.skills, 'Rigging');
  for (const k of ['days', 'departments', 'motivation']) {
    assert.ok(!(k in form), `${k} is application data and must not survive a read`);
  }
});

test('a non-array capability value and a null inside one do not become blank chips', () => {
  assert.deepEqual(readVolunteerData({ capabilities: 'BLUE_CARD' }).capabilities, ['BLUE_CARD']);
  assert.deepEqual(
    readVolunteerData({ capabilities: ['BLUE_CARD', null, '', 'BLUE_CARD'] }).capabilities,
    ['BLUE_CARD'],
  );
});

// ── Writing ────────────────────────────────────────────────────────────────
test('⭐ an unanswered field is OMITTED, never stored as an empty string', () => {
  // Absent means nobody has answered. A key present with '' claims the question
  // was answered with nothing, which is a different thing the reader cannot
  // distinguish afterwards.
  const stored = writeVolunteerData({ ...emptyVolunteerData(), skills: '  Rigging  ' });
  assert.deepEqual(stored, { skills: 'Rigging' });
});

test('⚠⚠ "no prior experience" survives the write — it is an ANSWER', () => {
  const stored = writeVolunteerData({ ...emptyVolunteerData(), volunteerExperience: 'NONE' });
  assert.equal(stored.volunteerExperience, 'NONE');
});

test('⛔⛔ the writer cannot be talked into storing application answers', () => {
  const stored = writeVolunteerData({
    ...emptyVolunteerData(),
    skills: 'Rigging',
    days: ['2026-11-12'], departments: ['Front Gate'], availability: 'weekends',
  });
  assert.deepEqual(Object.keys(stored), ['skills']);
});

test('⛔⛔ a capability is stored as a bare key — never an object carrying its own proof', () => {
  /**
   * Ticking BLUE_CARD says "I have one". The document lives in a CLEARANCE
   * asset. A stored `{ key, verified: true }` would let a self-declaration
   * satisfy a requirement that asked for evidence.
   */
  const stored = writeVolunteerData({ ...emptyVolunteerData(), capabilities: ['BLUE_CARD'] });
  assert.deepEqual(stored.capabilities, ['BLUE_CARD']);
  for (const c of stored.capabilities) assert.equal(typeof c, 'string');
});

test('an empty capability list is omitted rather than stored as []', () => {
  const stored = writeVolunteerData(emptyVolunteerData());
  assert.deepEqual(stored, {});
});

test('read after write is stable', () => {
  const form = { ...emptyVolunteerData(), skills: 'Rigging', capabilities: ['WHITE_CARD'], volunteerExperience: 'NONE' };
  assert.deepEqual(readVolunteerData(writeVolunteerData(form)), form);
});

// ── The held-values bag ────────────────────────────────────────────────────
test('⛔⛔ profiles.age NEVER reaches the bag — person_private.dob is authoritative', () => {
  /**
   * `profiles.age` is a self-described free-text field holding "31" and
   * "prefer-not-to-say". A festival asking for a date of birth is asking an
   * eligibility question, and answering it with that string would be a wrong
   * answer that looks like a right one.
   */
  const bag = volunteerHeldValues({
    profile: { id: 'p1', age: '31', location: 'Bellingen' },
    person: { dob: null },
    data: {},
  });
  assert.equal(bag.age, null, 'no date of birth means ABSENT, not "31"');
  assert.equal(bag.location, 'Bellingen', 'the rest of the canonical profile still comes through');
});

test('the date of birth in the bag comes from person_private', () => {
  const bag = volunteerHeldValues({
    profile: { id: 'p1', age: 'prefer-not-to-say' },
    person: { dob: '1990-04-02' },
    data: {},
  });
  assert.equal(bag.age, '1990-04-02');
});

test('⛔⛔ an empty capability list must not satisfy QUALIFICATIONS', () => {
  /**
   * The engine's `filled` predicate is `!!(v && v !== "N/A")`, and `[]` is
   * TRUTHY. Handing the array straight over would report the requirement as met
   * for somebody who has ticked nothing — a requirement that silently passes is
   * worse than one that wrongly blocks, because nobody looks at it again.
   */
  assert.equal(volunteerHeldValues({ data: { capabilities: [] } }).qualifications, null);
  assert.ok(volunteerHeldValues({ data: { capabilities: ['BLUE_CARD'] } }).qualifications);
});

test('every background column in the bag is fed by the role profile', () => {
  const bag = volunteerHeldValues({
    profile: {},
    person: {},
    data: {
      currentProfession: 'Rigger', volunteerExperience: 'EXPERIENCED',
      experienceDescription: 'Two years', industryExperience: 'Some',
      skills: 'Rigging', capabilities: ['WHITE_CARD'],
    },
  });
  for (const col of ['current_profession', 'volunteer_experience', 'experience_description',
                     'industry_experience', 'skills', 'qualifications']) {
    assert.ok(bag[col], `${col} must be composed from the role profile`);
  }
});

test('street address comes from person_private, and the profile keeps its own components', () => {
  // Ratified: suburb, state, postcode and country stay on `profiles`; only the
  // street line moved. ⛔ Neither layer copies the other's half.
  const bag = volunteerHeldValues({
    profile: { location: 'Bellingen', state: 'NSW' },
    person: { street_address: '12 Hyde St' },
    data: {},
  });
  assert.equal(bag.street_address, '12 Hyde St');
  assert.equal(bag.location, 'Bellingen');
  assert.equal(bag.state, 'NSW');
});

// ── One validator ──────────────────────────────────────────────────────────
test('⭐⭐ completeness goes through the SHARED engine, and DOB reads absent without a dob', () => {
  const result = evaluateVolunteerProfile(['DOB'], {
    profile: { age: '31' }, person: {}, data: {},
  });
  assert.equal(result.items[0].state, 'absent');
  assert.equal(result.canSubmit, false);
});

test('⚠ "no prior experience" SATISFIES the experience requirement', () => {
  // A system that read it as blank would nag a first-time volunteer forever and
  // treat their honesty as an incomplete profile.
  const result = evaluateVolunteerProfile(['VOLUNTEER_EXPERIENCE'], {
    data: { volunteerExperience: 'NONE' },
  });
  assert.equal(result.items[0].state, 'satisfied');
});

test('a fully answered volunteer satisfies every field key a festival may ask', () => {
  /**
   * ⭐ THE END-TO-END CHECK: the bag composer feeds every non-asset key in
   * `FESTIVAL_ROLE_REQUESTABLE_KEYS`. A key nothing can ever fill is a
   * requirement that traps whoever it is asked of.
   */
  const fieldKeys = FESTIVAL_ROLE_REQUESTABLE_KEYS
    .filter(k => REQUIREMENT_KEYS[k]?.kind === 'profile_field');
  const result = evaluateVolunteerProfile(fieldKeys, {
    profile: {
      avatar: 'https://example.test/a.png', location: 'Bellingen',
      contact_email: 'a@example.test', emergency_name: 'Sam', age: 'ignored',
    },
    person: { dob: '1990-04-02', street_address: '12 Hyde St' },
    data: {
      currentProfession: 'Rigger', volunteerExperience: 'EXPERIENCED',
      experienceDescription: 'Two years', industryExperience: 'Some',
      skills: 'Rigging', capabilities: ['WHITE_CARD'],
    },
  });
  const unmet = result.items.filter(i => i.state !== 'satisfied').map(i => i.key);
  assert.deepEqual(unmet, [], `unfillable requirement keys: ${unmet.join(', ')}`);
});

test('every field the config names a requirement for exists in the shared registry', () => {
  // A `requirementKey` that resolves to nothing renders as its own key and can
  // never be satisfied — the engine surfaces it as `unknown` rather than losing
  // it, but a festival would still be asking for something nobody can answer.
  for (const f of VOLUNTEER_PROFILE_FIELDS) {
    if (!f.requirementKey) continue;
    assert.ok(REQUIREMENT_KEYS[f.requirementKey], `${f.requirementKey} is not a registry key`);
  }
});
