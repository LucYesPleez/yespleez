import { useState } from 'react';
import PortraitCard from './PortraitCard';
import ProfileCard from './ProfileCard';
import { PROFILE_TYPE_ORDER } from '../lib/profileTypes';

export const FOLLOW_TYPE_MAP = {
  VENUE: 'venue', HOST: 'host', ARTIST: 'artist', BAND: 'band', COMEDY: 'standup',
};

export const FOLLOW_PILL_COLORS = {
  ALL:    { col: 'var(--muted)',  rgb: '150,150,170' },
  VENUE:  { col: '#00E5A0',      rgb: '0,229,160'   },
  HOST:   { col: '#FF3399',      rgb: '255,51,153'  },
  ARTIST: { col: 'var(--neon2)', rgb: '0,229,255'   },
  BAND:   { col: '#FF8C42',      rgb: '255,140,66'  },
  COMEDY: { col: '#FF88AA',      rgb: '255,136,170' },
};

export const FOLLOW_FILTER_LABELS = {
  ALL:    'ALL',
  VENUE:  'VENUE',
  HOST:   'HOST / PROM',
  ARTIST: 'DJ / PROD',
  BAND:   'BAND',
  COMEDY: 'COMEDY',
};

// Single canonical order (Venue first, matching PROFILE_TYPE_ORDER) instead
// of five near-identical hand-written arrays. Each viewer's list is derived
// from the same FULL_ORDER — venue's list excludes its own type (pre-existing
// behavior, preserved as-is); the others don't self-exclude (also pre-existing,
// preserved as-is — not something this ordering pass changes).
const TYPE_TO_TOKEN = Object.fromEntries(Object.entries(FOLLOW_TYPE_MAP).map(([token, type]) => [type, token]));
const FULL_ORDER = PROFILE_TYPE_ORDER.map(type => TYPE_TO_TOKEN[type]);

export const FOLLOW_FILTER_CONFIGS = {
  venue:   ['ALL', ...FULL_ORDER.filter(t => t !== 'VENUE')],
  host:    ['ALL', ...FULL_ORDER],
  artist:  ['ALL', ...FULL_ORDER],
  band:    ['ALL', ...FULL_ORDER],
  standup: ['ALL', ...FULL_ORDER],
};

export default function FollowingSection({
  following, loading,
  followView, setFollowView,
  followFilter, setFollowFilter,
  followShowAll, setFollowShowAll,
  followSearch, setFollowSearch,
  followDrag,
  emptyMsg = 'Not following anyone yet.',
  filterTypes = ['ALL', 'VENUE', 'HOST', 'ARTIST', 'BAND', 'COMEDY'],
  sectionTitle = 'FOLLOWING',
  actions,   // optional: (profile) => jsx — extra action buttons in landscape view
}) {
  const filtered = following.filter(p =>
    followFilter === 'ALL' || p.type === FOLLOW_TYPE_MAP[followFilter]
  );

  return (
    <div style={{ marginTop: 24 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: 2, color: '#fff' }}>{sectionTitle}</span>
        {following.length > 0 && (
          <span style={{ fontFamily: "'DM Sans'", fontWeight: 700, fontSize: 11, color: 'var(--muted)', background: 'var(--card2)', borderRadius: 8, padding: '1px 7px' }}>{following.length}</span>
        )}
        <div style={{ flex: 1 }} />
        {!followShowAll && (
          <div style={{ display: 'flex', background: 'var(--card2)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
            {[['portrait', '▦'], ['landscape', '☰']].map(([v, icon]) => (
              <button key={v} onClick={() => setFollowView(v)} style={{ background: followView === v ? 'rgba(0,229,255,.18)' : 'none', border: 'none', color: followView === v ? 'var(--neon2)' : 'var(--muted)', padding: '5px 10px', cursor: 'pointer', fontSize: 13, lineHeight: 1, transition: 'background .15s, color .15s' }}>{icon}</button>
            ))}
          </div>
        )}
      </div>

      {/* Filter pills + view all */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          {filterTypes.map(f => {
            const pc = FOLLOW_PILL_COLORS[f] || FOLLOW_PILL_COLORS.ALL;
            const active = followFilter === f;
            return (
              <button key={f} onClick={() => setFollowFilter(f)} style={{ fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.2, padding: '4px 12px', borderRadius: 14, border: '1px solid', borderColor: active ? pc.col : 'var(--border)', background: active ? `rgba(${pc.rgb},.15)` : 'var(--card2)', color: active ? pc.col : 'var(--muted)', cursor: 'pointer', transition: 'all .15s' }}>
                {FOLLOW_FILTER_LABELS[f] || f}
              </button>
            );
          })}
        </div>
        {(followShowAll || filtered.length > 3) && (
          <span
            onClick={() => { setFollowShowAll(v => !v); setFollowSearch(''); }}
            onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,.85)'}
            onMouseLeave={e => e.currentTarget.style.color = followShowAll ? 'var(--text)' : 'var(--muted)'}
            style={{ fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1, color: followShowAll ? 'var(--text)' : 'var(--muted)', cursor: 'pointer', flexShrink: 0, transition: 'color .15s' }}>
            {followShowAll ? 'View less' : 'View all >'}
          </span>
        )}
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</p>
      ) : following.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>{emptyMsg}</p>
      ) : filtered.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>No results for this filter.</p>
      ) : followShowAll ? (
        <div>
          <input value={followSearch} onChange={e => setFollowSearch(e.target.value)} placeholder="Search name, location, vibe…"
            style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontFamily: "'DM Sans',sans-serif", fontSize: 13, marginBottom: 10, outline: 'none' }} />
          {(() => {
            const q = followSearch.toLowerCase();
            const visible = filtered.filter(p => !q || ['name','location','sound','type'].some(k => p[k]?.toLowerCase().includes(q)));
            return visible.length === 0
              ? <p style={{ fontSize: 13, color: 'var(--muted)' }}>No results.</p>
              : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
                  {visible.map(p => <PortraitCard key={p.user_id} profile={p} width={150} height={200} />)}
                </div>;
          })()}
        </div>
      ) : followView === 'portrait' ? (
        <div ref={followDrag.ref} onMouseDown={followDrag.onMouseDown} onMouseMove={followDrag.onMouseMove} onMouseUp={followDrag.onMouseUp} onMouseLeave={followDrag.onMouseLeave}
          style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', cursor: 'grab', userSelect: 'none' }}>
          {filtered.map(p => <PortraitCard key={p.user_id} profile={p} width={150} height={200} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(p => <ProfileCard key={p.user_id} item={p} actions={actions?.(p)} />)}
        </div>
      )}
    </div>
  );
}
