// The event `config` blob → the inputs `resolveHeroMedia` takes.
//
// The blob carries several generations of schema at once, and the precedence
// below (`poster_full` over `poster`, blanks dropped from `gallery`, a crop
// that is a number or nothing) is presentation knowledge, not storage
// knowledge. It lives here so every surface that shows an event reads the
// same keys the same way — a second reading of the blob is how two surfaces
// end up showing two different heroes for one event.
//
// ⛔ This reads ONLY the media keys. It is not a general config reader, and
// growing it into one would put the whole blob's interpretation in a package
// that only ever needed a poster.

const isUrl = u => typeof u === 'string' && u.trim();

/**
 * @param {object|null} config  the event's `config` value, passed opaquely
 * @returns inputs for `resolveHeroMedia` — never null, fields default empty
 */
export function heroMediaInputsFromConfig(config) {
  const cfg = config || {};
  return {
    cover: isUrl(cfg.cover) ? { url: cfg.cover } : null,
    // Stored as bare URLs; shaped into the {url} objects the ladder expects.
    // Non-strings and blanks are dropped rather than passed on — a slide
    // missing from a carousel is far harder to notice than one that never
    // loads.
    gallery: Array.isArray(cfg.gallery)
      ? cfg.gallery.filter(isUrl).map(url => ({ url }))
      : [],
    landscapeArtwork: null,
    // `poster_full` is the uncropped original where one exists; `poster` may
    // already be a derived crop. The ladder wants the fullest artwork.
    poster: isUrl(cfg.poster) ? { url: isUrl(cfg.poster_full) ? cfg.poster_full : cfg.poster } : null,
    // Absent means no choice has been made and the ladder falls to its
    // top-weighted default — it does NOT mean 0.
    posterCropY: typeof cfg.posterCropY === 'number' ? cfg.posterCropY : null,
  };
}
