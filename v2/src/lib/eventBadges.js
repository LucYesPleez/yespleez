export const OPEN_MIC_BADGE = { label: 'OPEN MIC', bg: '#FFD700', col: '#000' };

// Festival is intentionally not an auto-detected category this release (see
// HOST_CATEGORIES in profileTaxonomy.js) — Festival Edition will re-enable
// it later; until then an event genre-tagged "festival" just falls through
// to whatever else its genre text matches (e.g. "Festival,Folk,..." reads
// as Live Music), same as any event with no special-cased keyword.
export function getEventBadges(genres = '', name = '') {
  const text = (genres + ' ' + name).toLowerCase();
  const g    = genres.toLowerCase();
  const isOpenMic = /open.?mic/i.test(text);
  const primary =
    (g.includes('dj') || g.includes('electronic') || g.includes('house') || g.includes('techno') || g.includes('drum'))
      ? { label: 'DJs',   bg: 'var(--neon2)', col: '#000' }
    : (g.includes('comedy') || g.includes('standup') || g.includes('stand-up'))
      ? { label: 'COMEDY',      bg: '#FF8C42',      col: '#fff' }
    : g.includes('spoken') || g.includes('poetry')
      ? { label: 'SPOKEN WORD', bg: '#FF8C42',      col: '#fff' }
    : (g.includes('live') || g.includes('band') || g.includes('folk') || g.includes('roots') || g.includes('rock') || g.includes('acoustic') || g.includes('singer'))
      ? { label: 'LIVE MUSIC',  bg: '#ff2d78',      col: '#fff' }
    : null;

  const badges = primary ? [primary] : [];
  if (isOpenMic) badges.push(OPEN_MIC_BADGE);
  return badges;
}
