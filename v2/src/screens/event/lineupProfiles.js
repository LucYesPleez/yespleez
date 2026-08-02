// Resolving a lineup member to the profile behind it.
//
// ⚠ THE JOIN KEY IS `artist_profile_id`. `artist_id` is the legacy column and
// is read only for rows written before the identity migration.
//
// This existed inline in useEventData and was gated the other way round:
//
//   filter(m => m.artist_id && m.artist_profile_id)      // fetch
//   if (!m.artist_id) return;                            // index
//
// Every row the Gig Importer writes carries `artist_profile_id` and a NULL
// `artist_id` — the importer attaches a profile, it does not invent a user
// account, and an unclaimed profile has no user to point at. So those rows
// failed both guards: their profiles were never fetched and never indexed, and
// the lineup rendered a bare name with no avatar, no genre, no sound and no
// tap-through to the profile that was sitting right there in the data.
//
// It was 25 of 57 lineup_members on the day this was fixed — the single
// largest group, and every event imported from here on adds to it.
//
// The map is keyed by `lineup_members.id`, not by either artist column. That
// is the only identifier every row actually has; keying by a column that half
// the rows leave NULL is what produced the bug in the first place.

/** Which ids the two profile queries need. Split by which column resolves them. */
export function memberProfileKeys(members = []) {
  const profileIds = [];
  const userIds    = [];
  (members || []).forEach(m => {
    if (!m) return;
    if (m.artist_profile_id) profileIds.push(m.artist_profile_id);
    else if (m.artist_id)    userIds.push(m.artist_id);
  });
  return { profileIds: [...new Set(profileIds)], userIds: [...new Set(userIds)] };
}

/**
 * @param members      lineup_members rows
 * @param byProfileId  { [profiles.id]: row }
 * @param byUserId     { [profiles.user_id]: row }
 * @returns            { [lineup_members.id]: row } — members with no profile are absent
 */
export function indexMemberProfiles(members = [], byProfileId = {}, byUserId = {}) {
  const out = {};
  (members || []).forEach(m => {
    if (!m || !m.id) return;
    // Profile id wins wherever both are present: it is the canonical
    // authority, and for an owner with several profiles the user_id join is
    // ambiguous (M5.1 · D2).
    const p = m.artist_profile_id ? byProfileId[m.artist_profile_id]
            : m.artist_id         ? byUserId[m.artist_id]
            : null;
    if (p) out[m.id] = p;
  });
  return out;
}
