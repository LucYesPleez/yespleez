/**
 * THE VOLUNTEER ROLE PROFILE — the reusable half.
 *
 * ⭐⭐ THIS IS `festival_role_profiles.data` WHERE `role_key = 'volunteer'`, and
 * nothing else. Everything here answers "what kind of volunteer am I?" and
 * would still be true at a different festival next year.
 *
 * ⛔⛔ WHAT IS DELIBERATELY NOT HERE, because it belongs elsewhere:
 *
 *   name, email, mobile, photo, suburb/state/postcode/country
 *                                      → `profiles`, the canonical identity
 *   date of birth, street address       → `person_private`, keyed by ACCOUNT
 *   the Blue Card / licence itself      → a CLEARANCE profile asset
 *   availability, departments, shifts,
 *   friends, department-head request,
 *   motivation, festival questions      → `festival_applications.answers`
 *
 * ⚠ THE TEST FOR EVERY FIELD: does the answer change per festival? Availability
 * and department preferences obviously do, and putting them here would freeze
 * one festival's answers into a person's permanent record.
 *
 * ⭐ Derived from the Earth Frequency 2026 and Rabbit Eat Lettuce volunteer
 * forms, ⛔ not copied from them. The EFF *staff* form is structurally
 * identical with "Event Industry Experience" in place of "Volunteering
 * Experience" — which is why this file describes a ROLE's field set rather than
 * volunteering specifically, and why Worker will be a sibling entry rather than
 * a second architecture.
 */

/**
 * ⭐⭐ STRUCTURED CLAIMS — the part an organiser can actually FILTER ON.
 *
 * Both reference forms use a checkbox list here, and both say why in their own
 * words: "some tasks require a qualification e.g. blue card, driver licence,
 * white card". A free-text paragraph cannot be matched against a department's
 * requirement, so the controlled vocabulary is the point.
 *
 * ⛔⛔ A CLAIM IS NOT EVIDENCE. Ticking BLUE_CARD says "I have one"; it does not
 * prove it, and it must never satisfy a requirement that asks for the document.
 * Earth Frequency's own form makes the same distinction — Blue Card appears as
 * a qualification checkbox AND as its own dedicated upload. The evidence lives
 * in a CLEARANCE profile asset. ⭐ The claim is for MATCHING, the file is for
 * PROOF, and the two must never be collapsed into one field.
 *
 * ⚠ `key` is stored. ⛔ Never rename one — a stored claim would silently stop
 * matching, and nothing would report it. Add, deprecate, but do not rename.
 */
export const VOLUNTEER_CAPABILITIES = [
  { key: 'ADMINISTRATION',   label: 'Administration' },
  { key: 'CUSTOMER_SERVICE', label: 'Customer Service' },
  { key: 'FOOD_PREPARATION', label: 'Food Preparation' },
  { key: 'HOSPITALITY',      label: 'Hospitality' },
  { key: 'BUILDING_CARPENTRY', label: 'Building / Carpentry' },
  { key: 'STAGE_MANAGEMENT', label: 'Stage Management' },
  { key: 'EVENT_MANAGEMENT', label: 'Event Management' },
  /**
   * ⚠ THE THREE BELOW NAME A DOCUMENT SOMEBODY HOLDS, and that is exactly why
   * they are claims rather than proof. A festival that needs the document asks
   * for the CLEARANCE asset; this only says the conversation is worth having.
   */
  { key: 'DRIVERS_LICENCE',  label: "Open Driver's Licence", evidence: 'CLEARANCE' },
  { key: 'WHITE_CARD',       label: 'White Card (construction)', evidence: 'CLEARANCE' },
  { key: 'BLUE_CARD',        label: 'Blue Card (working with children)', evidence: 'CLEARANCE' },
];

export const CAPABILITY_KEYS = VOLUNTEER_CAPABILITIES.map(c => c.key);

/** ⭐ Which claims name a document. Used to prompt for evidence, ⛔ never to
 *  treat the claim as satisfied by itself. */
export const EVIDENCE_BACKED_CAPABILITIES =
  VOLUNTEER_CAPABILITIES.filter(c => c.evidence).map(c => c.key);

export function capabilityLabel(key) {
  return VOLUNTEER_CAPABILITIES.find(c => c.key === key)?.label ?? key;
}

/**
 * ⭐ HAS THIS PERSON ANSWERED THE EXPERIENCE QUESTION AT ALL?
 *
 * ⚠⚠ "No prior volunteer experience" IS AN ANSWER, ⛔ not an empty one. Earth
 * Frequency offers it as an explicit choice, and a system that treated it as
 * blank would nag a first-time volunteer forever and read their honesty as an
 * incomplete profile. ⭐ Absent and "none" are different, and the requirements
 * engine must see the difference.
 */
export const EXPERIENCE_LEVELS = [
  { key: 'NONE',        label: 'No prior volunteer experience' },
  { key: 'OTHER_EVENTS', label: 'Volunteered at other events' },
  { key: 'EXPERIENCED', label: 'Experienced event volunteer' },
];

/**
 * THE FIELD SET, in the order the editor renders it.
 *
 * ⚠ `requirementKey` ties a field to the shared requirements engine, so a
 * festival can require it and the ONE validator decides whether it is
 * satisfied. ⛔ Do not add a second completeness check anywhere.
 */
export const VOLUNTEER_PROFILE_FIELDS = [
  { key: 'currentProfession',     requirementKey: 'CURRENT_PROFESSION',
    label: 'Current job or profession',
    help: 'Work roles or skills that might be relevant — organisers use this when allocating.' },

  { key: 'volunteerExperience',   requirementKey: 'VOLUNTEER_EXPERIENCE',
    label: 'Volunteering experience', choices: EXPERIENCE_LEVELS },

  { key: 'experienceDescription', requirementKey: 'EXPERIENCE_DESCRIPTION',
    label: 'Tell us about it', multiline: true,
    help: 'Previous volunteering — the role, the event, and the year.' },

  { key: 'industryExperience',    requirementKey: 'INDUSTRY_EXPERIENCE',
    label: 'Event industry experience', multiline: true,
    help: 'Paid event work, if any. Different from volunteering, and useful for different roles.' },

  { key: 'skills',                requirementKey: 'SKILLS',
    label: 'Skills', multiline: true },

  /**
   * ⚠ `multiple` IS THE ONLY THING SEPARATING THIS FROM THE EXPERIENCE FIELD
   * ABOVE, and without it the editor would have to name a field by key to know
   * how to draw it. Both carry `choices`; one takes an answer, this one takes
   * a LIST of them. ⛔ A renderer that hardcodes `key === 'capabilities'` stops
   * working the day a second multi-select field is added, and does so silently.
   */
  { key: 'capabilities',          requirementKey: 'QUALIFICATIONS',
    label: 'Qualifications and tickets', choices: VOLUNTEER_CAPABILITIES, multiple: true,
    help: 'What you hold. Some festivals ask for the document itself as well.' },

  /**
   * ⭐ THE FREE TEXT SITS BESIDE THE LIST, ⛔ never instead of it. The list is
   * what a requirement can match; this catches the thing no vocabulary
   * anticipated, and a controlled list with no escape hatch quietly tells
   * people their qualification does not count.
   */
  { key: 'qualificationsNote',    requirementKey: null,
    label: 'Anything else', multiline: true, optional: true },
];

/** ⭐ The reusable field keys — what a caller may store in `data`. ⛔ Anything
 *  not here is festival-specific and belongs on the application. */
export const VOLUNTEER_DATA_KEYS = VOLUNTEER_PROFILE_FIELDS.map(f => f.key);
