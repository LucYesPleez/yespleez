import { createContext } from 'react';

/**
 * ⚠ Context only — no component in this file. A module exporting both a
 * component and a value breaks React Fast Refresh, which this repo has already
 * been bitten by twice (useInspector, the inspector tab registry).
 */
export const SessionContext = createContext({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});
