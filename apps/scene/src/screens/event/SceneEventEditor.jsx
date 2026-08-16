import { EventEditorForm } from '@yespleez/event-editor';
import { getEventBadges, CATEGORY_BADGES, CATEGORY_CHOICES, OPEN_MIC_BADGE, sameCategory } from '../../lib/eventBadges';
import { PROFILE_TYPES } from '../../lib/profileTypes';
import ImageUploadButton from '../../components/ImageUploadButton';
import CoHostPicker from '../../components/CoHostPicker';
import VenuePicker from '../../components/VenuePicker';
import EventArtistsSection from '../../components/EventArtistsSection';

/**
 * THIS APP'S EVENT EDITOR — the wrapper, and nothing else.
 *
 * ⭐ The whole purpose of this file is that `@yespleez/event-editor` contains
 * none of what is below. Every constant here is local knowledge: which
 * categories exist in this world, what a profile type is called, where an
 * upload goes, and what advice is worth offering about our own taxonomy.
 *
 * ⛔ THE DIRECTION MATTERS. The wrapper adapts this application to the package.
 * It never adapts the package to this application. If something cannot be
 * expressed as an argument here and seems to want a flag inside the package,
 * that is a finding about the boundary, not a thing to work around.
 *
 * Anything added here that is true of EVERY host — rather than of this one —
 * belongs in the package instead. That is the test to apply before adding.
 */

/**
 * The classification service. A list would not have been enough: this app
 * infers a category from the free-text genres a host types, and that inference
 * is ours. A host whose categories are chosen outright supplies
 * `classify: () => []` and the picker simply offers no suggestion.
 */
const categories = {
  choices: CATEGORY_CHOICES,
  openMic: OPEN_MIC_BADGE,
  classify: (genreText, name) => getEventBadges(genreText, name),
  isSame:   sameCategory,
};

/** This app's role registry. Another host's will not have the same entries. */
const labelProfileType = type => PROFILE_TYPES[type]?.shortLabel || type;

/** Everything that touches storage or queries this app's profiles.
 *  VenuePicker searches THIS app's venue profiles, so like CoHostPicker it is
 *  injected rather than imported by the package — the form falls back to a
 *  plain text field for any host that does not supply one.
 *
 *  ⭐ EventArtistsSection writes `lineup_members`, which is Scene's table and
 *  Scene's model. The package knows only that it was handed a component and an
 *  event id; ⛔ it must never learn what a shortlist or a bill is. */
const components = { ImageUploadButton, CoHostPicker, VenuePicker, ArtistsSection: EventArtistsSection };

/**
 * ⛔ ADORNMENT — render-only. It may not change what is selected or saved.
 *
 * Whether "you chose Live Music but your genres read as DJ" is worth saying is
 * a judgement about THIS taxonomy: here Live Music means bands and live
 * instruments, and DJs are a separate chip. A host whose categories carry no
 * such distinction passes no hint and sees nothing.
 */
const adornments = {
  categoryHint: ({ selected, suggested, isSame }) =>
    isSame(selected, CATEGORY_BADGES.LIVE_MUSIC.label) &&
    isSame(suggested?.label, CATEGORY_BADGES.DJS.label) ? (
      <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>
        We&apos;ve auto-detected you as a DJ — Live Music is for bands, acoustic and live instruments.
      </p>
    ) : null,
};

export default function SceneEventEditor(props) {
  return (
    <EventEditorForm
      {...props}
      categories={categories}
      labelProfileType={labelProfileType}
      components={components}
      adornments={adornments}
    />
  );
}
