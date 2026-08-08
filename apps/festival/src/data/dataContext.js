import { createContext, useContext } from 'react';

/**
 * Its own module because a file exporting both a component and a hook breaks
 * React Fast Refresh — the same reason `shellContext.js` is separate.
 */
export const DataContext = createContext(null);

export function useRepositories() {
  const ctx = useContext(DataContext);
  if (!ctx) {
    // Loud, not silent. A component rendered outside the provider is a wiring
    // mistake, and returning undefined here would surface much later as
    // "the table is permanently empty".
    throw new Error('useRepositories must be used inside <DataProvider>');
  }
  return ctx;
}
