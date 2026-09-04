// THE PICTURE ON AN EVENT CARD — one ladder, in one place.
//
// Spec: docs/event-page-layout-spec.md §0 — "the Cover sells the experience,
// the Poster preserves the artwork".
//
// ── Why this file exists ─────────────────────────────────────────────
// Four surfaces each carried their own spelling of the same idea:
//
//   EventCard          event.poster_url || cfg.poster_thumb || cfg.poster
//   FeaturedEventCard  cfg.poster || cfg.posterUrl
//   WhatsOnScreen      cfg.poster || cfg.posterUrl
//   ProfileScreen      cfg.poster || cfg.posterUrl
//
// Measured against all 73 events before this was written: `poster` 71,
// `poster_thumb` 3, `poster_full` 2, `cover` 1 — and `posterUrl` ZERO. There is
// also no `poster_url` COLUMN on `events`, so EventCard's leading term could
// never match either. Two of the four ladders were reading fields nothing has
// ever written, which is how three surfaces could disagree about the same event
// and nobody could see it. Both dead spellings are deleted here rather than
// carried forward — a fallback that has never once fired is not a safety net,
// it is a place for the next reader's belief to diverge.
//
// ⚠ THE COVER WINS ON A CARD. A poster is portrait artwork whose edges carry
// the date, the bill and the ticket source; a card crops it to a landscape band
// and throws exactly that away. The Cover is uploaded at 3:2 — the shape these
// frames actually are — so preferring it is not a style choice, it is the
// difference between a picture and a slice of one. The poster remains the
// fallback, and the event page's own Hero ladder (heroMedia.js) is unchanged:
// this is the CARD's answer, deliberately simpler than the Hero's seven rungs
// because a 195px tile cannot express a carousel or a blur treatment.
//
// R1 · absent stays absent — an event with no picture returns null, and every
// caller already draws its own gradient rather than a broken frame.

/** First value that is a usable URL. Blank strings are absent, not present. */
const firstUrl = (...vals) => vals.find(v => typeof v === 'string' && v.trim()) ?? null;

/**
 * The image for an event CARD, ROW or THUMBNAIL — What's On's grid and Coming
 * Up rows, the Spotlight rail, a profile's gig shelf.
 *
 * `cover_thumb` leads because a 600×400 file is the right weight for a 195px
 * tile. ⚠ NOTHING WRITES IT TODAY: `uploadCover` builds and stores that thumb
 * on every cover upload, but CreateEventScreen keeps only the full `cover` URL
 * and drops the thumb's on the floor — see the note there. Reading it costs
 * nothing and means the day the editor keeps it, every card gets lighter with
 * no further change here.
 *
 * @param event a row from `events` — `{ config }` is all that is read
 * @returns url string, or null when the event has no picture at all
 */
export function eventCardImage(event) {
  const cfg = event?.config || {};
  return firstUrl(cfg.cover_thumb, cfg.cover, cfg.poster_thumb, cfg.poster);
}

/**
 * The POSTER — the artwork itself, for a surface whose whole shape is portrait.
 *
 * ⛔⛔ THIS IS NOT `eventCardImage` WITH THE LADDER REVERSED, AND THE DIFFERENCE
 * IS THE POINT. That function answers "what picture goes in this landscape
 * frame", and its answer is the Cover precisely because cropping portrait
 * artwork into a band throws away the date and the bill printed down its edges.
 * This one answers a different question — "is there a poster" — for a wall that
 * is portrait to begin with, where the cover is the wrong shape instead.
 *
 * ⚠ IT RETURNS NULL RATHER THAN FALLING BACK TO THE COVER. An event with only a
 * cover has no poster, and saying so lets the caller decide: a poster wall can
 * crop the cover, or skip the tile, or draw it differently. ⛔ A silent fallback
 * here would hand back a landscape image labelled "poster" and the caller could
 * never tell — which is exactly the defect this exists to end, where a poster
 * wall rendered cropped covers and looked like it had simply been built wrong.
 *
 * ⚠ Measured on the Bellingen Brewing Co's three upcoming events: one has only
 * a poster, one has only a cover, one has both. All three cases are real.
 */
export function eventPosterImage(event) {
  const cfg = event?.config || {};
  return firstUrl(cfg.poster_thumb, cfg.poster, cfg.poster_full);
}
