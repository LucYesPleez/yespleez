import { useState } from 'react';
import { Button, Callout, Tag, TextInput } from '../design-system';
import { useRepositories } from '../data/dataContext';
import PARTICIPANT_TYPES, { participantType } from '../config/participantTypes';
import { profileTypeLabel } from '../config/profileTypes';
import s from './AddPerson.module.css';

/**
 * ADD PERSON — the action that defines the People room.
 *
 * ⭐⭐ NOT BECAUSE IT IS COMMON. Because without it, participation is still
 * secretly dependent on applications: the owner, the staff, the directly
 * invited headliner and the crew never applied to anything.
 *
 * ⛔⛔ A FESTIVAL PARTICIPANT IS A REGISTERED YESPLEEZ USER — ratified by the
 * owner 2026-08-29. ⛔ There is no name-only, unclaimed or placeholder person.
 * Someone who is not registered registers first, and the copy says so plainly
 * rather than leaving an organiser searching for a name that will never appear.
 *
 * ⚠⚠ The tempting counter-example is the set list's hand-entered external DJ
 * names. Those are PLACEHOLDERS FOR LINEUP DISPLAY — a slot on a bill, not a
 * person with a relationship to the event. ⛔ Not a precedent.
 *
 * ⭐ AN INLINE PANEL, ⛔ NOT A MODAL. This product states consequences beside
 * the control rather than in a dialog after the click, and the one docked pane
 * it has is the inspector. A modal here would be the only one in the product.
 */
export default function AddPerson({ onAdded, onClose }) {
  const { people } = useRepositories();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null);
  const [role, setRole] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  async function runSearch(e) {
    e?.preventDefault();
    setError('');
    setSearching(true);
    try {
      const rows = await people.search(query);
      setResults(rows);
      setSearched(true);
    } catch (err) {
      setError(err.message);
    }
    setSearching(false);
  }

  function pick(profile) {
    setPicked(profile);
    // ⭐ THE ROLE IS PRE-SELECTED FROM THE IDENTITY, because that is what the
    // organiser almost always means: you add a band as a band. ⛔ But it stays
    // changeable — the same person is often also a volunteer.
    setRole(rolesFor(profile)[0]);
    setError('');
  }

  async function submit() {
    if (!picked || !role) return;
    setBusy(true);
    setError('');
    try {
      await people.add({ profileId: picked.id, participantType: role });
      onAdded?.();
    } catch (err) {
      // ⛔ THE SERVER'S WORDS, NOT A GENERIC FAILURE. An unclaimed profile is
      // refused by name ("not claimed by a registered account yet"), and that
      // sentence tells the organiser what to do. Replacing it with "Could not
      // add" would throw away the only useful part.
      setError(readable(err.message));
      setBusy(false);
    }
  }

  return (
    <section className={s.panel} aria-label="Add a person">
      <header className={s.head}>
        <h2 className={s.title}>Add a person</h2>
        <Button variant="ghost" size="sm" icon="close" onClick={onClose} aria-label="Close" />
      </header>

      <p className={s.lede}>
        Search for someone already on YesPleez. If they are not registered yet,
        they will need an account before they can be added to the event.
      </p>

      <form className={s.search} onSubmit={runSearch}>
        <TextInput
          label="Name"
          placeholder="Search people and acts…"
          value={query}
          onChange={e => { setQuery(e.target.value); setSearched(false); }}
        />
        <Button variant="secondary" size="sm" type="submit" disabled={query.trim().length < 2 || searching}>
          {searching ? 'Searching…' : 'Search'}
        </Button>
      </form>

      {/* ⛔ Absent, not empty. Before a search has run there is nothing to say,
          and "no results" would be a false statement about an unasked question. */}
      {searched && results.length === 0 && (
        <p className={s.none}>
          Nobody on YesPleez matches “{query.trim()}”. They will need to register first.
        </p>
      )}

      {results.length > 0 && (
        <ul className={s.results}>
          {results.map(profile => {
            const isPicked = picked?.id === profile.id;
            return (
              <li key={profile.id}>
                <button
                  type="button"
                  className={`${s.result} ${isPicked ? s.resultPicked : ''}`}
                  onClick={() => pick(profile)}
                  aria-pressed={isPicked}
                  /* ⚠⚠ WITHOUT THIS THE BUTTON IS NAMELESS to assistive tech —
                     the visible text sits in nested spans the accessibility
                     tree does not fold into a name. Caught by `read_page`, and
                     ⛔ invisible to a screenshot and to every test. The same
                     defect shipped once on My Scene's application rows. */
                  aria-label={`${profile.name}, ${profileTypeLabel(profile.type)}`}
                >
                  <span className={s.resultName}>{profile.name}</span>
                  <span className={s.resultMeta}>
                    {profileTypeLabel(profile.type)}
                    {profile.location ? ` · ${profile.location}` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {picked && (
        <div className={s.confirm}>
          <div className={s.roles}>
            <span className={s.rolesLabel}>Add {picked.name} as</span>
            <span className={s.roleChoices}>
              {rolesFor(picked).map(key => {
                const t = participantType(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`${s.roleBtn} ${role === key ? s.roleOn : ''}`}
                    onClick={() => setRole(key)}
                    aria-pressed={role === key}
                  >
                    <Tag tone={role === key ? t.tone : 'neutral'}>{t.label}</Tag>
                  </button>
                );
              })}
            </span>
          </div>

          <Button variant="primary" size="sm" onClick={submit} disabled={busy || !role}>
            {busy ? 'Adding…' : 'Add to event'}
          </Button>
        </div>
      )}

      {error && <Callout tone="danger" title="Not added">{error}</Callout>}
    </section>
  );
}

/**
 * ⭐ THE SENTENCE, ⛔ NOT THE FUNCTION NAME.
 *
 * Postgres `RAISE EXCEPTION` messages arrive prefixed with the function that
 * raised them — `add_event_participant: that profile is not claimed…`. The
 * sentence after the colon was written FOR the organiser and says what to do;
 * the prefix is for us, and shipping it makes a deliberate, helpful refusal
 * read like a crash the reader is expected to report.
 *
 * ⛔ It strips only OUR prefix pattern. Anything else — a network failure, a
 * message with a colon in it for another reason — passes through untouched,
 * because inventing friendlier words for an error we did not write is how a
 * real cause gets hidden.
 */
function readable(message = '') {
  return message.replace(/^[a-z_]+:\s*/, '');
}

/**
 * ⭐ WHICH ROLES A PROFILE MAY HOLD.
 *
 * Its own type when that type is a participant type, plus Volunteer — which
 * every account can be, because a volunteer participates as the PERSON and
 * needs no role profile at all.
 *
 * ⛔ NOT the whole participant list. Offering "Add this punter as a Band" is an
 * invitation to create a credit that is simply false, and nothing downstream
 * would ever catch it.
 */
function rolesFor(profile) {
  const own = PARTICIPANT_TYPES[profile.type] ? [profile.type] : [];
  return [...own, 'volunteer'];
}
