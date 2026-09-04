/**
 * THE VOLUNTEER ROLE PROFILE — the model between the config and the screen.
 *
 * ⭐⭐ `config/volunteerProfile.js` says WHAT the fields are. This says what a
 * stored `festival_role_profiles.data` blob may contain, how a form becomes
 * one, and how a canonical profile plus a role profile become the bag of held
 * values the shared requirements engine evaluates.
 *
 * ⛔⛔ NO REACT AND NO SUPABASE IN THIS FILE. The classification rules are the
 * part worth testing, and a rule that can only be exercised by rendering a
 * screen is a rule nothing checks.
 *
 * ⭐ THE THREE LAYERS, and why the code keeps saying so:
 *
 *   `profiles`               canonical identity — name, photo, location,
 *                            contact email, emergency contact, suburb/state
 *   `person_private`         the PERSON, keyed by ACCOUNT — dob, street
 *                            address. One human, one date of birth, however
 *                            many profiles that account holds.
 *   `festival_role_profiles` the reusable ROLE answer — "what kind of
 *                            volunteer am I", true again next year
 *
 * ⛔ And the fourth, which never reaches this file: `festival_applications
 * .answers` — availability, departments, the festival's own questions.
 */

/* ⚠ EXPLICIT `.js` EXTENSIONS, unlike the rest of this app. Vite resolves
   extensionless relative imports; Node's ESM loader does not, and this module
   is imported by a `node --test` suite. Dropping one breaks the suite with a
   module-not-found that reads like a missing file. */
import { evaluate, FESTIVAL_ROLE_REQUESTABLE_KEYS } from '@yespleez/requirements';
import PARTICIPANT_TYPES from '../config/participantTypes.js';
import {
  VOLUNTEER_PROFILE_FIELDS,
  VOLUNTEER_DATA_KEYS,
} from '../config/volunteerProfile.js';

/**
 * ⭐⭐ THE ROLE KEY IS A FOREIGN KEY, not a label.
 *
 * `festival_role_profiles.role_key` references
 * `participation_type_ceiling.participant_type`, and `config/participantTypes`
 * is this app's copy of exactly those rows. So a typo here is not a cosmetic
 * fault — it is an insert the database rejects, at the moment somebody presses
 * Save on work they have just spent five minutes typing.
 *
 * ⛔ Do not inline the string anywhere else; the test asserts this key resolves
 * through the ceiling, and a second literal would not be covered by it.
 */
export const VOLUNTEER_ROLE_KEY = 'volunteer';

/** Does a role key name a real participation type? The client-side half of the
 *  foreign key, so a bad key fails in a test rather than in production. */
export function isKnownRoleKey(key) {
  return Object.prototype.hasOwnProperty.call(PARTICIPANT_TYPES, key);
}

/** Fields whose value is a LIST of choice keys rather than a single value. */
const isMulti = field => Boolean(field.choices && field.multiple);

/**
 * A blank form. Every field is present, so a controlled input never flips from
 * uncontrolled to controlled halfway through typing.
 */
export function emptyVolunteerData() {
  const out = {};
  for (const f of VOLUNTEER_PROFILE_FIELDS) out[f.key] = isMulti(f) ? [] : '';
  return out;
}

/**
 * A stored blob becomes a form.
 *
 * ⚠⚠ AN UNRECOGNISED CAPABILITY IS KEPT, NOT DROPPED. `capabilityLabel()`
 * already renders an unknown key as itself for exactly this reason: a claim
 * stored by a newer vocabulary must still appear, and silently deleting
 * somebody's Blue Card because this build has not heard of it is data loss
 * disguised as tidiness.
 *
 * ⛔ THE FIELD KEYS ARE A DIFFERENT MATTER, and the asymmetry is deliberate.
 * An unknown FIELD is not a future vocabulary, it is availability or a
 * department that has leaked out of an application — the one thing this layer
 * exists to keep out. So values are tolerant and keys are strict.
 */
export function readVolunteerData(source) {
  const raw = (source && typeof source === 'object' && !Array.isArray(source))
    ? (source.data && typeof source.data === 'object' ? source.data : source)
    : {};
  const out = emptyVolunteerData();

  for (const f of VOLUNTEER_PROFILE_FIELDS) {
    const v = raw[f.key];
    if (v == null) continue;
    if (isMulti(f)) {
      // Deduped, order preserved, non-strings discarded — a stored `null` in
      // the array would render as a blank chip nobody can remove.
      out[f.key] = [...new Set((Array.isArray(v) ? v : [v]).filter(x => typeof x === 'string' && x))];
    } else {
      out[f.key] = String(v);
    }
  }
  return out;
}

/**
 * A form becomes the blob to store.
 *
 * ⭐ AN EMPTY ANSWER IS OMITTED RATHER THAN STORED AS `''`. The rendering
 * contract distinguishes absent from withheld, and a key present with an empty
 * string claims the question was answered with nothing. Absent means nobody has
 * answered yet, which is the truth.
 *
 * ⚠ "No prior volunteer experience" is NOT an empty answer — it is the stored
 * string `NONE`, and it survives this function untouched. That distinction is
 * the whole reason `EXPERIENCE_LEVELS` has a `NONE` entry.
 */
export function writeVolunteerData(form) {
  const out = {};
  for (const f of VOLUNTEER_PROFILE_FIELDS) {
    const v = form?.[f.key];
    if (isMulti(f)) {
      const list = Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : [];
      if (list.length) out[f.key] = [...new Set(list)];
    } else {
      const text = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
      if (text) out[f.key] = text;
    }
  }
  return out;
}

/**
 * ⭐⭐ THE HELD-VALUES BAG — canonical profile + private person + role profile,
 * flattened into the shape `@yespleez/requirements` evaluates.
 *
 * The package knows nothing about festivals, roles or which table a value came
 * from; it reads `profile[def.column]` and asks whether it is filled. Composing
 * that bag is the CALLER's job, and this is the caller. ⛔ Do not teach the
 * engine where these values live — that is the boundary the whole PP1 split was
 * for.
 *
 * ⛔⛔ `profiles.age` IS DESTRUCTURED OUT BY NAME AND NEVER REACHES THE BAG.
 * It is a self-described free-text field holding things like "31" and
 * "prefer-not-to-say", and a festival asking for a date of birth is asking an
 * eligibility question. `person_private.dob` is the authoritative answer, and
 * the absence of one must read as ABSENT rather than being papered over by a
 * string somebody typed into a different question years ago.
 *
 * ⚠ The DOB requirement's column is literally named `age` in the registry. That
 * is the engine's key, not a claim about what the value is — the value handed
 * over here is always a date of birth or nothing.
 */
export function volunteerHeldValues({ profile, person, data } = {}) {
  const { age: _selfDescribedAge, ...canonical } = profile || {};
  const role = readVolunteerData(data);

  return {
    ...canonical,

    // ── person_private, the ONE authoritative source for these two ──────
    age: person?.dob || null,
    street_address: person?.street_address || null,

    // ── festival_role_profiles.data ────────────────────────────────────
    current_profession:     role.currentProfession || null,
    volunteer_experience:   role.volunteerExperience || null,
    experience_description: role.experienceDescription || null,
    industry_experience:    role.industryExperience || null,
    skills:                 role.skills || null,

    /**
     * ⛔⛔ AN EMPTY ARRAY IS TRUTHY, and the engine's `filled` predicate is
     * `!!(v && v !== 'N/A')`. Handing `[]` over would report QUALIFICATIONS as
     * satisfied for somebody who has ticked nothing — a requirement that
     * silently passes is worse than one that wrongly blocks, because nobody
     * ever looks at it again.
     *
     * ⚠ Only PRESENCE is consulted. The joined string is never displayed; the
     * chips render from the stored array via `capabilityLabel`.
     */
    qualifications: role.capabilities.length ? role.capabilities.join(',') : null,
  };
}

/**
 * How complete is this person's volunteer profile against what is asked?
 *
 * ⭐⭐ ONE VALIDATOR. `evaluate` is the same function that decides whether an
 * artist may submit an enquiry, and routing this through it is what stops a
 * second definition of "answered" appearing in the portal and drifting.
 * ⛔ Do not count answered fields here.
 *
 * @param {string[]} keys   requirement keys a festival asks for; defaults to
 *                          everything a personal role may be asked
 * @param {object}   parts  { profile, person, data, assets }
 */
export function evaluateVolunteerProfile(keys, parts = {}) {
  const asked = Array.isArray(keys) && keys.length ? keys : FESTIVAL_ROLE_REQUESTABLE_KEYS;
  return evaluate(asked, {
    profile: volunteerHeldValues(parts),
    assets: parts.assets || [],
  });
}

/** The reusable field keys, re-exported so a caller need not reach past this
 *  module into the config to learn what may be stored. */
export { VOLUNTEER_DATA_KEYS };
