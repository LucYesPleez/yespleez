import { useNavigate } from 'react-router-dom';
import s from './ProfileCard.module.css';
import { PROFILE_TYPES, profileIdentity } from '../lib/profileTypes';
import { profileUrl } from '../lib/profileResolution';
import { formatLocation } from '../lib/formatLocation';
import { selectedPerformanceRoleLabels, genreLabels } from '../lib/profileTaxonomy';
import UnclaimedBadge from './UnclaimedBadge';
import { COMPLETION_COLUMNS, completionFor } from '@yespleez/requirements';

/**
 * Every extra `profiles` column a caller must fetch to fill the OPT-IN `tags`
 * and `readiness` props — declared HERE, beside the props that created the
 * requirement, for the reason EnquiryCard learned the hard way:
 *
 * ⛔⛔ A COLUMN THE CARD READS BUT THE QUERY NEVER SELECTED ARRIVES AS
 * `undefined`, AND NOTHING THROWS. The tag row simply never appears, and the
 * readiness percentage counts every unfetched column as a real gap — so the
 * card confidently reports a finished profile as half-built. Two callers had
 * already drifted this way on the enquiry cards.
 *
 * ⚠ Callers that pass neither prop need none of this. The base row (id,
 * user_id, name, type, avatar…) is unchanged.
 */
export const PROFILE_CARD_META_COLUMNS = [...new Set(['card_pills', ...COMPLETION_COLUMNS])];

/**
 * ⭐ ONE PROJECTION OF THE OPT-IN SIGNALS, spread straight into the card:
 * `<ProfileCard {...profileCardMeta(prof)} />`.
 *
 * ⚠ Shared by the event page's four host tabs AND the dashboard's, which are
 * SEPARATE SCREENS with separate copies of the same tab bar and the same
 * cards. Written once here because a second copy is how those two surfaces
 * drifted in the first place — and how a third application card
 * (`components/ApplicationCard.jsx`) came to exist, imported nowhere.
 *
 * ⛔ READINESS IS NULL WITHOUT A PROFILE, NEVER ZERO. A hand-typed act (21 of
 * them exist) has no profiles row at all. `completionFor` cannot describe
 * somebody who never had a profile, and "0% READY" against a name the
 * organiser typed in themselves is a wrong number, not a low one — Absent ≠
 * Unknown. `completionFor` also returns null for a type with no completion
 * list; both nulls hide the chip and are deliberately not distinguished here.
 *
 * ⚠ `fallbackTags` is `lineup_members.card_pills` — an imported act can carry
 * tags on the member row with no profile behind it.
 */
export function profileCardMeta(prof, fallbackTags = null) {
  const p = prof || null;
  return {
    tags: p?.card_pills || fallbackTags || null,
    readiness: p && p.type !== 'venue' ? (completionFor(p, p.type)?.pct ?? null) : null,
  };
}

// Re-exported in { col, rgb, label, emoji } shape — DiscoverScreen and others depend on this export.
// `label` here is the compact badge/pill form (PROFILE_TYPES.shortLabel) — this
// component's own `.typeBadge` pill is a tight space, same as PortraitCard's.
export const TYPE_STYLES = Object.fromEntries(
  Object.entries(PROFILE_TYPES).map(([type, pt]) => [
    type,
    { col: pt.accent, rgb: pt.rgb, label: pt.shortLabel, emoji: pt.emoji },
  ])
);

/**
 * Props:
 *   item      – profile row: { user_id, name, type, avatar, location, state, sound, genre_string, bio }
 *   badge     – optional label overlay (e.g. "PENDING", "BOOKED")
 *   badgeColor – colour for badge
 *   actions   – optional JSX rendered below the card (accept/decline buttons etc.)
 *   cover     – ⚠ event page's Presented By ONLY (owner, 2026-08-03), every
 *               other caller must leave this false/unset. Doubles the card's
 *               height, drops the small left-hand avatar circle (the same
 *               picture already fills the card), and switches the overlay to
 *               a bottom-up fade so the name/badge/location sit over the
 *               image the way PortraitCard's do, rather than in a row beside
 *               a thumbnail. A distinct prop rather than a new default: the
 *               dashboards, Messenger's contact list and every other caller
 *               are tuned for the compact 72px row and must not change shape
 *               out from under them.
 *               ⭐ It ALSO renders `item.bio` as a window inside the card —
 *               see the note at the render site. Nothing else renders a bio,
 *               so a compact row handed a profile with one is unchanged.
 *   tags      – ⚠ OPT-IN (owner, 2026-08-15). Their curated "Your 5 Tags"
 *               (`card_pills`), rendered as the same `.spot-tag` pills the
 *               enquiry cards use, because the ask was for these rows to carry
 *               what those rows carry.
 *   readiness – ⚠ OPT-IN. The live completion percentage, or null.
 *
 * ⛔⛔ WHY `tags`/`readiness` ARE PROPS AND NOT READ OFF `item`.
 *
 * DiscoverScreen, My Scene and ProfileScreen hand this card WHOLE profile rows
 * — `item={r}` straight from a `select('*')` — so those rows already carry
 * `card_pills` today. Reading the field off `item` would therefore not be
 * "adding tags to the lineup cards", it would be adding a tag row to every
 * search result, every follow and every contact in one edit, silently, with
 * nothing at the call sites to show it happened. Same reasoning as `cover`.
 *
 * ⚠ Both grow the row past its 72px `min-height`, which is a floor and not a
 * fixed height. That growth is the point on the event tabs and is exactly why
 * neither may become a default.
 */
export default function ProfileCard({ item, badge, badgeColor, actions, onClick, followAction = null, cover = false, tags = null, readiness = null }) {
  const navigate = useNavigate();
  if (!item) return null;
  // 10F: one resolver, no artist sentinel. `item.type || 'artist'` then
  // `TYPE_STYLES[type] || TYPE_STYLES.artist` meant a row with a missing type
  // rendered as a cyan "DJ / PROD." with a DJ's photo — twice over.
  const type  = String(item.type || '').toLowerCase();
  const pt    = profileIdentity(type);
  const ts    = { col: pt.accent, rgb: pt.rgb, label: pt.shortLabel, emoji: pt.emoji };
  // The muted, near-black tone carries type identity on this card now that the coloured border
  // is gone. It is confined to the display-picture treatment and the pill fill — see below for
  // why the two text elements keep the bright accent.
  const dim   = pt.muted;
  const dimRgb = pt.mutedRgb;
  const loc   = formatLocation(item);
  /* ⛔⛔ `genreLabels`, ⛔ NEVER a raw split — role KEYS are stored inside
     `genre_string`, so an act with no `sound` of their own read "dj_prod ·
     Drum & Bass · Breaks" on Discover, My Scene and Messenger contacts. */
  const sound = item.sound || genreLabels(item.genre_string).slice(0, 3).join(' · ') || '';
  const img   = item.avatar_thumb || item.avatar || null;
  // 10F: null for an unknown type — see UNKNOWN_PROFILE. There is no neutral
  // placeholder asset, and borrowing a real type's photo is what this pass exists
  // to stop. A malformed row now shows no image rather than a stranger's.
  const defaultImg = pt.defaultImage;
  // Standup: one pill per selected performance role (Comedy/Poetry), data-
  // driven so a future role works everywhere with no call-site change.
  const roleLabels = type === 'standup' ? selectedPerformanceRoleLabels(item.genre_string) : [];
  // `.filter(Boolean)` because ts.label is null for a Personal profile
  // (PUNTER_PROFILE.shortLabel) — without it this rendered an EMPTY chip, a
  // small dash-shaped pill with no text, on every punter row. Same bug as
  // PortraitCard had, missed here until the screenshot showed it.
  const typeLabels = (roleLabels.length ? roleLabels : [ts.label]).filter(Boolean);
  /* `card_pills` is a delimited string on a profiles row and an array from some
     callers — accept both, and treat any other shape as no tags rather than
     rendering the result of splitting it. See the `tags` prop note above. */
  const tagList = Array.isArray(tags)
    ? tags.map(t => String(t).trim()).filter(Boolean)
    : typeof tags === 'string'
      ? tags.split(/[,·]/).map(t => t.trim()).filter(Boolean)
      : [];

  /**
   * Where this card goes. Extracted from the click handler so SEE MORE can
   * reach the SAME destination — a reveal that opened somewhere else, or that
   * quietly did nothing because it could not see the navigation logic, is the
   * kind of divergence that only shows up once someone taps it.
   */
  const go = () => {
    // An OPTIONAL override, not a new default. Messenger's contact list
    // reuses this card but must open the CONVERSATION rather than the
    // public profile — that list exists for talking to people. Every
    // existing caller passes nothing and keeps the navigation below.
    if (onClick) { onClick(item); return; }
    // M5: canonical profile.id URL; legacy fallback only for callers whose
    // selects don't carry `id` yet (the redirect shim covers it).
    if (item.id) navigate(profileUrl(item));
    else if (item.user_id) navigate(`/profile/${item.user_id}?type=${(item.type || '').toLowerCase()}`);
  };

  return (
    <div
      className={s.card + (cover ? ' ' + s.cover : '')}
      style={{ '--accent': ts.col, '--accent-rgb': ts.rgb }}
      onClick={go}
    >
      {/* Background image + overlay — same treatment as EventCard list rows */}
      <img className={s.bgImg} src={img || defaultImg} alt="" />
      <div className={s.bgOverlay} />

      {/* Content sits above overlay */}
      <div className={s.content}>
        {/* Avatar thumbnail. In `cover` mode it sits STACKED ABOVE the name
            (owner, 2026-08-03) rather than beside it in a row — see
            `.cover .content` for the column layout that makes that stack. */}
        {/* The DP carries the type: a 2px ring in the muted tone plus a soft outer glow of the
            same colour. Both are deliberately quiet — at ~25% saturation this reads as a
            coloured edge, not a highlight. */}
        <img className={s.avatar} src={img || defaultImg} alt={item.name}
          style={{ borderWidth: 2, borderColor: dim, boxShadow: `0 0 6px rgba(${dimRgb},.15)` }} />
        <div className={s.info}>
          <div className={s.nameRow}>
            <span className={s.name}>{item.name}</span>
            {typeLabels.map((l, i) => (
              // The pill MATCHES the ring — muted tone as the fill and edge. Its label keeps the
              // bright accent: the fill is near-black by design, so dark-on-dark text would be
              // illegible (the muted pair alone measures ~1.3:1, well under the 4.5:1 floor).
              <span key={i} className={s.typeBadge} style={{ color: ts.col, background: dim, borderColor: `rgba(${dimRgb},.9)` }}>{l}</span>
            ))}
            {/* Sits after the type badge, same order as ProfileScreen's meta
                row. .nameRow is already flex with a 7px gap and wraps, so this
                needs no spacing of its own. */}
            <UnclaimedBadge profile={item} />
            {badge && (
              <span className={s.statusBadge} style={{ color: badgeColor || '#fff', background: badgeColor ? `${badgeColor}22` : 'rgba(255,255,255,.1)', borderColor: badgeColor || '#fff' }}>
                {badge}
              </span>
            )}
          </div>
          {loc   && <div className={s.loc}><PinIcon />{loc}</div>}
          {sound && <div className={s.sound} style={{ color: ts.col }}>{sound}</div>}
          {/* ⭐ THE SAME TWO SIGNALS THE ENQUIRY CARDS CARRY, in the same order
              they appear there: the act's own five tags, then how complete
              their profile is.

              ⚠ `tagList` is normalised HERE rather than at four call sites.
              `card_pills` is a delimited STRING on a profiles row but arrives
              as a real array from some callers, and splitting a string that is
              already an array yields one pill reading "[object Object]".

              ⛔ READINESS RENDERS ONLY WHEN IT IS A NUMBER. A hand-typed act
              has no profile at all, so its readiness is genuinely UNKNOWN —
              `null` hides the chip, where `0` would publish "0% READY" about
              somebody who never had a profile to fill in. Absent ≠ unknown
              (the rendering contract), and it is the same rule EnquiryCard
              applies while a profile is still resolving. */}
          {tagList.length > 0 && (
            <div className="spot-tags" style={{ marginTop: 5 }}>
              {tagList.slice(0, 5).map(t => <span key={t} className="spot-tag">{t}</span>)}
            </div>
          )}
          {Number.isFinite(readiness) && (
            <div style={{ marginTop: 5 }}>
              <span title="How complete this profile is right now"
                style={{ fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: 1.2, color: 'var(--muted)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                <span style={{ color: ts.col }}>{Math.round(readiness)}%</span> READY
              </span>
            </div>
          )}
        </div>
        {actions && <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>{actions}</div>}
      </div>

      {/* ⭐ THE BIO, IN A WINDOW ON THE RIGHT (owner, 2026-08-04: "i think the
          bio can be put into a window inside the card", then "put the text
          window over to the right ... and the card to go back to the size it
          was").

          ⚠ A SIBLING OF `.content`, NOT A CHILD. `.content` is the
          bottom-anchored stack on the LEFT — avatar, name, badge, location.
          Nested inside it the bio inherited that column and sat under the
          name, which is what forced the card to grow. Out here the two are
          independent layers over the same picture, each absolutely positioned,
          neither able to push the other.

          Same fill/edge/blur as § 7's address panel and GET DIRECTIONS, so a
          panel resting on a picture reads the same way everywhere in the app
          rather than being invented once per section.

          ⚠ `cover` only. Every other caller — the dashboards, Messenger's
          contact list, lineup rosters — is a compact 72px row that a paragraph
          would wreck, and many are handed profile rows carrying a `bio` field
          they have never rendered. */}
      {cover && item.bio && (
        <div className={s.bioWindow}>
          <p className={s.bioText}>{item.bio}</p>
          {/* ⭐ ALWAYS SHOWN (owner, 2026-08-04: "make it always say see more on
              the end. this is to encourage people to click it to look at their
              profile").
              It was previously conditional on the text actually overflowing —
              measured with a ResizeObserver, since the panel is a percentage
              of a fluid card and a character threshold would have been wrong
              at some widths. That whole apparatus is DELETED rather than left
              computing a value nothing reads: the reveal is now a standing
              invitation to the profile, not a truncation notice, so there is
              nothing left to measure.
              It stays honest either way — the destination genuinely does hold
              more about the host than four lines can, whether or not the bio
              itself was cut. */}
          <button
            type="button"
            className={s.bioMore}
            /* stopPropagation AND go(): without the stop, the card's own
               handler fires too and the same navigation runs twice. */
            onClick={e => { e.stopPropagation(); go(); }}
          >
            SEE MORE
          </button>
        </div>
      )}

      {/* BOTTOM-RIGHT, matching where the heart sits on every horizontal event
          card (owner, 2026-08-01). An OPT-IN slot, not built in: this card also
          renders messenger contacts, event lineups and dashboard rosters, where
          offering to follow makes no sense. Kept separate from `actions`, which
          is an inline row inside the content flow — this floats over the card
          so it cannot squeeze the name. */}
      {followAction && (
        <div style={{ position: 'absolute', bottom: 8, right: 10, zIndex: 3 }}
          onClick={e => { e.stopPropagation(); }}>
          {followAction}
        </div>
      )}
    </div>
  );
}

function PinIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 3 }}>
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>
    </svg>
  );
}
