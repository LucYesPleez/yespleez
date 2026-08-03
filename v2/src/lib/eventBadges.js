// Canonical event category badges — the single source of truth for a
// category's label AND colours. This casing is what shows everywhere: all-caps,
// except the deliberately stylised "DJs".
//
// Nothing downstream should re-case or re-colour these. Previously the same
// definitions existed three times (here, a BADGE_STYLES map duplicated in
// EventCard + ProfileScreen, and the editor's chip list) and disagreed on
// casing — an event with a stored categoryBadge rendered "Live Music" while an
// auto-detected one rendered "LIVE MUSIC". One definition removes the
// divergence at the source instead of patching it per render site.
export const CATEGORY_BADGES = {
  FESTIVAL:    { label: 'FESTIVAL',    bg: '#BF5FFF',      col: '#fff' },
  DJS:         { label: 'DJs',         bg: 'var(--neon2)', col: '#000' },
  COMEDY:      { label: 'COMEDY',      bg: '#FF8C42',      col: '#fff' },
  SPOKEN_WORD: { label: 'SPOKEN WORD', bg: '#FF8C42',      col: '#fff' },
  LIVE_MUSIC:  { label: 'LIVE MUSIC',  bg: '#ff2d78',      col: '#fff' },
  OPEN_MIC:    { label: 'OPEN MIC',    bg: '#FFD700',      col: '#000' },
};

// The chip options offered in the event editor — the same objects, so whatever
// a host picks is stored already-canonical and needs no normalising later.
// Festival is offered (the Festival Edition app isn't built yet, but a festival
// should still read as a festival in What's On / Discover).
export const CATEGORY_CHOICES = [
  CATEGORY_BADGES.LIVE_MUSIC,
  CATEGORY_BADGES.DJS,
  CATEGORY_BADGES.COMEDY,
  CATEGORY_BADGES.SPOKEN_WORD,
  CATEGORY_BADGES.FESTIVAL,
];

export const OPEN_MIC_BADGE = CATEGORY_BADGES.OPEN_MIC;

// Compare category labels without caring about casing/spacing, so legacy rows
// stored as "Live Music" still match the canonical "LIVE MUSIC".
export const sameCategory = (a, b) =>
  String(a || '').trim().replace(/\s+/g, ' ').toUpperCase() ===
  String(b || '').trim().replace(/\s+/g, ' ').toUpperCase();

// Resolve a stored category label to its canonical badge. Case-insensitive, so
// rows saved before the labels were canonicalised render identically to new
// ones. An unrecognised value keeps its own text on a neutral chip.
export function resolveCategoryBadge(stored) {
  if (!stored) return null;
  return Object.values(CATEGORY_BADGES).find(b => sameCategory(b.label, stored))
    || { label: stored, bg: '#fff', col: '#000' };
}

// Auto-detect a category from an event's genre text. Festival wins over the
// music-type match — a "Festival, Folk, …" event is a festival first.
export function getEventBadges(genres = '', name = '') {
  const text = (genres + ' ' + name).toLowerCase();
  const g    = genres.toLowerCase();
  const isOpenMic = /open.?mic/i.test(text);

  // ⚠ AN EVENT CAN BE MORE THAN ONE THING, and this used to pick exactly one.
  // "Live Band, DJ" is a bill with both, but the old `? :` chain tested DJs
  // before Live Music and stopped at the first hit, so it showed DJs alone and
  // the live acts were invisible (owner, Neverland '26, 2026-08-02).
  //
  // Festival stays EXCLUSIVE: a "Festival, Folk, …" event is a festival first,
  // and stacking FESTIVAL + LIVE MUSIC + DJs on one card says less than
  // FESTIVAL does on its own.
  if (g.includes('festival')) {
    return isOpenMic ? [CATEGORY_BADGES.FESTIVAL, CATEGORY_BADGES.OPEN_MIC] : [CATEGORY_BADGES.FESTIVAL];
  }

  // Order follows CATEGORY_CHOICES — the same order the editor offers them, so
  // a card reads the way the picker looks.
  const MATCHERS = [
    [CATEGORY_BADGES.LIVE_MUSIC,  ['live', 'band', 'folk', 'roots', 'rock', 'acoustic', 'singer']],
    [CATEGORY_BADGES.DJS,         ['dj', 'electronic', 'house', 'techno', 'drum']],
    [CATEGORY_BADGES.COMEDY,      ['comedy', 'standup', 'stand-up']],
    [CATEGORY_BADGES.SPOKEN_WORD, ['spoken', 'poetry']],
  ];

  const badges = MATCHERS
    .filter(([, words]) => words.some(w => g.includes(w)))
    .map(([badge]) => badge);

  if (isOpenMic) badges.push(CATEGORY_BADGES.OPEN_MIC);
  return badges;
}

/**
 * The chips an event actually shows. THE ONE PLACE THIS ORDER IS DECIDED.
 *
 * Precedence: a host's explicit chip beats auto-detection, always. Open Mic
 * sits ALONGSIDE the category rather than replacing it.
 *
 * ⚠ THIS EXISTS BECAUSE THE RULE WAS COPIED THREE TIMES AND ONE COPY DRIFTED.
 * EventCard, ProfileScreen and WhatsOnScreen each had their own version;
 * WhatsOnScreen's called getEventBadges() alone, so a host who tagged an event
 * "dubstep, dnb, breaks" and explicitly picked DJs saw NO chip in What's On —
 * none of those words are in the keyword list — while the same event rendered
 * correctly everywhere else. Auto-detection is a fallback for events nobody
 * categorised; it must never overrule someone who did.
 */
export function eventCategoryBadges(cfg = {}, eventName = '') {
  let badges = cfg.categoryBadge
    ? [resolveCategoryBadge(cfg.categoryBadge)]
    : getEventBadges(cfg.genres || '', eventName || '');
  if (cfg.openMicBadge && !badges.find(b => b.label === OPEN_MIC_BADGE.label)) {
    badges = [...badges, OPEN_MIC_BADGE];
  }
  return badges;
}
