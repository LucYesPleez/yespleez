import { useParams } from 'react-router-dom';
import StatsRow from './StatsRow';
import ApplicationsWorkspace from './ApplicationsWorkspace';
import { useInspector } from '../layout/useInspector';
import { APPLICATION_CATEGORIES } from '../config/navigation';

/**
 * One route serves every category.
 *
 * Nine near-identical screens would be nine places to fix the same bug. The
 * category is a URL parameter, the workspace is the same component, and the
 * only thing that varies is which rows the data layer will eventually return.
 *
 * An unknown category renders the workspace unfiltered rather than a 404 — a
 * stale bookmark to a retired category should show the list, not a dead end.
 */
export default function ApplicationsScreen() {
  const { category } = useParams();
  const { selection, setSelection } = useInspector();
  const known = APPLICATION_CATEGORIES.find(c => c.key === category);

  return (
    <>
      <StatsRow />
      <ApplicationsWorkspace
        category={known?.key}
        selection={selection}
        onSelect={setSelection}
      />
    </>
  );
}
