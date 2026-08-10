import { ARTIST_ROLES, PERFORMANCE_ROLES, GENRE_SEP } from './profileTaxonomy';

/**
 * WHICH ASK CATEGORY DOES THIS ACT DEFAULT TO?
 * Design: `Claude Cowork\ask-category-design-2026-08-10.md`.
 *
 * ⭐⭐ IT RESOLVES FROM THE ROLE — WHAT THE ACT DOES — NOT FROM THE PROFILE TYPE.
 *
 *     the domain rule            the implementation shortcut
 *     DJ        → music          artist  → music
 *     band      → music          standup → performance_artist
 *     comedian  → performance_artist
 *
 * The right-hand column is only true because roles currently live INSIDE
 * profile types. ⚠ It stops being true the moment one person is simultaneously
 * a DJ, a comedian and a workshop facilitator — profile type answers nothing
 * then. Resolving from the role means that day needs no rewrite.
 *
 * ⛔ THIS LIVES IN SCENE, NOT IN THE PACKAGE. `@yespleez/ask-categories` owns
 * the VOCABULARY; this owns Scene's mapping onto it. The package must never
 * learn Scene's role keys — that is the consumer-identity rule, and Festival's
 * asks carry an explicitly chosen category with no resolver at all.
 *
 * ── ⭐ THE CONTRACT: THREE BRANCHES ──
 *
 *     one applicable category  →  default to it
 *     several                  →  the ASKER chooses — never guess
 *     none                     →  NULL
 *
 * ⚠ The middle branch cannot fire today: both artist roles map to `music` and
 * both standup roles map to `performance_artist`. It is implemented anyway,
 * because the alternative is a resolver that silently picks the first match the
 * day a profile does span two — and that is the failure the whole design exists
 * to prevent.
 *
 * ⚠⚠ THE BRANCH THAT DOES FIRE TODAY IS **NONE**. The enquiry picker offers
 * five profile types (host · artist · band · standup · festival) and `host` and
 * `festival` map to NOTHING: a promoter enquiring with a venue is asking to USE
 * THE ROOM, which no category covers — all nine came from a festival recruiting
 * suppliers. ⛔ Do NOT invent `venue_hire` to remove the null: neither type even
 * has a dashboard that shows enquiries (HostDashboard never reads
 * venue_enquiries; a festival profile has no Scene dashboard at all), so a
 * category would describe a flow the product does not yet support. Whether the
 * picker should offer them is a separate product question — ⛔ and this resolver
 * must not answer it by assigning a category.
 */

/** Role key → Ask Category key. ⭐ Roles, never profile types. */
const ROLE_TO_CATEGORY = {
  dj_prod: 'music',
  mc:      'music',
  comedy:  'performance_artist',
  poetry:  'performance_artist',
};

/**
 * Types whose ask is defined by the profile itself rather than a role.
 * ⚠ `band` has no role vocabulary — being a band IS the supply.
 * ⚠ `punter` is the volunteering identity: every account has one, and there is
 * no `volunteer` profile type to hold roles.
 */
const TYPE_TO_CATEGORY = {
  band:   'music',
  punter: 'volunteer',
};

/** The roles a profile has actually selected, read from `genre_string`. */
function selectedRoleKeys(profile) {
  const parts = new Set(String(profile?.genre_string || '').split(GENRE_SEP).map(t => t.trim()).filter(Boolean));
  return [...ARTIST_ROLES, ...PERFORMANCE_ROLES]
    .filter(r => parts.has(r.key))
    .map(r => r.key);
}

/**
 * Every Ask Category this profile could legitimately be asking for.
 *
 * Exported because the "several" branch needs it: a picker has to know WHICH
 * categories to offer, and reproducing this logic there is how two screens
 * start disagreeing.
 *
 * @returns {string[]} distinct category keys, possibly empty
 */
export function applicableAskCategories(profile) {
  const fromRoles = selectedRoleKeys(profile).map(k => ROLE_TO_CATEGORY[k]).filter(Boolean);
  const fromType  = TYPE_TO_CATEGORY[String(profile?.type || '').toLowerCase()];
  const all = fromType ? [...fromRoles, fromType] : fromRoles;
  return [...new Set(all)];
}

/**
 * The category to STORE on an ask created by this profile, or null.
 *
 * ⛔ NULL IS A REAL ANSWER, not a failure — see the three branches above. The
 * caller stores null and renders no chip; it must never substitute a guess.
 *
 * ⛔ A DEFAULT, NEVER A MAPPING. The stored key is the historical fact; this
 * only suggests it. An asker who can state something different must be able to
 * override it, and a later profile edit can never rewrite what was asked.
 *
 * @param {object} profile the ACTING profile
 * @returns {string|null} an Ask Category key, or null
 */
export function defaultAskCategory(profile) {
  const applicable = applicableAskCategories(profile);
  // ⛔ Several is NOT "pick the first". Ambiguity is the asker's to resolve.
  if (applicable.length !== 1) return null;
  return applicable[0];
}

/**
 * Does this profile need to be ASKED which category it means?
 *
 * Distinguishes the two nulls: "nothing applies" (host, festival — no question
 * to ask) from "more than one applies" (a real question). ⛔ A caller that
 * treats them the same either shows an empty picker or silently drops a choice.
 */
export function needsAskCategoryChoice(profile) {
  return applicableAskCategories(profile).length > 1;
}

/**
 * ⭐⭐ THE CALLER'S ENTRY POINT — ONE CALL, ALL THREE STATES.
 *
 *     none applicable       { category: null, needsChoice: false, applicable: [] }
 *     one applicable        { category: 'music', needsChoice: false, applicable: ['music'] }
 *     several applicable    { category: null, needsChoice: TRUE, applicable: [...] }
 *
 * ⛔ THIS EXISTS SO THE TWO NULLS CANNOT COLLAPSE. `defaultAskCategory()` alone
 * returns null for BOTH "nothing applies" and "the asker must choose", so a
 * caller writing `ask_category: defaultAskCategory(p)` would store null in the
 * second case and never learn a question went unasked. The resolver has already
 * distinguished them; handing back one value throws that away at the boundary.
 *
 * ⭐ Same shape, and the same reason, as `resolvePerformerProfileId`'s
 * `{ profileId, ambiguous }`: a bare id lets a caller treat "refused to guess"
 * as "no answer", which is how attribution was silently lost in acceptInvite.
 *
 * ⚠ `needsChoice` cannot be true today — no profile spans two categories. A
 * caller must still branch on it, because the day one does, the alternative is
 * a category chosen by nobody and frozen onto the record forever.
 *
 * @param {object} profile the ACTING profile
 * @returns {{category: string|null, needsChoice: boolean, applicable: string[]}}
 */
export function resolveAskCategory(profile) {
  const applicable = applicableAskCategories(profile);
  return {
    category:    applicable.length === 1 ? applicable[0] : null,
    needsChoice: applicable.length > 1,
    applicable,
  };
}
