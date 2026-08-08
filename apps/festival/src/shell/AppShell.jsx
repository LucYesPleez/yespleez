import { useState, useCallback, useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import InspectorPanel from '../inspector/InspectorPanel';
import { ShellContext } from './shellContext';
import s from './AppShell.module.css';

/**
 * THE PERMANENT SHELL. Every screen in the portal renders inside it.
 *
 * It owns exactly one thing: what the inspector is showing. That is the
 * minimum required for the UI to work and deliberately the ceiling — filters,
 * search, sorting, paging and selection sets belong to a data layer that does
 * not exist yet, and putting them here would make the shell the thing every
 * future feature has to modify.
 *
 * `inspector: false` on a route hides the dock for screens it makes no sense
 * on (Settings has nothing to inspect). The dock is otherwise PERMANENTLY
 * docked on desktop, never a drawer, never a modal.
 */
export default function AppShell() {
  const [selection, setSelection] = useState(null);

  /**
   * ⭐ A version counter, not a data store. A decision is taken in the
   * INSPECTOR and has to be reflected in the TABLE and the CATEGORY COUNTS,
   * which are sibling panes — accepting someone and watching the row keep
   * saying "Submitted" is the kind of thing that makes a reviewer stop
   * trusting the screen. Bumping this re-runs their queries.
   *
   * ⛔ Not a cache. The shell still owns exactly one piece of state; this is
   * an invalidation signal, and it must never grow into holding rows.
   */
  const [dataVersion, setDataVersion] = useState(0);

  const select = useCallback(item => setSelection(item), []);
  const clear  = useCallback(() => setSelection(null), []);
  const refreshData = useCallback(() => setDataVersion(v => v + 1), []);

  const value = useMemo(
    () => ({ selection, select, clear, dataVersion, refreshData }),
    [selection, select, clear, dataVersion, refreshData],
  );

  return (
    <ShellContext.Provider value={value}>
      <div className={s.shell}>
        <Sidebar />
        <TopBar />

        <div className={s.body}>
          <main className={s.main}>
            <Outlet />
          </main>
          <InspectorPanel selection={selection} onClose={clear} />
        </div>
      </div>
    </ShellContext.Provider>
  );
}
