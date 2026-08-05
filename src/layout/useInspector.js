import { useOutletContext } from 'react-router-dom';

/**
 * How a screen drives the docked inspector.
 *
 * Its own file rather than an export from FestivalLayout: a module that
 * exports both a component and a hook breaks React Fast Refresh, and the
 * separation is also honest — this is the shell's contract with its screens,
 * not part of the layout's markup.
 */
export function useInspector() {
  return useOutletContext();
}
