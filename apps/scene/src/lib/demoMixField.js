import { PREVIEW_MS } from './previewCap';

/**
 * THE DEMO MIX FIELD — one audio link, three performer types.
 *
 * ⭐⭐ EVERY PERFORMER GETS ONE. Artist, Band and Standup all have a demo; a
 * Host and a Venue do not perform, so they have nothing to preview (owner,
 * 2026-09-05). ⛔ Do not add `host` or `venue` to this registry.
 *
 * ⛔⛔ AUDIO ONLY, AND THAT WAS ALREADY TRUE — the editors just did not say so.
 * `lib/demoMixProviders.js` has exactly three providers: SoundCloud, Mixcloud
 * and a direct upload. There is NO YouTube and NO Vimeo. A link to either has
 * always failed `providerFor()` and fallen through to `window.open` in a new
 * tab, so the promoter left YesPleez instead of hearing anything.
 *
 * ⚠⚠ ALL THREE EDITORS ADVERTISED WHAT THE PLAYER CANNOT PLAY:
 *
 *   artist   "SoundCloud / Mixcloud / YouTube link"
 *   band     "Spotify, Bandcamp, Soundcloud, or EPK URL"   under EPK / PROMO LINK
 *   standup  "YouTube, Vimeo, or social link"              under VIDEO / SHOWREEL
 *
 * Two of the three led with a format that cannot play. This registry is the
 * copy telling the truth, not a new restriction.
 *
 * ⛔ NO DATA MODEL CHANGE. All three already write `mix_link`, and `mix_link`
 * is the only one of the three columns anything reads: the application card,
 * the enquiry dossier, the enquiry preview, claim enrichment, Set Times and the
 * public event view all read it. `epk_link` and `video_link` are still written
 * alongside exactly as before, and nothing was migrated.
 */

/** ⭐ DERIVED, NEVER TYPED. The number on screen is the number the player
    enforces — see lib/previewCap.js. A hardcoded "20" is how the old
    `CLIP_MS = 90s` bar came to promise a limit nothing applied. */
export const DEMO_MIX_MINUTES = Math.round(PREVIEW_MS / 60000);

/** The column. ⛔ Not `epk_link`, not `video_link` — nothing reads those. */
export const DEMO_MIX_COLUMN = 'mix_link';

/** What the player can actually open. Kept in step with demoMixProviders. */
export const DEMO_MIX_PLACEHOLDER = 'SoundCloud or Mixcloud link';

/** ⚠ Said on every performer editor, in the same words. */
export const DEMO_MIX_NOTICE =
  `Audio only. Only the first ${DEMO_MIX_MINUTES} minutes will play.`;

/** ⛔ Performers only. */
export const DEMO_MIX_TYPES = ['artist', 'band', 'standup'];

/**
 * Per-type wording. ⚠ The SUBJECT differs and the RULE does not: a DJ posts a
 * mix, a band posts a mixtape, a comic posts a set, and all three get the same
 * audio-only cap in the same sentence.
 */
export const DEMO_MIX_FIELDS = {
  artist: {
    title:       'YOUR DEMO MIX',
    label:       'LINK TO YOUR MIX',
    blurb:       "This is what promoters listen to first, it's your audition. Keep it current and make it count.",
  },
  band: {
    title:       'YOUR MIXTAPE',
    /* ⛔ NO LABEL (owner, 2026-09-05). "LINK TO YOUR 20 MIN MIXTAPE" restated
       the section title above it and the cap in the sentence below it, three
       times in one block. ⚠ `label` is OPTIONAL for exactly this reason —
       DemoMixField renders the row only when there is one. */
    blurb:       "This is what promoters listen to first, it's your audition. A short mixtape of your best work beats a full album.",
  },
  standup: {
    title:       'YOUR DEMO SET',
    label:       'LINK TO YOUR SET',
    blurb:       "This is what promoters listen to first, it's your audition. Recorded audio of a live set works best.",
  },
};

export function demoMixFieldFor(type) {
  return DEMO_MIX_FIELDS[String(type || '').toLowerCase()] || null;
}

/** Does this profile type get a demo mix at all? */
export function hasDemoMix(type) {
  return DEMO_MIX_TYPES.includes(String(type || '').toLowerCase());
}
