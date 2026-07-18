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
  const primary =
    g.includes('festival')
      ? CATEGORY_BADGES.FESTIVAL
    : (g.includes('dj') || g.includes('electronic') || g.includes('house') || g.includes('techno') || g.includes('drum'))
      ? CATEGORY_BADGES.DJS
    : (g.includes('comedy') || g.includes('standup') || g.includes('stand-up'))
      ? CATEGORY_BADGES.COMEDY
    : (g.includes('spoken') || g.includes('poetry'))
      ? CATEGORY_BADGES.SPOKEN_WORD
    : (g.includes('live') || g.includes('band') || g.includes('folk') || g.includes('roots') || g.includes('rock') || g.includes('acoustic') || g.includes('singer'))
      ? CATEGORY_BADGES.LIVE_MUSIC
    : null;

  const badges = primary ? [primary] : [];
  if (isOpenMic) badges.push(CATEGORY_BADGES.OPEN_MIC);
  return badges;
}
