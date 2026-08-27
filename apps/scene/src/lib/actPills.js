/**
 * WHAT DESCRIBES AN ACT ON A CARD.
 *
 * ⛔⛔ `genre_string` HOLDS ROLE KEYS. Printing it raw leaks `dj_prod` into user
 * copy, and it did: the set-times card rendered a pill reading literally
 * `dj_prod` on every DJ, because it split the column itself and printed the
 * pieces. ⭐ `genreLabels()` is the one reader of that column — it drops role
 * keys and returns only real genres. ⛔ Never a fresh `.split()` at a call site.
 *
 * ⭐⭐ A CARD SAYS WHAT AN ACT SOUNDS LIKE, ⛔ NOT WHAT IT IS (owner,
 * 2026-08-27). A role and a profile type were both considered as a fallback so
 * that no card was ever blank, and both were REJECTED: "DJ / PROD." and "BAND"
 * describe a database, not a night. ⛔ Do not reintroduce them as a floor.
 *
 * ⭐ THE LADDER, most specific first, and it ends deliberately:
 *     card_pills   what the act chose to be described as
 *     sound        what they sound like, in their own words
 *     genres       real genres from `genre_string`, role keys removed
 *     nothing      ⚠ a real answer, not a gap to fill
 *
 * ⚠ So a DJ whose only entry is `dj_prod` shows NOTHING, exactly like a band
 * with an empty profile. That is the honest reading: neither has told us
 * anything about how they sound.
 */
import { genreLabels } from './profileTaxonomy';

/**
 * @param act  { card_pills?, sound?, genre? } — an enriched claim, a lineup
 *             member, or a profile. ⚠ `genre` is the `genre_string` column
 *             wherever it came from.
 * @returns    string[] — ready to print, ⛔ never a raw key. Empty is normal.
 */
export function actPills(act) {
  if (!act) return [];

  const chosen = Array.isArray(act.card_pills) ? act.card_pills.filter(Boolean) : [];
  if (chosen.length) return chosen;

  const sound = String(act.sound || '').trim();
  if (sound) return [sound];

  /* ⚠ `genre` may hold genres, role keys, or both — they share one column. */
  return genreLabels(act.genre);
}
