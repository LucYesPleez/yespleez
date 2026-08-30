/**
 * The Poster Wall teaser on My Scene — a cropped slice of the user's REAL
 * wall, glimpsed through a doorway. Same query key as the wall screen, so
 * this can never show a wall the screen would not.
 *
 * ⭐ Visible from the start (owner override of hide-when-empty, 2026-08-31):
 * everyone should know the wall exists. Empty = bare brick + one line.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { today } from '../lib/dates';
import { buildWallItems, applyWallState, seedFor } from '../lib/posterWall';
import { fetchPosterWallData, POSTER_WALL_QUERY_KEY, loadWallState } from '../lib/posterWallData';

const BRICK = {
  backgroundColor: '#221a14',
  backgroundImage: [
    'repeating-linear-gradient(0deg, rgba(0,0,0,.32) 0 2px, transparent 2px 26px)',
    'repeating-linear-gradient(90deg, rgba(0,0,0,.2) 0 2px, transparent 2px 58px)',
    'linear-gradient(180deg, #2a2019, #1a130d)',
  ].join(','),
};

export default function PosterWallStrip({ uid }) {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: POSTER_WALL_QUERY_KEY(uid),
    queryFn: () => fetchPosterWallData(uid),
    staleTime: 5 * 60 * 1000,
    enabled: !!uid,
  });

  const todayStr = useMemo(() => today(), []);
  const items = useMemo(() => {
    if (!data) return [];
    const built = applyWallState(buildWallItems({ ...data, todayStr }), loadWallState(uid));
    return built.slice(-9).reverse(); // the newest corner of the wall
  }, [data, todayStr, uid]);

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontFamily: "'Bebas Neue'", fontWeight: 400, fontSize: 18, letterSpacing: 1.5, color: 'var(--text)' }}>
          POSTER WALL
        </span>
        <button className="yp-tap44" onClick={() => navigate('/poster-wall')}
          style={{ background: 'none', border: 'none', color: 'var(--neon2, #00E5FF)', fontFamily: "'Bebas Neue'", fontWeight: 400, fontSize: 12, letterSpacing: 1.5, cursor: 'pointer' }}>
          SEE THE WALL
        </button>
      </div>
      <div
        onClick={() => navigate('/poster-wall')}
        role="button"
        aria-label="Open your poster wall"
        style={{
          ...BRICK,
          position: 'relative', height: 96, borderRadius: 10, overflow: 'hidden',
          cursor: 'pointer', boxShadow: 'inset 0 0 30px rgba(0,0,0,.7)',
        }}
      >
        {items.length === 0 ? (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', padding: '0 20px', textAlign: 'center',
            fontSize: 12, color: '#a89a88', lineHeight: 1.4,
          }}>
            Every event you&rsquo;re part of leaves its poster here.
          </div>
        ) : items.map((it, i) => {
          const seed = it.seed || seedFor(it.id);
          return it.kind === 'poster' ? (
            <img key={it.id} src={it.img} alt="" draggable={false}
              style={{
                position: 'absolute', left: 8 + i * 44, top: 8 + (seed.dy % 10),
                width: 56, height: 79, objectFit: 'cover',
                transform: `rotate(${seed.rot}deg)`,
                boxShadow: '0 4px 10px rgba(0,0,0,.6)',
              }} />
          ) : (
            <div key={it.id}
              style={{
                position: 'absolute', left: 8 + i * 44, top: 12 + (seed.dy % 10),
                width: 54, height: 52, padding: 5, boxSizing: 'border-box', overflow: 'hidden',
                transform: `rotate(${seed.rot}deg)`,
                background: 'linear-gradient(160deg, #f5e77a, #d9c64a)',
                color: '#33290a', fontFamily: "'Bebas Neue'", fontWeight: 400,
                fontSize: 10, letterSpacing: .5, lineHeight: 1.1,
                boxShadow: '0 4px 8px rgba(0,0,0,.55)',
              }}>
              {it.name}
            </div>
          );
        })}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(90deg, transparent 55%, rgba(22,17,13,.9))',
          pointerEvents: 'none',
        }} />
      </div>
    </div>
  );
}
