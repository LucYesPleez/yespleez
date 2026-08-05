import { useParams } from 'react-router-dom';
import ApplicationsWorkspace from '../applications/ApplicationsWorkspace';
import { getCategory } from '../config/categories';

/**
 * THE PRIMARY SCREEN OF THE PORTAL.
 *
 * One route, every category. `/applications` and `/applications/:category`
 * both land here; the parameter selects a configuration, not a different
 * screen.
 *
 * The screen itself is four lines because it should be: it resolves a
 * category and hands it to the workspace. Everything else — tabs, toolbar,
 * table, pagination, inspector — is a component that stands on its own.
 *
 * An unknown category resolves to "All" rather than 404ing. A stale bookmark
 * to a retired category should show the list, not a dead end.
 */
export default function ApplicationsScreen() {
  const { category } = useParams();
  return <ApplicationsWorkspace category={getCategory(category)} />;
}
