import { useNavigate } from 'react-router-dom';
import { profileUrl } from '../lib/profileResolution';
import { formatLocation } from '../lib/formatLocation';
import { selectedPerformanceRoleLabels, selectedArtistRoleLabels } from '../lib/profileTaxonomy';
import { profileIdentity } from '../lib/profileTypes';
import { getContrastText } from '../lib/color';
import UnclaimedBadge from './UnclaimedBadge';
import { isProfileUnclaimed } from '../lib/profileClaim';

/**
 * Props:
 *   profile  – { user_id, name, type, avatar, location, sound }
 *   onClick  – optional click handler (falls back to navigate /profile/:id)
 *   width    – card width in px (default 150)
 *   height   – card height in px (default 200)
 */
/**
 * THE CARD'S EDGE — the same gradient a sent message bubble wears.
 *
 * Lifted verbatim from `SENT_BUBBLE` in ConversationView: magenta at the top
 * corner, violet through the middle, fading to almost nothing. Two surfaces
 * that share an edge treatment read as one product rather than two screens
 * that happen to live in the same app.
 *
 * ⚠ TWO BACKGROUNDS, ONE ELEMENT, AND THE BORDER MUST STAY TRANSPARENT.
 * `border` cannot carry a gradient, so the fill is clipped to the padding box
 * and the gradient to the border box, showing through the transparent border
 * as the edge. Give the border a colour and the gradient vanishes behind it.
 *
 * ⚠ IF THE BUBBLE'S GRADIENT CHANGES, THIS DOES NOT FOLLOW. They are two
 * copies of one intention, in two files, with nothing linking them.
 */
const CARD_BORDER = '1px solid transparent';
const CARD_SURFACE =
  'linear-gradient(135deg,rgba(255,45,120,.4),rgba(157,78,221,.3)) padding-box,'
  + 'linear-gradient(150deg, rgba(255,79,216,.34) 0%, rgba(191,95,255,.13) 46%, rgba(255,255,255,.04) 100%) border-box';

export default function PortraitCard({ profile: p, onClick, width = 150, height = 200 }) {
  const navigate = useNavigate();
  // 10F: one resolver, no artist sentinel. A row with a missing/unknown type used
  // to render as a cyan "DJ / PROD." with a DJ's placeholder photo; it now renders
  // neutral, which is honest rather than confidently wrong.
  const type = String(p?.type || '').toLowerCase();
  const pt = profileIdentity(type);
  const label = pt.shortLabel;
  // Standup: one pill per selected performance role (Comedy/Poetry). Artist:
  // same concept for DJ/Producer/MC. Data-driven so a future role works
  // everywhere with no call-site change. Falls back to the generic type
  // label until roles have been selected.
  const roleLabels = type === 'standup' ? selectedPerformanceRoleLabels(p?.genre_string)
    : type === 'artist' ? selectedArtistRoleLabels(p?.genre_string)
    : [];
  // `label` is null for a Personal profile (PUNTER_PROFILE), which is how the
  // type chip is suppressed — a punter is just a person, and a chip reading
  // "PROFILE" told the reader nothing they could act on. `.filter(Boolean)`
  // rather than a branch, so any future identity without a label inherits the
  // same behaviour instead of rendering an empty pill.
  const pillLabels = (roleLabels.length ? roleLabels : [label]).filter(Boolean);
  // M5: canonical profile.id URL; legacy user_id URL only as a fallback for
  // callers whose selects don't carry `id` yet (the redirect shim covers it).
  const handleClick = onClick || (() => navigate(p?.id ? profileUrl(p) : `/profile/${p?.user_id}?type=${type}`));

  return (
    <div
      onClick={handleClick}
      style={{ flexShrink: 0, width, height, borderRadius: 14, overflow: 'hidden', cursor: 'pointer', position: 'relative', border: CARD_BORDER, background: CARD_SURFACE, transition: 'transform .18s' }}
      onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
      onMouseLeave={e => e.currentTarget.style.transform = ''}
    >
      {/* avatar image */}
      <img src={p?.avatar_thumb || p?.avatar || pt.defaultImage} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" decoding="async" />
      {/* gradient overlay */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom,rgba(0,0,0,.08) 0%,rgba(0,0,0,0) 35%,rgba(0,0,0,.6) 75%,rgba(0,0,0,.88) 100%)' }} />
      {/* type pill(s) */}
      <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 6 }}>
        {pillLabels.map((l, i) => (
          <span key={i} style={{ background: pt.accent, color: getContrastText(pt.accent), filter: 'brightness(.8)', borderRadius: 6, padding: '3px 8px', fontSize: 9, fontWeight: 700, letterSpacing: .8, fontFamily: "'DM Sans',sans-serif" }}>
            {l}
          </span>
        ))}
      </div>
      {/* info */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 15, letterSpacing: 1, color: '#fff', lineHeight: 1.1 }}>{p?.name}</div>
        {/* Not in the top-right pill row: at 150px wide, a type pill plus this
            badge measures ~146px against ~130px of usable width, so it would
            overflow and be clipped by the card. The bottom block has the room.
            The wrapper is gated rather than rendered-then-emptied because an
            empty div's 4px margin collapses with the location row's 3px and
            shifts every CLAIMED card by 1px. This is the one place a card
            touches the predicate, and it asks only whether, never how. */}
        {isProfileUnclaimed(p) && (
          <div style={{ marginTop: 4 }}><UnclaimedBadge profile={p} /></div>
        )}
        {formatLocation(p) && <div style={{ fontSize: 10, color: 'rgba(255,255,255,.55)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{formatLocation(p)}</div>}
        {/* 10F: was a hardcoded '#00E5FF' — Artist's cyan on EVERY type's card.
            ProfileCard renders the same field in the row's own accent (ts.col);
            this one didn't. Now both derive from the resolved type. */}
        {p?.sound && <div style={{ fontSize: 10, color: pt.accent, marginTop: 5, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.sound}</div>}
      </div>
    </div>
  );
}
