import { supabase } from './supabase';
import { isProfileUnclaimed } from './profileClaim';

/**
 * "THERE IS ALREADY ONE OF YOU HERE."
 *
 * The importer has built most of this catalogue, so a promoter, venue or act
 * signing up frequently already EXISTS as an unclaimed row — with their gigs,
 * their history and their audience attached to it. Typing their own name into
 * a fresh profile editor is the exact moment that matters, and until now
 * nothing said a word: they finished, saved, and the scene had two of them.
 *
 * ⭐⭐ THE COST OF THE MISS IS NOT SYMMETRICAL. A duplicate profile is not a
 * tidy-up job — it splits an act's events across two identities, and the one
 * the public already follows is the one the newcomer does not own. Suggesting
 * a claim slightly too eagerly costs a glance; missing it costs a person their
 * own history.
 *
 * ⛔ SUGGESTS, NEVER ACTS. This module reads. Claiming is §07's manual-review
 * flow and stays exactly where it is, on the profile page behind ClaimDialog —
 * a second claim path would be a second set of rules about who owns what.
 */

/** Below this, the query matches half the catalogue and means nothing. */
export const MIN_QUERY = 3;

/** How many suggestions are worth showing. More is a search results page. */
export const MAX_SUGGESTIONS = 3;

/**
 * Normalise for comparison: casefolded, punctuation dropped, spaces collapsed.
 *
 * ⚠ "The Freedom Machine", "Freedom Machine" and "freedom-machine" are one
 * promoter, and a comparison that says otherwise is the comparison that lets
 * the duplicate through.
 */
export function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Drop a leading article — the single commonest reason two names differ. */
function core(s) {
  return norm(s).replace(/^(the|a)\s+/, '');
}

/**
 * How closely does `candidate` answer to `typed`?
 *
 * `exact`    the same name once normalised — almost certainly them
 * `contains` one name contains the other — probably them
 * null       no relationship worth mentioning
 *
 * ⚠ DELIBERATELY NOT FUZZY. An edit-distance match would surface "Freedom
 * Machine" for "Freedom Machines" and also "Dream Machine" for "Cream
 * Machine", and a suggestion that is wrong often enough teaches people to
 * dismiss it without reading — at which point the one that mattered goes past
 * unread too.
 */
export function matchStrength(typed, candidate) {
  const a = core(typed);
  const b = core(candidate);
  if (!a || !b || a.length < MIN_QUERY) return null;
  if (a === b) return 'exact';
  if (b.includes(a) || a.includes(b)) return 'contains';
  return null;
}

/** Exact matches first, then shortest name — the least padded is the likeliest. */
export function rank(list) {
  return [...list].sort((x, y) => {
    if (x.strength !== y.strength) return x.strength === 'exact' ? -1 : 1;
    const n = String(x.name || '').length - String(y.name || '').length;
    if (n !== 0) return n;
    return String(x.id).localeCompare(String(y.id));
  });
}

/**
 * Unclaimed profiles of `type` that answer to `typed`.
 *
 * ⚠ FILTERED IN JS, NOT ONLY IN THE QUERY. `ilike` cannot see past a leading
 * "The" or a hyphen, so the query casts a slightly wider net (a plain
 * substring) and `matchStrength` decides. The alternative — building the
 * normalisation into the SQL — would hand the client filter syntax and still
 * not handle the article.
 *
 * ⛔ NEVER surfaces a claimed profile. Someone else owns it; telling a stranger
 * "is this you?" about a person's live identity is the opposite of the point.
 *
 * @returns {Promise<Array>} up to MAX_SUGGESTIONS, best first. Empty on any
 *          failure — a suggestion is an assist, and an error here must never
 *          interrupt somebody filling in a form.
 */
export async function suggestClaimable({ typed, type, excludeId = null } = {}) {
  const term = String(typed || '').trim();
  if (term.length < MIN_QUERY || !type) return [];

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, user_id, name, type, location, suburb, avatar_thumb, avatar, claim_status')
      .eq('type', type)
      // The wide net: PostgREST needs the term escaped of its own wildcards.
      .ilike('name', `%${term.replace(/[%_]/g, '')}%`)
      .limit(20);
    if (error) return [];

    return rank((data || [])
      .filter(p => p && p.id !== excludeId)
      // ⭐ THE ONE WAY TO ASK. `isProfileUnclaimed` also treats a row whose claim is
      // already pending as unclaimed, which is right for the badge and WRONG
      // here: a second person should not be invited to claim what someone is
      // already waiting on. So pending rows are dropped as well.
      .filter(p => isProfileUnclaimed(p) && p.claim_status !== 'pending')
      .map(p => ({ ...p, strength: matchStrength(term, p.name) }))
      .filter(p => p.strength))
      .slice(0, MAX_SUGGESTIONS);
  } catch {
    return [];
  }
}
