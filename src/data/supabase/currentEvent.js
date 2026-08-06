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

/**
 * ⭐ THE SELECTED EVENT IS THE PORTAL'S CONTEXT.
 *
 * Every pane — the dashboard, the counts, the topbar, the editor — reads
 * whichever event this names. It replaced a heuristic ("first one taking
 * applications, else the newest") that silently decided for the organiser and
 * would have switched under them the moment they created next year's event.
 *
 * Persisted, because context that resets on reload is not context: an
 * organiser working through 2027's music applications must not be returned to
 * 2026 by a refresh.
 */
const STORAGE_KEY = 'yespleez.festival.selectedEventId';

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function getSelectedEventId() {
  return readStored();
}

export function setSelectedEventId(id) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode */ }
  cached = null;
}

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
  // ⭐ A missing profile is a STATE, not an error. It is how every new
  // organiser arrives, and the app answers it with onboarding — throwing here
  // turned "welcome" into a crash for anyone whose profile was not hand-made
  // in SQL.
  if (!profile) return { profile: null, events: [], current: null };

  const { data: events, error: evErr } = await supabase
    .from('events')
    .select('id, name, status, is_public, applications_open, postcode, created_at')
    .eq('owner_profile_id', profile.id)
    .order('created_at', { ascending: false });
  if (evErr) throw evErr;
  // ⭐ Zero events is also a state — a brand-new festival that has not created
  // its first year. `current` is null and every event-scoped surface says so
  // plainly rather than crashing.
  if (!events?.length) return { profile, events: [], current: null };

  // ⭐ Explicit choice first. The fallbacks below only ever run for an account
  // that has never chosen — or one whose chosen event has since been deleted,
  // where silently landing on nothing would be worse than landing on the
  // newest.
  const selectedId = readStored();
  const current =
    (selectedId && events.find(e => e.id === selectedId))
    || events.find(e => e.applications_open)
    || events[0];

  return { profile, events, current };
}

export function getFestivalContext() {
  if (!cached) cached = resolve().catch(err => { cached = null; throw err; });
  return cached;
}
