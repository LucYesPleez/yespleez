export const OPEN_MIC_BADGE = { label: 'OPEN MIC', bg: '#FFD700', col: '#000' };

// Festival shows its own badge even though the Festival Edition app isn't built
// yet — a festival should still read as a festival in What's On / Discover
// (owner call, 2026-07-18). Detected from the genre text and taking priority
// over the music-type match (a "Festival, Folk, …" event is a festival first).
// Colour matches the 'Festival' category badge used on the cards (#BF5FFF).
export function getEventBadges(genres = '', name = '') {
  const text = (genres + ' ' + name).toLowerCase();
  const g    = genres.toLowerCase();
  const isOpenMic = /open.?mic/i.test(text);
  const primary =
    g.includes('festival')
      ? { label: 'FESTIVAL', bg: '#BF5FFF',      col: '#fff' }
    : (g.includes('dj') || g.includes('electronic') || g.includes('house') || g.includes('techno') || g.includes('drum'))
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
