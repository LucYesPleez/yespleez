import { supabase } from './supabase';
import { PUBLIC_PROFILE_SELECT } from './publicProfileColumns';
/* ⚠ actingProfile imports only ./supabase, so this direction cannot cycle. */
import { PERFORMER_TYPES } from './actingProfile';

// M5 — the shared profile-resolution module. One platform-wide way to build
// profile URLs and resolve /profile/:id route params.
//
// profiles.id is the permanent public identity. The ?type= param is retained
// on canonical URLs during the migration (approved refinement): it gives
// deterministic routing for multi-profile owners on legacy URLs, stable
// self-describing deep links, and easier debugging. Reconsider only after M8.

export function profileUrl(profile) {
  if (!profile?.id) return null;
  return profile.type ? `/profile/${profile.id}?type=${profile.type}` : `/profile/${profile.id}`;
}

// Resolves a /profile/:id route param to a profiles row.
//   1. Canonical: profiles.id = routeId  (every URL the app emits post-M5)
//   2. Legacy:    profiles.user_id = routeId (pre-M5 bookmarks/shares) —
//      callers must redirect to profileUrl(profile) on isLegacyHit.
// The type-precedence chain is byte-identical to the pre-M5 ProfileScreen
// lookup, so legacy multi-type URLs disambiguate exactly as they always have.
export async function resolveProfileRoute(routeId, { typeFilter, preferPerformer } = {}) {
  const applyTypeFilter = (query) => {
    if (typeFilter) return query.eq('type', typeFilter);
    /**
     * ⛔⛔ A POSITIVE LIST, ⛔ NEVER "not host, not venue". The negative form
     * was already out of date: `PLATFORM_TYPES.festival` exists in
     * lib/profileTypes.js and this filter silently admitted it as a performer,
     * so a legacy `/profile/:userId?prefer=performer` link on an account that
     * owns both a festival and an act could resolve to the festival and render
     * it as the act.
     *
     * ⚠ `lib/venueEventsFeed` argues this exact point at length — "'not punter'
     * is a rule about the ONE type that must never be published, and it
     * silently accepts the other five" — and the reasoning was never carried
     * here. A new profile type must have to ASK to be a performer.
     */
    if (preferPerformer) return query.in('type', PERFORMER_TYPES);
    return query.neq('type', 'punter');
  };

  // ⛔⛔ NOT `select('*')`, AND THE REASON IS NOT TIDINESS. This is the ONE
  // anonymous path that reads a whole profile row, so `*` handed a signed-out
  // stranger every column on the table — `email`, `emergency_phone`, `abn`.
  // ⚠ It also breaks the moment those columns are revoked from `anon`:
  // Postgres errors on `SELECT *` when one column is denied rather than
  // omitting it, so this narrowing must ship BEFORE the revoke, not after.
  // ⭐ The list is derived from the table, so nothing the page renders is lost.
  let res = await applyTypeFilter(supabase.from('profiles').select(PUBLIC_PROFILE_SELECT).eq('id', routeId)).limit(1);
  if (res.data?.[0]) return { profile: res.data[0], isLegacyHit: false };

  res = await applyTypeFilter(supabase.from('profiles').select(PUBLIC_PROFILE_SELECT).eq('user_id', routeId)).limit(1);
  if (res.data?.[0]) return { profile: res.data[0], isLegacyHit: true };

  return { profile: null, isLegacyHit: false };
}
