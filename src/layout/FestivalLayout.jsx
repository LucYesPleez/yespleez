import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import FestivalSidebar from './FestivalSidebar';
import FestivalTopbar from './FestivalTopbar';
import InspectorPanel from './InspectorPanel';
import { FESTIVALS } from '../config/navigation';
import s from './FestivalLayout.module.css';

/**
 * The shell.
 *
 * Owns exactly one piece of state: what the inspector is showing. That is the
 * minimum required to navigate the shell, and deliberately the ceiling —
 * anything else (filters, sorting, pagination, selection sets) belongs to the
 * screens or to a data layer that does not exist yet.
 *
 * Screens reach the inspector through `useInspector()` (its own module) rather
 * than prop drilling, so a screen can be moved or replaced without the layout
 * knowing what it renders.
 */
export default function FestivalLayout() {
  const [selection, setSelection] = useState(null);
  const festival = FESTIVALS[0];

  return (
    <div className={s.shell}>
      <FestivalSidebar />
      <FestivalTopbar festival={festival} notificationCount={3} />

      <div className={s.body}>
        <main className={s.main}>
          <Outlet context={{ selection, setSelection }} />
        </main>
        <InspectorPanel selection={selection} onClose={() => setSelection(null)} />
      </div>
    </div>
  );
}
