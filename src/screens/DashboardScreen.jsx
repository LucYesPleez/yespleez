import StatsRow from './StatsRow';
import ApplicationsWorkspace from './ApplicationsWorkspace';
import ActivityCard from '../components/ActivityCard';
import MessagesCard from '../components/MessagesCard';
import { useInspector } from '../layout/useInspector';
import s from './screens.module.css';

/**
 * The dashboard: stats row, applications workspace, bottom widgets.
 *
 * A composition, not a page — every part is a component that stands on its
 * own, so this file stays short enough to read in one screen and functionality
 * lands in the pieces rather than here.
 */
export default function DashboardScreen() {
  const { selection, setSelection } = useInspector();

  return (
    <>
      <StatsRow />

      <ApplicationsWorkspace
        selection={selection}
        onSelect={setSelection}
      />

      <div className={s.widgetRow}>
        <ActivityCard />
        <MessagesCard />
      </div>
    </>
  );
}
