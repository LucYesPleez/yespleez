// Resolving an application to the profile that submitted it.
//
// ⚠ THE JOIN KEY IS `from_profile_id`. `artist_id` is the legacy column: it
// holds a USER id, not a profile id, and it is read only for rows M6c could
// not resolve.
//
// This is the applications counterpart of `screens/event/lineupProfiles.js`,
// deliberately the same shape — same split-the-keys / index-by-row-id pattern,
// same "profile id wins wherever both are present" rule. One problem, one
// solution, twice applied; not two dialects of the same idea.
//
// ── WHY `artist_id` CANNOT SIMPLY BE DROPPED ──
//
// `applications.from_profile_id` is NULLABLE BY RATIFIED DECISION. M6c
// backfilled it only where the applicant's account owned exactly ONE profile
// of an applicable type (U4: "a plausible reconstruction is worse than an
// honest null"). Every row where the account owned two or more — precisely the
// multi-profile people this migration exists to serve — is still NULL and
// always will be.
//
// So a read narrowed to `.eq('from_profile_id', …)` alone does not migrate
// those rows, it DELETES them from the result. The legacy key stays as a
// fallback until the data says otherwise, and the fallback is per-row, not
// per-query.
//
// ── WHY THE MAP IS KEYED BY `applications.id` ──
//
// The previous code keyed profile maps by `artist_id` — the account. For a
// person with a DJ alias and a band, two applications to the same event
// collapse to one key and both rows render the same profile. `id` is the only
// identifier every row actually has. This is the same defect lineupProfiles.js
// was written to fix, in a different table.

/** Which ids the two profile queries need. Split by which column resolves them. */
export function applicantProfileKeys(apps = []) {
  const profileIds = [];
  const userIds    = [];
  (apps || []).forEach(a => {
    if (!a) return;
    if (a.from_profile_id) profileIds.push(a.from_profile_id);
    else if (a.artist_id)  userIds.push(a.artist_id);
  });
  return { profileIds: [...new Set(profileIds)], userIds: [...new Set(userIds)] };
}

/**
 * @param apps         applications rows
 * @param byProfileId  { [profiles.id]: row }
 * @param byUserId     { [profiles.user_id]: row }
 * @returns            { [applications.id]: row } — applications with no resolvable profile are absent
 */
export function indexApplicantProfiles(apps = [], byProfileId = {}, byUserId = {}) {
  const out = {};
  (apps || []).forEach(a => {
    if (!a || !a.id) return;
    // Profile id wins wherever both are present: it is the canonical
    // authority, and for an account with several profiles the user_id join is
    // ambiguous — it answers "a profile this person owns", not "the profile
    // that applied".
    const p = a.from_profile_id ? byProfileId[a.from_profile_id]
            : a.artist_id       ? byUserId[a.artist_id]
            : null;
    if (p) out[a.id] = p;
  });
  return out;
}

/**
 * Fetch and index the profiles behind a set of applications, in one call.
 *
 * `db` is passed in rather than imported so this module stays free of the
 * Supabase client and remains testable with a plain fake — the same reason
 * `lineupProfiles.js` is pure and `useEventData` does its own fetching. Here
 * the fetch is identical at four call sites, so it lives in one place.
 *
 * @param db    a Supabase client (or anything with the same `.from().select().in()` shape)
 * @param apps  applications rows
 * @param cols  the column list to select — MUST include `id` and `user_id`
 * @returns     { [applications.id]: profile row }
 */
export async function fetchApplicantProfiles(db, apps, cols) {
  // Without `id` the profile-id map is silently empty and every migrated row
  // loses its profile — a failure that looks exactly like "this artist has no
  // profile". Fail loudly at the call site instead.
  if (!/\bid\b/.test(cols))      throw new Error('fetchApplicantProfiles: cols must include `id`');
  if (!/\buser_id\b/.test(cols)) throw new Error('fetchApplicantProfiles: cols must include `user_id`');

  const { profileIds, userIds } = applicantProfileKeys(apps);
  if (!profileIds.length && !userIds.length) return {};

  const [byIdRes, byUidRes] = await Promise.all([
    profileIds.length ? db.from('profiles').select(cols).in('id', profileIds)   : Promise.resolve({ data: [] }),
    userIds.length    ? db.from('profiles').select(cols).in('user_id', userIds) : Promise.resolve({ data: [] }),
  ]);
  const byProfileId = {}; (byIdRes.data  || []).forEach(p => { byProfileId[p.id] = p; });
  const byUserId    = {}; (byUidRes.data || []).forEach(p => { byUserId[p.user_id] = p; });
  return indexApplicantProfiles(apps, byProfileId, byUserId);
}

/**
 * Narrow an `applications` query to one applicant.
 *
 * Profile-scoped when the caller knows which profile it means; account-scoped
 * otherwise. The account fallback is the pre-identity behaviour and no worse
 * than before — but it is wider than intended, so callers that CAN name a
 * profile must.
 *
 * Moved here from `notifActions.js`, which had the only correct implementation
 * of this and is now the first consumer rather than the owner.
 */
export function scopeToApplicant(query, profileId, userId) {
  return profileId ? query.eq('from_profile_id', profileId) : query.eq('artist_id', userId);
}
