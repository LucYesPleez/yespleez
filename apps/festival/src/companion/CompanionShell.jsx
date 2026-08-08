import { useState, useCallback, useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import { ShellContext } from '../shell/shellContext';
import BottomNav from './BottomNav';
import s from './CompanionShell.module.css';

/**
 * THE COMPANION SHELL — the organiser's mobile workspace.
 *
 * ⭐ Same six-room architecture as the desktop workspace, different density.
 * This is not a second product: it is the mobile rendering of the ratified IA,
 * and the split is by the SIZE of the task rather than the size of the screen —
 * decisions and light edits here, deep configuration on desktop.
 *
 * ⭐ It provides the SAME ShellContext contract as AppShell — selection,
 * dataVersion, refreshData — so any existing screen can be rendered inside it
 * later without modification. That is deliberate: the alternative is two
 * versions of every screen, which is two places to fix every bug.
 *
 * ⛔ No inspector dock. On a phone the inspector is a route, not a pane beside
 * the list — there is no beside.
 */
export default function CompanionShell() {
  const [selection, setSelection] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);

  const select = useCallback(item => setSelection(item), []);
  const clear = useCallback(() => setSelection(null), []);
  const refreshData = useCallback(() => setDataVersion(v => v + 1), []);

  const value = useMemo(
    () => ({ selection, select, clear, dataVersion, refreshData }),
    [selection, select, clear, dataVersion, refreshData],
  );

  return (
    <ShellContext.Provider value={value}>
      <div className={s.shell}>
        <main className={s.content}>
          <Outlet />
        </main>
        <BottomNav />
      </div>
    </ShellContext.Provider>
  );
}
