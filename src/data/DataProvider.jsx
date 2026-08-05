import { useMemo } from 'react';
import { DataContext } from './dataContext';
import { festivalRepository } from './memory/festivalRepository';
import { categoryRepository } from './memory/categoryRepository';
import { applicationRepository } from './memory/applicationRepository';

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
