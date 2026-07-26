import { useState } from 'react';
import PortraitCard from './PortraitCard';
import ProfileCard from './ProfileCard';
import { PROFILE_TYPE_ORDER, PROFILE_TYPES } from '../lib/profileTypes';
import { VISIBLE_PERFORMANCE_ROLES, VISIBLE_ARTIST_ROLES } from '../lib/profileTaxonomy';

// One pill per profile type, except standup and artist — which each split
// into one pill per role (standup: Comedy / Poetry; artist: DJ / Producer /
// MC) instead of a single pill covering every performer of that type
// regardless of what they actually do. Adding a role to PERFORMANCE_ROLES or
// ARTIST_ROLES (profileTaxonomy.js) automatically gets a filter pill here,
// no call-site changes needed.
const BASE_TYPE_TOKENS = PROFILE_TYPE_ORDER.filter(t => t !== 'standup' && t !== 'artist');

// The artist default-role model. Every Artist HAS a role: `dj_prod` is the
// canonical default and `mc` is an explicit override, so an artist with no
// stored role IS a DJ / Producer rather than an artist of unknown role.
// Derived from ARTIST_ROLES so adding a role there cannot silently desync
// this. See the filter predicate below for what it means in practice.
const ARTIST_ROLE_KEYS     = VISIBLE_ARTIST_ROLES.map(r => r.key);
const DEFAULT_ARTIST_ROLE  = 'dj_prod';

export const FOLLOW_TYPE_MAP = {
  ...Object.fromEntries(BASE_TYPE_TOKENS.map(type => [type.toUpperCase(), { type }])),
  ...Object.fromEntries(VISIBLE_ARTIST_ROLES.map(r => [r.key.toUpperCase(), { type: 'artist', role: r.key }])),
  ...Object.fromEntries(VISIBLE_PERFORMANCE_ROLES.map(r => [r.key.toUpperCase(), { type: 'standup', role: r.key }])),
};

// 'ALL' isn't a profile type, so it keeps its own entry; every other token
// derives its colour from the one canonical PROFILE_TYPES definition (role
// tokens all share their type's colour, same as any other sub-filter of a type).
export const FOLLOW_PILL_COLORS = {
  ALL: { col: 'var(--muted)', rgb: '150,150,170' },
  ...Object.fromEntries(Object.entries(FOLLOW_TYPE_MAP).map(([token, { type }]) => [
    token, { col: PROFILE_TYPES[type].accent, rgb: PROFILE_TYPES[type].rgb },
  ])),
};

export const FOLLOW_FILTER_LABELS = {
  ALL: 'ALL',
  ...Object.fromEntries(BASE_TYPE_TOKENS.map(type => [type.toUpperCase(), PROFILE_TYPES[type].shortLabel])),
  ...Object.fromEntries(VISIBLE_ARTIST_ROLES.map(r => [r.key.toUpperCase(), r.label.toUpperCase()])),
  ...Object.fromEntries(VISIBLE_PERFORMANCE_ROLES.map(r => [r.key.toUpperCase(), r.label.toUpperCase()])),
};

// Canonical order: FOLLOW_TYPE_MAP's own insertion order (Venue-first types,
// then each performance role) — no separate reverse-lookup needed now that a
// type can own more than one token.
const FULL_ORDER = Object.keys(FOLLOW_TYPE_MAP);

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
  filterTypes = ['ALL', ...FULL_ORDER],
  sectionTitle = 'FOLLOWING',
  actions,   // optional: (profile) => jsx — extra action buttons in landscape view
}) {
  const filtered = following.filter(p => {
    if (followFilter === 'ALL') return true;
    const { type, role } = FOLLOW_TYPE_MAP[followFilter] || {};
    if (p.type !== type) return false;
    if (!role) return true;
    // Role tokens (Comedy/Poetry/MC) live inside genre_string alongside style
    // tags — same encoding StandupProfileScreen/selectedPerformanceRoleLabels
    // use, so a performer only matches the roles they've actually selected.
    const roles = new Set((p.genre_string || '').split(' · ').map(t => t.trim()).filter(Boolean));
    if (roles.has(role)) return true;

    // ── The artist DEFAULT ROLE model ──────────────────────────────────
    //
    // Every Artist HAS a role. `dj_prod` is the canonical default; `mc` is an
    // explicit override. An artist with no role key stored therefore IS a
    // DJ / Producer — an absent role is the default, NOT unknown data and NOT
    // a gap to be filled in later.
    //
    // This is a product rule, not a lenient-matching heuristic. It follows
    // from there being no plain ARTIST pill: artists split into DJ / PROD.
    // and MC (see BASE_TYPE_TOKENS above, which excludes 'artist'). Without
    // this, an artist who never opened the role picker matches NEITHER pill
    // and is invisible under every filter except ALL — which is what happened
    // to every artist created before roles existed, and to every new artist
    // who has not yet chosen one.
    //
    // Consequences, deliberately:
    //   DJ / PROD.  matches role 'dj_prod'  OR no artist role stored
    //   MC          matches role 'mc' only — never by default
    // So new artists work correctly before selecting anything, and no data
    // backfill is needed or wanted.
    //
    // Standup roles (Comedy/Poetry) have NO default and are unaffected: that
    // type has no canonical primary role, so an absent value there really is
    // absent.
    if (type === 'artist' && role === DEFAULT_ARTIST_ROLE) {
      return !ARTIST_ROLE_KEYS.some(k => roles.has(k));
    }
    return false;
  });

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
          {/* ⚠ 150×200, FIXED — this rail is NOT the Messenger one. It briefly
              borrowed the Messenger rail's fluid width and avatar-only phone
              treatment; that was never asked for here and shrank every
              industry profile's Following list. Do not re-point this at
              useRailCardWidth: the two rails look alike but answer different
              questions, and only one of them was being redesigned. */}
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
