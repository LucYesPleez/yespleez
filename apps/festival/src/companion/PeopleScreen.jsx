import { EmptyState } from '../design-system';
import s from './HomeScreen.module.css';

/**
 * PEOPLE — "is everyone who is part of this event ready?"
 *
 * ⭐ THE ROOM EXISTS BEFORE ITS DATA DOES, on purpose. Stable navigation is
 * ratified: a destination is a map, not a recommendation, and hiding it until
 * the first acceptance would move the furniture under someone who had already
 * learned where things are.
 *
 * ⛔ This is NOT "the rest of the applications". People is strictly
 * post-acceptance — the boundary is Accepted, not decided, so a waitlisted
 * person is still an applicant and does not appear here.
 *
 * ⚠ The roster itself waits on participation records, which do not exist yet.
 * ⛔ Do not approximate it from accepted applications: an accepted application
 * is not a confirmed person, and the whole point of the participation model is
 * that the difference is real. Owners, directly invited artists and manually
 * added crew never had an application at all, and an applications-derived
 * roster renders them as absent rather than as people.
 */
export default function PeopleScreen() {
  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>People</h1>
        <p className={s.sub}>Everyone who is part of this event.</p>
      </header>

      <EmptyState
        icon="volunteer"
        title="Nobody yet"
        body="People will appear here once you accept your first application. You’ll also be able to add crew and staff directly, without an application."
      />
    </div>
  );
}
