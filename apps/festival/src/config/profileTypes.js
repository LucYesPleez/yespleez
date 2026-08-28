/**
 * HOW A PROFILE TYPE IS NAMED IN USER COPY.
 *
 * ⚠⚠ A PROFILE TYPE IS NOT A PARTICIPANT TYPE. `punter`, `venue`, `host` and
 * `festival` are identities a person can hold; they are not roles anybody
 * participates as. ⛔ Do not look a profile type up in `participantTypes.js` —
 * it falls back to rendering the key ITSELF, which is how the Add Person
 * search shipped a result reading "Luc · punter" in lowercase machine
 * vocabulary.
 *
 * ⭐ THE RULE IT BROKE is already written down: a raw role key must never reach
 * user copy. `genre_string` leaked `dj_prod` onto seven surfaces the same way,
 * and both times the fallback looked harmless because most values happened to
 * read like words.
 *
 * ⚠ An unknown type renders as itself rather than vanishing — a visibly wrong
 * label announces drift, an absent one hides it.
 */
const PROFILE_TYPE_LABELS = {
  punter:   'Punter',
  artist:   'Artist',
  band:     'Band',
  standup:  'Standup',
  venue:    'Venue',
  host:     'Host',
  festival: 'Festival',
};

export function profileTypeLabel(type) {
  return PROFILE_TYPE_LABELS[type] ?? type;
}

export default PROFILE_TYPE_LABELS;
