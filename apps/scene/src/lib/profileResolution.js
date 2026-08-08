import { supabase } from './supabase';

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
    if (preferPerformer) return query.neq('type', 'punter').not('type', 'in', '("host","venue")');
    return query.neq('type', 'punter');
  };

  let res = await applyTypeFilter(supabase.from('profiles').select('*').eq('id', routeId)).limit(1);
  if (res.data?.[0]) return { profile: res.data[0], isLegacyHit: false };

  res = await applyTypeFilter(supabase.from('profiles').select('*').eq('user_id', routeId)).limit(1);
  if (res.data?.[0]) return { profile: res.data[0], isLegacyHit: true };

  return { profile: null, isLegacyHit: false };
}
