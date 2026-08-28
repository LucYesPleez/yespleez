import { EmptyState, LoadingState, Callout, Tag, Icon, ParticipationBadge } from '../design-system';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';
import { participantType } from '../config/participantTypes';
import s from './PeopleScreen.module.css';

/**
 * PEOPLE — "is everyone who is part of this event ready?"
 *
 * ⭐ THE ROOM EXISTED BEFORE ITS DATA DID, on purpose. Stable navigation is
 * ratified: a destination is a map, not a recommendation, and hiding it until
 * the first acceptance would move the furniture under someone who had already
 * learned where things are.
 *
 * ⛔ This is NOT "the rest of the applications". People is strictly
 * post-acceptance — the boundary is Accepted, not decided, so a waitlisted
 * person is still an applicant and does not appear here.
 *
 * ⭐⭐ THE ROW IS A PARTICIPATION RECORD, NOT AN APPLICATION. That is why the
 * owner, staff, a directly-invited headliner and manually-added crew can
 * appear at all — none of them ever applied. ⛔ Never approximate this roster
 * from accepted applications: it would render exactly those people as absent.
 *
 * ⭐⭐ ONE ROW PER PERSON, MANY ROLES. Someone can perform AND volunteer at the
 * same festival; that is two participation records and ONE person. ⛔ Never one
 * row per role — two rows makes the organiser ask "have I already dealt with
 * this person?", and they get chased twice. The grouping is done in the
 * database so no caller can drift from it.
 *
 * ⚠ WHAT IS DELIBERATELY NOT HERE YET, so nobody reads its absence as done:
 *   ⛔ READINESS — the spec's second column, derived per participant type with
 *     a plain "Ready when: …". It needs per-type checks that do not exist yet,
 *     and a readiness column that always said "Ready" would be a lie on every
 *     row. ⛔ Nobody ever marks a person Ready.
 *   ⛔ ADD PERSON — the spec calls it the PRIMARY action because it is what
 *     proves participation does not secretly depend on applications. Until it
 *     exists, this roster can only show people who came through acceptance.
 *   ⛔ No inspector, no filters, no per-person detail.
 */
export default function PeopleScreen() {
  const { people } = useRepositories();
  const { data, loading, error } = useQuery(() => people.list(), [people]);

  if (loading) return <Shell><LoadingState variant="rows" rows={4} /></Shell>;

  if (error) {
    return (
      <Shell>
        {/* ⛔ NOT an empty state. "Nobody yet" and "we could not read it" are
            opposite facts, and showing the calm one for a failure tells the
            organiser their festival is empty when it is not. */}
        <Callout tone="danger" title="Could not load the roster">
          {error.message}
        </Callout>
      </Shell>
    );
  }

  const roster = data ?? [];

  if (roster.length === 0) {
    return (
      <Shell>
        <EmptyState
          icon="volunteer"
          title="Nobody yet"
          body="People will appear here once you accept your first application. You’ll also be able to add crew and staff directly, without an application."
        />
      </Shell>
    );
  }

  return (
    <Shell count={roster.length}>
      <ul className={s.list}>
        {roster.map(person => <PersonRow key={person.key} person={person} />)}
      </ul>
    </Shell>
  );
}

function Shell({ count, children }) {
  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>People</h1>
        <p className={s.sub}>
          {/* ⭐ The count is stated only when there IS one. "0 people" as a
              subtitle is a worse empty state than the empty state. */}
          {count == null
            ? 'Everyone who is part of this event.'
            : `${count} ${count === 1 ? 'person' : 'people'} on this event.`}
        </p>
      </header>
      {children}
    </div>
  );
}

function PersonRow({ person }) {
  // ⭐ THE ROLES CARRY THE STATUSES, and a person can hold two roles at two
  // different statuses — accepted as an artist, confirmed as a volunteer. So
  // the status belongs BESIDE each role, never once at the person level where
  // it would have to pick one and silently drop the other.
  return (
    <li className={s.row}>
      <span className={s.avatar} aria-hidden="true" />

      <span className={s.body}>
        <span className={s.name}>
          {person.name ?? (
            // ⛔ NEVER A FABRICATED NAME. This is an erased or unclaimed
            // account; saying so is honest, and "Unknown volunteer" would read
            // as somebody who is actually called that.
            <em className={s.nameless}>No name on record</em>
          )}
        </span>
        {person.location && (
          <span className={s.meta}>
            <Icon name="location" size={12} /> {person.location}
          </span>
        )}
      </span>

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
    </li>
  );
}
