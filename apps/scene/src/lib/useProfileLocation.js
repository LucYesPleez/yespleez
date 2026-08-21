import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/** The key My Scene already caches the punter's postcode under. */
const CACHE_KEY = '_userPostcode';

/**
 * THE USER'S HOME POSTCODE — the default search area for What's On.
 *
 * ⭐ ONE LOCATION, NOT A SECOND ONE. This reads the SAME punter profile column
 * and the SAME localStorage cache My Scene has always used, so a person has one
 * home town across the app rather than a My Scene location and a What's On
 * location that can disagree. ⛔ Do not add a What's On specific location
 * store; if this needs to change, it changes on the profile.
 *
 * ⚠ THE CACHE IS READ SYNCHRONOUSLY, ON PURPOSE. Waiting for the query would
 * open What's On with no location, then jolt the whole catalogue sideways a
 * moment later. The profile row still wins when it arrives — the cache is a
 * head start, never the source of truth.
 *
 * ⚠ Signed out returns '', which is not a failure: What's On shows the whole
 * guide, which is the right answer for someone we know nothing about. ⛔ Never
 * make this a gate — nobody should have to set a location to browse.
 */
export function useProfileLocation(uid) {
  const [postcode, setPostcode] = useState(() => {
    try { return localStorage.getItem(CACHE_KEY) || ''; } catch { return ''; }
  });

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('postcode')
        .eq('user_id', uid)
        .eq('type', 'punter')
        .limit(1);
      if (!alive || error) return;               // keep the cached value
      const pc = data?.[0]?.postcode || '';
      if (!/^\d{4}$/.test(pc)) return;           // a blank profile never clears a good cache
      setPostcode(pc);
      try { localStorage.setItem(CACHE_KEY, pc); } catch { /* private mode */ }
    })();
    return () => { alive = false; };
  }, [uid]);

  return postcode;
}
