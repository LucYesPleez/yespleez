import { createContext, useContext } from 'react';

/**
 * The shell's contract with its screens.
 *
 * A context rather than Outlet props so a component ANY depth inside a screen
 * can open the inspector without every layer between passing it down. A table
 * row is four components below the route; prop drilling that would make the
 * three in between know about the inspector, which is exactly the coupling
 * that makes screens hard to move later.
 *
 * Its own module because a file exporting both a component and a hook breaks
 * React Fast Refresh.
 */
export const ShellContext = createContext(null);

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) {
    // Loud rather than silently returning undefined — a component rendered
    // outside the shell is a wiring mistake, and a soft failure here shows up
    // much later as "clicking a row does nothing".
    throw new Error('useShell must be used inside <AppShell>');
  }
  return ctx;
}
