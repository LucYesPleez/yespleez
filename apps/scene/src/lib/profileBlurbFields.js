/**
 * THE TWO BLURB FIELDS — one definition, every profile type.
 *
 * ⛔⛔ THESE ARE CANONICAL. Before this registry existed, six editors each
 * hardcoded their own wording, their own limits and their own idea of what the
 * two columns meant, and they drifted into this:
 *
 *   `sound`    YOUR SOUND (35) · SOUND / VIBE BIO (35) · YOUR VIBE (50) ·
 *              SOUND / VIBE (no limit) · ⛔ absent entirely on band + standup
 *   `tagline`  TAGLINE (120) · TAGLINE (100) · TAGLINE (no limit)
 *
 * Counters appeared on two editors of six. The section hints each claimed a
 * different destination for the same column ("your slot card", "your listing",
 * "your profile tile"), and only one of them could be right.
 *
 * ⭐⭐ THE FIX IS NOT ONE AGREED WORDING, IT IS MOVING THE WORDING OUT OF THE
 * EDITORS. A string copied into six files drifts the moment one of them is
 * edited alone; a string imported by six files cannot. Everything a blurb field
 * needs to render lives here, and `BlurbFields` is the only thing that renders
 * it.
 *
 * ⛔ NO PROFILE-TYPE-SPECIFIC DEFINITIONS (owner, 2026-09-05). A venue, a
 * comedian and a DJ get the SAME two fields with the SAME labels, hints and
 * limits. The only thing that varies by type is the example placeholder, which
 * is an illustration rather than a definition, and lives in its own map below
 * so the distinction stays visible.
 */

/** The section every profile editor puts these two fields in. */
export const BLURB_SECTION_TITLE = 'YOUR SOUND & STYLE';

/**
 * ⛔⛔ `column` IS THE DATABASE COLUMN AND MUST NOT BE RENAMED. The labels
 * changed in 2026-09; `profiles.sound` and `profiles.tagline` did not, and no
 * stored value was migrated, transformed or overwritten to suit the new words.
 *
 * ⚠ `sound` IS THE WORKHORSE, NOT THE ORNAMENT. It is read by portrait cards,
 * profile cards, application cards, enquiry cards, the enquiry dossier, the
 * event artists section, the fill-slot modal, the invite sheet, work-item
 * cards, the applications screen, the artist dashboard, the apply button, and
 * it is copied into `lineup_members.sound` at booking time. `tagline` reaches
 * two surfaces: the profile hero and the dashboard profile card. That is why
 * band and standup silently falling back to genres everywhere was a real bug
 * and not a cosmetic one.
 */
/**
 * ⭐⭐ ORDER IS RENDER ORDER, AND TAGLINE COMES FIRST (owner, 2026-09-05).
 * `BlurbFields` maps this array straight into the DOM, so this is the ONLY
 * place the running order of the two boxes is decided. ⛔ Do not reorder the
 * fields inside an individual editor.
 */
export const PROFILE_BLURB_FIELDS = [
  {
    key:       'tagline',
    column:    'tagline',
    label:     'TAGLINE',
    hint:      'Your event / performance personality',
    maxLength: 120,
    /* ⚠ A TEXTAREA, WHERE `sound` IS AN INPUT. 120 characters in a single-line
       box scrolls sideways and the writer cannot see what they wrote. Artist
       and Venue already made this call independently; it is kept, not
       reinvented. Host used an input and now matches the other four. */
    multiline: true,
  },
  {
    key:       'sound',
    column:    'sound',
    label:     'SOUND BIO',
    hint:      'What you sound like',
    maxLength: 50,
    multiline: false,
  },
];

/** The five types that edit a profile. ⛔ A punter has no blurb to write. */
export const BLURB_PROFILE_TYPES = ['artist', 'band', 'standup', 'host', 'venue'];

/**
 * Examples only. ⛔ NOT a per-type definition of the field — the label, the
 * hint and the limit are identical for every type; only the worked example
 * changes, because "Deep, dark and uncompromising" reads as a promoter's
 * night and makes no sense above a comedian's box.
 *
 * ⚠ Every one of these is an existing placeholder, moved rather than written.
 */
export const BLURB_PLACEHOLDERS = {
  artist:  { sound: 'e.g. UK Garage Mashups & Dark Electronics',  tagline: 'Peak-time techno from Sydney. Builds slow, hits hard.' },
  band:    { sound: 'e.g. Multi genre low slung hooners',         tagline: 'e.g. Psychedelic desert blues from the Blue Mountains' },
  standup: { sound: 'e.g. Deadpan observational storytelling',    tagline: 'One line that captures your act' },
  host:    { sound: 'e.g. Deep, dark and uncompromising',         tagline: "e.g. Sydney's most underground rave collective" },
  venue:   { sound: 'e.g. Underground warehouse techno venue',    tagline: "Sydney's most iconic live music room. Three floors, two stages, one vibe." },
};

/** The canonical field list for a type. Every type gets BOTH, always. */
export function blurbFieldsFor(type) {
  return BLURB_PROFILE_TYPES.includes(String(type || '').toLowerCase())
    ? PROFILE_BLURB_FIELDS
    : [];
}

/** Placeholders for a type, falling back to the artist's rather than to blank. */
export function blurbPlaceholdersFor(type) {
  return BLURB_PLACEHOLDERS[String(type || '').toLowerCase()] || BLURB_PLACEHOLDERS.artist;
}

/** `{ sound: 50, tagline: 120 }` — for anything that needs to clamp or check. */
export const BLURB_MAX_LENGTHS = PROFILE_BLURB_FIELDS
  .reduce((acc, f) => ({ ...acc, [f.column]: f.maxLength }), {});
