import { EmptyState, LoadingState, Callout, Tag, ParticipationBadge } from '../design-system';
import { useRepositories } from '../data/dataContext';
import { useShell } from '../shell/shellContext';
import { useQuery } from '../data/useQuery';
import { participantType } from '../config/participantTypes';
import s from './PeopleWorkspace.module.css';

/**
 * PEOPLE — the DESKTOP workspace. "Is everyone who is part of this event
 * ready to participate?"
 *
 * ⚠⚠ THIS IS NOT THE COMPANION SCREEN AT A WIDER MEASURE. `companion/
 * PeopleScreen` is the phone build — one column, cards, thumb-reachable.
 * Desktop is the full-screen workspace: a fixed frame with a dense table, the
 * same frame Applications uses, because an organiser works a roster here the
 * way they work an inbox there. ⛔ Do not merge the two into one responsive
 * component; the shell comment already states why — a docked inspector and a
 * persistent sidebar have no mobile equivalent, and pretending otherwise
 * produces a desktop layout squeezed onto a phone.
 *
 * ⭐⭐ THE ROW IS A PARTICIPATION RECORD, NOT AN APPLICATION. That is why the
 * owner, staff, a directly-invited headliner and manually-added crew can
 * appear at all — none of them applied. ⛔ Never approximate this roster from
 * accepted applications: it renders exactly those people as absent.
 *
 * ⭐⭐ ONE ROW PER PERSON, MANY ROLES, grouped in the database so no caller can
 * drift from it. ⛔ Never one row per role — two rows makes the organiser ask
 * "have I already dealt with this person?" and they get chased twice.
 *
 * ⚠ NO SELECTION, DELIBERATELY. The docked inspector is an APPLICATION
 * inspector: it decides, and it writes through `applications.decide`. Handing
 * it a participation row would offer Accept and Decline on somebody who is
 * already part of the event. ⛔ People needs its own inspector before a row
 * becomes clickable, and until then the dock correctly reads "Nothing
 * selected" rather than lying about what it holds.
 *
 * ⚠ WHAT IS DELIBERATELY NOT HERE, so nobody reads its absence as done:
 *   ⛔ READINESS — the spec's second column, derived per participant type with
 *     a plain "Ready when: …". The checks do not exist; a column that always
 *     said "Ready" would be a lie on every row. ⛔ Nobody ever marks a person
 *     Ready.
 *   ⛔ ADD PERSON — the spec's PRIMARY action, because it is what proves
 *     participation does not secretly depend on applications.
 *   ⛔ No filters, no search, no paging. ⚠ When they arrive they are ARGUMENTS
 *     TO A QUERY, never operations on the array this component was handed.
 */
export default function PeopleWorkspace() {
  const { people } = useRepositories();
  const { dataVersion } = useShell();

  // ⚠ `dataVersion` in the deps for the same reason Applications has it: an
  // acceptance taken in the inspector WRITES a participation row, so this
  // roster must re-read rather than keep showing the event as it was.
  const { data, loading, error } = useQuery(() => people.list(), [people, dataVersion]);

  const roster = data ?? [];
  const showEmpty = !loading && !error && roster.length === 0;

  return (
    <section className={s.workspace}>
      <header className={s.header}>
        <div className={s.titleGroup}>
          <h1 className={s.title}>People</h1>
          {/* ⭐ The count only appears once there is one. "0 people" beside a
              heading is a worse empty state than the empty state. */}
          {!loading && !error && roster.length > 0 && (
            <span className={s.count}>
              {roster.length} {roster.length === 1 ? 'person' : 'people'}
            </span>
          )}
        </div>
        <p className={s.sub}>Everyone who is part of this event.</p>
      </header>

      <div className={s.wrap}>
        {error ? (
          /* ⛔ NOT an empty state. "Nobody yet" and "we could not read it" are
             opposite facts, and the calm one tells an organiser their festival
             is empty when it is not. */
          <div className={s.pad}>
            <Callout tone="danger" title="Could not load the roster">
              {error.message}
            </Callout>
          </div>
        ) : (
          <table className={s.table}>
            <thead className={s.head}>
              <tr>
                <th className={s.colAvatar} scope="col"><span className="sr-only">Avatar</span></th>
                <th className={s.colPerson} scope="col">Person</th>
                <th className={s.colRoles} scope="col">Roles</th>
              </tr>
            </thead>
            <tbody>
              {roster.map(person => <PersonRow key={person.key} person={person} />)}
            </tbody>
          </table>
        )}

        {loading && <div className={s.pad}><LoadingState variant="rows" rows={6} /></div>}

        {showEmpty && (
          <div className={s.pad}>
            <EmptyState
              icon="volunteer"
              title="Nobody yet"
              body="People will appear here once you accept your first application. You’ll also be able to add crew and staff directly, without an application."
            />
          </div>
        )}
      </div>
    </section>
  );
}

function PersonRow({ person }) {
  return (
    <tr className={s.row}>
      <td className={s.colAvatar}><span className={s.avatar} aria-hidden="true" /></td>

      <td className={s.colPerson}>
        <span className={s.name}>
          {person.name ?? (
            // ⛔ NEVER A FABRICATED NAME. This is an erased or unclaimed
            // account; "Unknown volunteer" would read as somebody actually
            // called that.
            <em className={s.nameless}>No name on record</em>
          )}
        </span>
        {person.location && <span className={s.meta}>{person.location}</span>}
      </td>

      {/* ⭐ THE STATUS SITS BESIDE ITS ROLE, never once per person. Someone can
          be accepted as an artist and confirmed as a volunteer, and a single
          person-level status would have to pick one and silently drop the
          other. */}
      <td className={s.colRoles}>
        <span className={s.roles}>
          {person.roles.map(role => {
            const type = participantType(role.type);
            return (
              <span key={role.participationId} className={s.role}>
                <Tag tone={type.tone}>{type.label}</Tag>
                <ParticipationBadge status={role.status} />
              </span>
            );
          })}
        </span>
      </td>
    </tr>
  );
}
