import { supabase } from './client';

/**
 * WHICH FESTIVAL, WHICH EVENT.
 *
 * ⭐ THE EVENT IS THE PLATFORM'S EVENT. A festival creates an ordinary
 * `events` row owned by its profile — it is not a bespoke "edition". That is
 * what gives the application round a public URL, a poster, dates and a page
 * for free, and it is why `festival_editions` no longer exists.
 *
 * ⚠ Do not read `events.config`. The Scene app's rule is that nothing outside
 * its `eventViewModel` interprets that blob, and a second reader in another
 * repository is exactly how two apps start disagreeing about what an event
 * says. Top-level columns only.
 *
 * The cache holds the PROMISE, not the value, so concurrent callers during
 * first paint share one round trip instead of racing.
 */
let cached = null;

export function resetEventCache() {
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

  const { data: events, error: evErr } = await supabase
    .from('events')
    .select('id, name, status, is_public, applications_open, postcode, created_at')
    .eq('owner_profile_id', profile.id)
    .order('created_at', { ascending: false });
  if (evErr) throw evErr;
  if (!events?.length) throw new Error('This festival has no events yet');

  // An event still taking applications wins over a newer one that is not —
  // the organiser is working on the round people are actually applying to.
  const current = events.find(e => e.applications_open) || events[0];
  return { profile, events, current };
}

export function getFestivalContext() {
  if (!cached) cached = resolve().catch(err => { cached = null; throw err; });
  return cached;
}
