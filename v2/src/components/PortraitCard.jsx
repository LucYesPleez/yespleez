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
 *   profile     – { user_id, name, type, avatar, location, sound }
 *   onClick     – optional click handler (falls back to navigate /profile/:id)
 *   width       – card width: a number (px) or any CSS length, e.g. a calc()
 *                 expression for a fluid rail (default 150)
 *   height      – card height, same rules — or 'auto' to let `aspect-ratio`
 *                 derive it from width (default 200)
 *   avatarOnly  – image only: no name, no location, no sound, no unclaimed
 *                 badge. Owner, for the phone rail: "just show avatars".
 *                 The darkening overlay goes with it — that gradient exists
 *                 to keep text legible over a photo, and protects nothing
 *                 once there is no text left to protect.
 *
 * `aspectRatio: 3/4` is on the outer style unconditionally, matching the
 * 150:200 default exactly — a no-op for any caller passing both dimensions
 * as fixed lengths, and what makes `height="auto"` correct for a caller
 * that only knows a fluid WIDTH (the horizontal-scroll rails).
 */
/**
 * THE CARD'S EDGE — the message bubble's dark violet-to-black.
 *
 * These are the bubble's own FILL colours from `SENT_BUBBLE` in
 * ConversationView — rgb(30,27,38) to rgb(16,14,21), described there as
 * "charcoal that has been NEAR something violet, rather than something
 * violet" — used here as the EDGE and taken to full opacity so it reads as a
 * dark line rather than a tint. The bubble's magenta border gradient is
 * deliberately not used: it lit the card up instead of containing it.
 *
 * A dark edge on a dark page is doing a different job from a bright one. It
 * is not decoration — it separates a photograph from the background behind it,
 * which matters most on the cards carrying a real image, where the artwork
 * would otherwise bleed straight into the page.
 *
 * ⚠ TWO BACKGROUNDS, ONE ELEMENT, AND THE BORDER MUST STAY TRANSPARENT.
 * `border` cannot carry a gradient, so the fill is clipped to the padding box
 * and the gradient to the border box, showing through the transparent border
 * as the edge. Give the border a colour and the gradient vanishes behind it.
 *
 * ⚠ IF THE BUBBLE'S COLOURS CHANGE, THIS DOES NOT FOLLOW. They are two copies
 * of one intention, in two files, with nothing linking them.
 */
const CARD_BORDER = '1px solid transparent';
const CARD_SURFACE =
  'linear-gradient(135deg,rgba(255,45,120,.4),rgba(157,78,221,.3)) padding-box,'
  + 'linear-gradient(155deg, #1E1B26 0%, #100E15 100%) border-box';

export default function PortraitCard({ profile: p, onClick, width = 150, height = 200, avatarOnly = false, showType = true }) {
  const navigate = useNavigate();
  // 10F: one resolver, no artist sentinel. A row with a missing/unknown type used
  // to render as a cyan "DJ / PROD." with a DJ's placeholder photo; it now renders
  // neutral, which is honest rather than confidently wrong.
  const type = String(p?.type || '').toLowerCase();
  const pt = profileIdentity(type);
  const label = pt.shortLabel;
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
      style={{ flexShrink: 0, width, height, aspectRatio: '3 / 4', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', position: 'relative', border: CARD_BORDER, background: CARD_SURFACE, transition: 'transform .18s' }}
      onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
      onMouseLeave={e => e.currentTarget.style.transform = ''}
    >
      {/* avatar image. `alt` carries the name only when it is the SOLE
          identification on the card — with the text block rendered below,
          alt="" is correct (decorative; the visible name is the label). */}
      <img
        src={p?.avatar_thumb || p?.avatar || pt.defaultImage}
        alt={avatarOnly ? (p?.name || '') : ''}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        loading="lazy"
        decoding="async"
      />

      {avatarOnly ? null : (
        <>
          {/* gradient overlay — exists to keep the text below legible over a
              photo; skipped entirely in avatarOnly, where there is no text
              left to protect. */}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom,rgba(0,0,0,.08) 0%,rgba(0,0,0,0) 35%,rgba(0,0,0,.6) 75%,rgba(0,0,0,.88) 100%)' }} />
          {/* type pill(s) — ⚠ ON BY DEFAULT, AND THAT DEFAULT IS THE FIX.
              These were deleted outright when the Messenger rail wanted them
              gone, which silently stripped them from every OTHER surface too:
              Following, and every industry profile that renders this card. The
              brief was the Messenger rail alone. Opting OUT (showType={false},
              passed only by MessengerContactsSection) keeps that request
              satisfied without any other caller paying for it. */}
          {showType && pillLabels.length > 0 && (
            <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 6 }}>
              {pillLabels.map((l, i) => (
                <span key={i} style={{ background: pt.accent, color: getContrastText(pt.accent), filter: 'brightness(.8)', borderRadius: 6, padding: '3px 8px', fontSize: 9, fontWeight: 700, letterSpacing: .8, fontFamily: "'DM Sans',sans-serif" }}>
                  {l}
                </span>
              ))}
            </div>
          )}
          {/* info */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12 }}>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 15, letterSpacing: 1, color: '#fff', lineHeight: 1.1 }}>{p?.name}</div>
            {/* ⚠ THE REASON THIS SITS HERE RATHER THAN TOP-RIGHT IS GONE, THE
                PLACEMENT ISN'T. It used to share the corner with a type pill and
                lose the width fight; the pill is gone but nothing has reclaimed
                that space, so leaving this here is still correct, just for a
                weaker reason now — revisit if the corner gets a new occupant.
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
        </>
      )}
    </div>
  );
}
