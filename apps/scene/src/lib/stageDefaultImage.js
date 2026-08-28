/**
 * THE PICTURE A STAGE LENDS AN ACT THAT HAS NONE.
 *
 * ⚠⚠ WHY THE STAGE AND NOT THE ACT'S TYPE. A workshop is not a profile type and
 * must never become one — `profileTypes.js` says so explicitly: the eight
 * festival roles (volunteer · market stall · food vendor · workshop · decor ·
 * media · theme camp · performance artist) live in the Portal's registry, and
 * keeping them out of Scene's is what stops vendors leaking into Scene
 * discovery. Workshop acts are also hand-entered with no profile at all
 * (`artist_id` and `artist_profile_id` both null), so there is no type to read.
 *
 * ⭐ The stage IS the statement. An organiser who makes a WORKSHOPS & GALLERY
 * stage and puts a yoga class on it has already said what kind of thing this
 * is; without this, `SlotCard` fell through to `profileIdentity('artist')` and
 * a yoga class wore a DJ's photograph.
 *
 * ⛔⛔ MATCHED ON THE STAGE'S NAME, AND THAT IS A KNOWN WEAKNESS, NOT A DESIGN.
 * Rename the stage and the image silently reverts to the DJ default — no error,
 * no warning, just the wrong picture again. The durable fix is a `kind` column
 * on `event_stages` that the organiser sets, so the image follows declared data
 * rather than a string. ⭐ Do that before a second stage kind is added; one
 * match is survivable, a table of them is not.
 *
 * ⚠ Deliberately NOT a general "guess the vibe from the name" mechanism. One
 * entry, one asset, and an unknown stage returns null so the existing
 * type-default path runs untouched.
 */

/**
 * ⭐ ART GALLERY AND WORKSHOPS SHARE ONE ENTRY because on Neverland Weekender
 * they share one STAGE — "WORKSHOPS & GALLERY" carries the Saturday 1pm gallery
 * booking alongside the morning workshops. ⛔ Do not split this into two rules
 * until they are two stages; a second pattern that can never match is a lie
 * about what the app knows.
 */
export const WORKSHOP_IMAGE = '/defaultworkshop.jpg';

const STAGE_DEFAULTS = [
  { test: /workshop|gallery/i, image: WORKSHOP_IMAGE },
];

/**
 * @param {string|null|undefined} stageName the stage's own name
 * @returns {string|null} an image path, or null when the stage says nothing
 */
export function stageDefaultImage(stageName) {
  if (!stageName) return null;
  const hit = STAGE_DEFAULTS.find(d => d.test.test(stageName));
  return hit ? hit.image : null;
}

/**
 * ⭐⭐ IS THIS A WORKSHOP / GALLERY STAGE? Asked by the LINEUP rail, which lists
 * these acts AFTER the music (owner, 2026-08-28) — a reader scanning the bill is
 * looking for who is playing, and seven yoga and jewellery classes at the front
 * answer a question they did not ask.
 *
 * ⛔ ONE PLACE KNOWS WHICH STAGES THESE ARE. The image default and the bill
 * order are two consequences of the same fact, and a second regex somewhere
 * else is how they start disagreeing — the picture saying "workshop" while the
 * order says "music". ⛔ Do not inline `/workshop|gallery/i` anywhere again.
 *
 * ⚠ Same weakness as the image: it reads the stage's NAME. See the header.
 */
export function isWorkshopStage(stageName) {
  return stageDefaultImage(stageName) === WORKSHOP_IMAGE;
}
