// Shared in-memory set of FOLLOWED PROFILE ids (profiles.id / target_profile_id),
// the profile-side twin of likedEvents. Persists across navigations for the
// session lifetime so a card that has already confirmed its state does not
// re-query on every mount.
//
// ⚠ Keyed by profiles.id, NOT user_id — target_profile_id is the canonical
// key (M5.1/D6) and placeholder profiles have no user_id at all.
export const followedProfiles = new Set();
