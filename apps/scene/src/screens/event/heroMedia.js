// The Hero fallback ladder, as a pure function.
//
// Spec: docs/event-page-layout-spec.md §0.3
//
//   1  Event Cover + gallery images     → carousel
//   2  Event Cover alone                → static
//   3  Landscape artwork                → static
//   4  ORGANISER-CHOSEN crop of poster  → the band they positioned
//   5  Default crop of poster           → top-weighted, no choice made yet
//   6  Blurred poster treatment         → atmosphere, not information
//   7  No Hero                          → null (R1 · absent)
//
// Kept separate from the component because it is the Hero's render condition,
// and a render condition that cannot be tested is a render condition nobody
// trusts. Rungs 4–6 derive from the Poster; the Poster section renders whole
// regardless, so nothing here can take the artwork away from § 9.

// Where the default band sits when the organiser has not positioned one.
// TOP-WEIGHTED, not centred: posters carry their title and headline artwork
// near the top, and a centred band through a portrait poster tends to catch
// the middle of an illustration or a block of small type.
export const DEFAULT_CROP_Y = 22;

// Below this, a landscape band shows too little of the poster to mean anything,
// and a crop stops being a representation and becomes a sliver. Such posters
// fall through to the blurred treatment instead — atmosphere, honestly labelled
// as atmosphere, rather than a crop pretending to be a cover.
//
// Worked: a 3:2 band from a 1080×1528 poster is 720px of 1528 — 47%, fine. The
// same band from a 1080×3240 banner is 22% — a sliver, so it blurs.
export const MIN_CROP_COVERAGE = 0.25;

// One Cover plus five gallery images. The spec's cap, enforced here so no
// caller has to remember it.
export const MAX_SLIDES = 6;

const usable = img => !!(img && img.url);

/**
 * @returns null                                  — rung 7, no Hero
 *        | { rung, mode: 'images', slides }      — rungs 1–3
 *        | { rung, mode: 'crop',  slide, cropY } — rungs 4–5
 *        | { rung, mode: 'blur',  slide }        — rung 6
 */
export function resolveHeroMedia({
  cover = null,
  gallery = [],
  landscapeArtwork = null,
  poster = null,
  posterCropY = null,
  heroFrameAspect = 3 / 2,
} = {}) {
  const galleryImages = (gallery || []).filter(usable);

  // 1 · Cover + gallery → carousel
  if (usable(cover) && galleryImages.length) {
    return { rung: 1, mode: 'images', slides: [cover, ...galleryImages].slice(0, MAX_SLIDES) };
  }

  // 2 · Cover alone
  if (usable(cover)) {
    return { rung: 2, mode: 'images', slides: [cover] };
  }

  // 3 · Landscape artwork. Gallery images do not promote themselves into the
  //     Cover's place — without a Cover there is no carousel to lead.
  if (usable(landscapeArtwork)) {
    return { rung: 3, mode: 'images', slides: [landscapeArtwork] };
  }

  // 4–6 · derivations from the Poster
  if (usable(poster)) {
    if (cropCoverage(poster, heroFrameAspect) >= MIN_CROP_COVERAGE) {
      const chosen = isPosition(posterCropY);
      return {
        rung:  chosen ? 4 : 5,
        mode:  'crop',
        slide: poster,
        cropY: chosen ? posterCropY : DEFAULT_CROP_Y,
      };
    }
    return { rung: 6, mode: 'blur', slide: poster };
  }

  // 7 · nothing to show
  return null;
}

// What fraction of the poster's height a Hero-shaped band would occupy.
// Unknown dimensions are treated as croppable — the common case is an ordinary
// poster, and refusing to crop on missing metadata would push most events to
// the blurred rung for no reason.
function cropCoverage(poster, heroFrameAspect) {
  const { w, h } = poster;
  if (!w || !h) return 1;
  const bandHeight = w / heroFrameAspect;   // band is as wide as the poster
  return bandHeight / h;
}

function isPosition(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
}
