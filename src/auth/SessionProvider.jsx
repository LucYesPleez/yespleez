import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../data/supabase/client';
import { SessionContext } from './sessionContext';

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next ?? null);
      setLoading(false);
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
