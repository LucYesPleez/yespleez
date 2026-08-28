import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../data/supabase/client';
import { SessionContext } from './sessionContext';
// Analytics v2 (Phase G): the portal's collector starts with the session,
// exactly as Scene's does — attribution before the first ping, and the
// account kept current on every auth change.
import { initAnalytics, setAnalyticsUser } from '../lib/analytics';

/**
 * THE SESSION.
 *
 * Auth is shared with the Scene app — same Supabase project, same users — so
 * an organiser signs in with the account they already have. This provider adds
 * no account system of its own.
 *
 * ⚠ `active` is declared inside the effect, so each run gets its own flag and
 * a remount cannot leave it permanently false. The opposite pattern (a ref set
 * false on cleanup and never back to true) already made `useQuery` load
 * forever under StrictMode — do not reintroduce it here.
 */
export default function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      setLoading(false);
    });

    // The collector awaits the session itself before its first ping, so
    // starting it here (not after getSession resolves) loses nothing and
    // records the landing page even for a visit that never authenticates.
    initAnalytics();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next ?? null);
      setLoading(false);
      setAnalyticsUser(next?.user?.id ?? null);
    });

    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  const signOut = useCallback(async () => { await supabase.auth.signOut(); }, []);

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, loading, signOut }),
    [session, loading, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
