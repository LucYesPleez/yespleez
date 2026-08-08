import { useParams } from 'react-router-dom';
import ApplicationsWorkspace from '../applications/ApplicationsWorkspace';

/**
 * THE PRIMARY SCREEN OF THE PORTAL.
 *
 * One route, every category. `/applications` and `/applications/:category`
 * both land here; the parameter selects a configuration, not a screen.
 *
 * Three lines because it should be: it reads the category from the URL and
 * hands it down. Resolving what that category IS belongs to the repository,
 * not to a screen — otherwise the screen would have to change the day
 * categories start living in a database.
 */
export default function ApplicationsScreen() {
  const { category } = useParams();
  return <ApplicationsWorkspace categoryKey={category} />;
}
