/**
 * THE /start ANSWERS, AND WHERE EACH ONE LEADS.
 *
 * O3 asked this once, after signup. O4 makes it revisitable from Help
 * (owner, 2026-08-12: "so it can be revisited later and used to add/activate
 * additional roles without replacing existing roles") — which means the
 * answers can no longer assume the person has nothing yet.
 *
 * ⭐⭐ A ROLE YOU ALREADY HAVE OPENS ITS DASHBOARD, NOT ITS SETUP FORM.
 * `/start` used to send "I'm an artist" to the artist SETUP screen every
 * time. RoleSelectorScreen has always guarded exactly this
 * (`!setupTypes.has('artist')`), and the two surfaces asking the same
 * question must not answer it differently.
 *
 * ⚠ The data layer is not what was at risk — the setup screens prefill from
 * the existing row and `upsert` on (user_id, type), so a revisit edits rather
 * than duplicating or blanking. What was at risk is the SENTENCE: offering
 * "Set up an artist profile so you can apply for gigs" to somebody who set
 * one up last week reads as an invitation to start over, and that is the
 * "replacing" the brief rules out.
 *
 * ⭐ ACTIVATING IS ADDITIVE, ALWAYS. `activateRole` appends to
 * `yp_active_roles` and never removes; picking a second role is a second
 * entry, ⛔ never a swap. That is the whole "account is universal, roles are
 * contextual" model — see the punter/contextual-roles record.
 */

/**
 * ⭐ `tier` IS THE HIERARCHY, IN DATA. Four primary pathways, then the quieter
 * "something else" (owner, 2026-08-12: headline → primary choices → something
 * else → skip). The screen reads this rather than special-casing a key, so the
 * order and the emphasis cannot drift apart.
 *
 * `accent` alternates pink/cyan down the list — the brand's two colours as a
 * thin edge, ⛔ never as a fill.
 */
export const START_ANSWERS = Object.freeze([
  {
    key: 'browse',
    label: 'FIND THINGS HAPPENING',
    desc: "See what's happening around you.",
    to: '/',
    tier: 'primary',
    accent: 'neon',
  },
  {
    key: 'artist',
    label: "I'M AN ARTIST / PERFORMER",
    desc: 'Build your profile and find opportunities.',
    // What it says once the profile exists — the answer stays, its promise
    // changes from "set this up" to "here it is".
    haveDesc: 'Open your artist dashboard.',
    role: 'artist',
    to: '/industry/artist/setup',
    haveTo: '/industry/artist',
    tier: 'primary',
    accent: 'neon2',
  },
  {
    key: 'host',
    label: 'I HOST EVENTS',
    desc: 'Run events and build lineups.',
    haveDesc: 'Open your host dashboard.',
    role: 'host',
    to: '/industry/host/setup',
    haveTo: '/industry/host',
    tier: 'primary',
    accent: 'neon',
  },
  {
    key: 'venue',
    label: "I'M A VENUE",
    desc: 'Put your room on the scene.',
    haveDesc: 'Open your venue dashboard.',
    role: 'venue',
    to: '/industry/venue/setup',
    haveTo: '/industry/venue',
    tier: 'primary',
    accent: 'neon2',
  },
  /**
   * ⛔ THERE IS NO FIFTH "just looking around" ANSWER, AND THERE MUST NOT BE
   * ONE (owner, 2026-08-12). It navigated to '/' with `replace: true` — which
   * is character for character what "Skip for now" beneath the list already
   * does. Two controls doing one thing is a choice the reader has to make for
   * no reason, and the quieter of the two was competing with the four
   * pathways for attention it could never repay.
   *
   * ⚠ If a "browse instead" answer is ever wanted back, check first that it
   * does something Skip does not.
   */
]);

/**
 * Where an answer leads, given the profile types this account already holds.
 * `existingTypes` is any iterable of type strings ('artist', 'venue', …).
 */
export function startAnswerDestination(answer, existingTypes = []) {
  const have = existingTypes instanceof Set ? existingTypes : new Set(existingTypes);
  if (answer?.role && answer.haveTo && have.has(answer.role)) return answer.haveTo;
  return answer?.to ?? '/';
}

/** The line under an answer — its promise, which changes once it is true. */
export function startAnswerDesc(answer, existingTypes = []) {
  const have = existingTypes instanceof Set ? existingTypes : new Set(existingTypes);
  if (answer?.role && answer.haveDesc && have.has(answer.role)) return answer.haveDesc;
  return answer?.desc ?? '';
}
