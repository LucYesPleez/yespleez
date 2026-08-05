import { useMemo } from 'react';
import { DataContext } from './dataContext';
import { festivalRepository } from './supabase/festivalRepository';
import { categoryRepository } from './supabase/categoryRepository';
import { applicationRepository } from './supabase/applicationRepository';

/**
 * THE SWAP POINT.
 *
 * ⭐ This is the single file that changes when the portal gets a backend.
 * Repositories are injected, so a Supabase implementation is a different
 * object satisfying the same contract — no screen, no component and no hook
 * learns that anything moved.
 *
 * It also means the whole UI stays testable without a network: pass fake
 * repositories in and every screen renders.
 *
 * ⚠ Do not import a repository directly anywhere else. One direct import is
 * all it takes for a screen to be permanently coupled to in-memory data, and
 * it will not fail until the day someone tries to swap it.
 *
 * ✅ THE SWAP HAPPENED. These are the Supabase implementations, reading the
 * same project as the Scene app. No screen, component or hook changed — which
 * is the whole thing the interface was for. The in-memory versions remain in
 * `./memory/` as the fixtures the UI can still be rendered against without a
 * network.
 */
const DEFAULT_REPOSITORIES = {
  festivals: festivalRepository,
  categories: categoryRepository,
  applications: applicationRepository,
};

export default function DataProvider({ repositories, children }) {
  const value = useMemo(
    () => ({ ...DEFAULT_REPOSITORIES, ...repositories }),
    [repositories],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
