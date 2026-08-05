import { supabase } from './client';

/**
 * WHICH FESTIVAL, WHICH EDITION.
 *
 * The signed-in organiser owns a profile of type `festival`; that profile owns
 * editions. Everything else in this folder hangs off the answer, so it is
 * resolved once and cached for the session rather than re-queried per screen.
 *
 * ⚠ The cache holds the PROMISE, not the value, so concurrent callers during
 * first paint share one round trip instead of racing three.
 *
 * Deliverance has one festival and one edition. `listEditions` exists because
 * the model has always had editions; the UI only reveals them at the second.
 */
let cached = null;

export function resetEditionCache() {
  cached = null;
}

async function resolve() {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  if (!user) throw new Error('Not signed in');

  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('id, name, tagline, bio, location, website')
    .eq('type', 'festival')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profErr) throw profErr;
  if (!profile) throw new Error('This account owns no festival profile');

  const { data: editions, error: edErr } = await supabase
    .from('festival_editions')
    .select('id, name, year, starts_on, ends_on, location, status')
    .eq('festival_profile_id', profile.id)
    .order('year', { ascending: false });
  if (edErr) throw edErr;
  if (!editions?.length) throw new Error('This festival has no editions');

  // Newest first, and an open edition wins over a newer archived one — the
  // organiser is working on the round that is actually taking applications.
  const current = editions.find(e => e.status === 'open') || editions[0];
  return { profile, editions, current };
}

export function getFestivalContext() {
  if (!cached) cached = resolve().catch(err => { cached = null; throw err; });
  return cached;
}
