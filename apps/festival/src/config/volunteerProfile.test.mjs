import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VOLUNTEER_CAPABILITIES, CAPABILITY_KEYS, EVIDENCE_BACKED_CAPABILITIES,
  EXPERIENCE_LEVELS, VOLUNTEER_PROFILE_FIELDS, VOLUNTEER_DATA_KEYS,
  capabilityLabel,
} from './volunteerProfile.js';

/**
 * THE VOLUNTEER ROLE PROFILE — the boundaries that must not move.
 *
 * ⚠ These pin the CLASSIFICATION, which is the part of this work that was
 * argued over and ratified. The field set can grow; what a field IS may not
 * change without the ruling changing first.
 */

// ── The layer boundary ─────────────────────────────────────────────────────
test('⛔ canonical identity never appears in the role profile', () => {
  // name/email/mobile/photo live on `profiles`; duplicating them creates two
  // truths and a stale one.
  for (const k of ['firstName', 'lastName', 'name', 'email', 'mobile', 'phone', 'photo', 'avatar']) {
    assert.ok(!VOLUNTEER_DATA_KEYS.includes(k), `${k} is canonical identity, not role data`);
  }
});

test('⛔ private person data never appears in the role profile', () => {
  // Ratified: DOB and street address are person-level and live in
  // `person_private`, keyed by ACCOUNT — an account holds several profiles and
  // a person has one date of birth.
  for (const k of ['dob', 'dateOfBirth', 'age', 'streetAddress', 'address', 'emergencyContact']) {
    assert.ok(!VOLUNTEER_DATA_KEYS.includes(k), `${k} belongs to person_private or profiles`);
  }
});

test('⛔⛔ festival-specific answers never appear in the role profile', () => {
  /**
   * The whole point of the split. Availability and department preferences
   * change per festival; freezing one festival's answers into a permanent
   * profile is the failure this architecture exists to prevent.
   */
  for (const k of ['availability', 'dates', 'departments', 'tasks', 'shifts',
                   'friends', 'departmentHead', 'motivation', 'whyYou']) {
    assert.ok(!VOLUNTEER_DATA_KEYS.includes(k), `${k} is application data, not profile data`);
  }
});

// ── Claim vs evidence ──────────────────────────────────────────────────────
test('⛔⛔ a capability is a CLAIM and never carries its own proof', () => {
  /**
   * Ticking BLUE_CARD says "I have one". It does not prove it, and it must
   * never satisfy a requirement that asks for the document. Earth Frequency's
   * form makes the same distinction — Blue Card is a checkbox AND a separate
   * dedicated upload.
   */
  for (const c of VOLUNTEER_CAPABILITIES) {
    assert.ok(!('verified' in c), `${c.key} must not carry a verified flag`);
    assert.ok(!('proof' in c),    `${c.key} must not carry proof`);
    assert.ok(!('document' in c), `${c.key} must not embed a document`);
  }
});

test('the document-backed claims point at CLEARANCE, not at themselves', () => {
  assert.deepEqual(EVIDENCE_BACKED_CAPABILITIES,
    ['DRIVERS_LICENCE', 'WHITE_CARD', 'BLUE_CARD']);
  for (const key of EVIDENCE_BACKED_CAPABILITIES) {
    const c = VOLUNTEER_CAPABILITIES.find(x => x.key === key);
    assert.equal(c.evidence, 'CLEARANCE', `${key} must name the asset type that proves it`);
  }
});

// ── The structured list, and why it is structured ──────────────────────────
test('qualifications are a controlled vocabulary, with free text BESIDE it', () => {
  // The list is what a festival requirement can match against; the free text
  // catches what no vocabulary anticipated. ⛔ Neither replaces the other.
  const quals = VOLUNTEER_PROFILE_FIELDS.find(f => f.key === 'capabilities');
  const note  = VOLUNTEER_PROFILE_FIELDS.find(f => f.key === 'qualificationsNote');
  assert.ok(Array.isArray(quals.choices) && quals.choices.length > 0);
  assert.ok(note.multiline && note.optional, 'the escape hatch must exist and be optional');
});

test('⚠ "no prior experience" is an ANSWER, not an empty field', () => {
  // A system that read it as blank would nag a first-time volunteer forever
  // and treat their honesty as an incomplete profile.
  assert.ok(EXPERIENCE_LEVELS.some(l => l.key === 'NONE'));
});

// ── Keys are stored, so they are pinned ────────────────────────────────────
test('⛔ capability keys are stored — renaming one silently stops it matching', () => {
  assert.deepEqual(CAPABILITY_KEYS, [
    'ADMINISTRATION', 'CUSTOMER_SERVICE', 'FOOD_PREPARATION', 'HOSPITALITY',
    'BUILDING_CARPENTRY', 'STAGE_MANAGEMENT', 'EVENT_MANAGEMENT',
    'DRIVERS_LICENCE', 'WHITE_CARD', 'BLUE_CARD',
  ]);
  assert.equal(new Set(CAPABILITY_KEYS).size, CAPABILITY_KEYS.length, 'duplicate key');
});

test('an unknown key renders as itself rather than vanishing', () => {
  // A stored claim from a future vocabulary must still name something.
  assert.equal(capabilityLabel('SOMETHING_NEW'), 'SOMETHING_NEW');
  assert.equal(capabilityLabel('BLUE_CARD'), 'Blue Card (working with children)');
});

// ── Every field the engine can require must name a real key ────────────────
test('requirement keys line up with the shared engine', () => {
  const named = VOLUNTEER_PROFILE_FIELDS.map(f => f.requirementKey).filter(Boolean);
  assert.deepEqual(named, [
    'CURRENT_PROFESSION', 'VOLUNTEER_EXPERIENCE', 'EXPERIENCE_DESCRIPTION',
    'INDUSTRY_EXPERIENCE', 'SKILLS', 'QUALIFICATIONS',
  ]);
});
