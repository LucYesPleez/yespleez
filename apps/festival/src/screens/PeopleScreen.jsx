import PeopleWorkspace from '../people/PeopleWorkspace';

/**
 * THE PEOPLE ROOM — desktop.
 *
 * Thin on purpose, exactly like ApplicationsScreen: a screen resolves a route
 * and hands off. Everything about how a roster renders belongs to the
 * workspace, and everything about what a roster IS belongs to the repository.
 *
 * ⚠ Not to be confused with `companion/PeopleScreen`, which is the phone
 * build. Same room, two shells — see PeopleWorkspace's header for why they
 * are not one responsive component.
 */
export default function PeopleScreen() {
  return <PeopleWorkspace />;
}
