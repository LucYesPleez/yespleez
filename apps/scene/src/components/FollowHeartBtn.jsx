import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { followProfile, unfollowProfile } from '../lib/participation';
import { followedProfiles } from '../lib/followedProfiles';
import { useSession } from '../App';
import { useParticipation } from './ParticipationGate';
// ⚠ from ./heartStyles, NOT ./HeartBtn — importing the button pulls App into
// the cycle and puts the styles in the TDZ. See heartStyles.jsx.
import { HeartGlyph, HEART_BARE_STYLE } from './heartStyles';

/**
 * The heart on a PROFILE card — same mark as HeartBtn, different row.
 *
 * Owner, 2026-08-01: "can you make it a heart still and it just goes to the
 * correct places? it would be good to keep it uniform." So the reader sees one
 * glyph meaning one thing — this is in my scene — and the component underneath
 * routes it to the relationship that actually applies.
 *
 * ⚠ THIS IS NOT HeartBtn WITH A DIFFERENT ID. HeartBtn hardcodes
 * `entity_type: 'event'`; a profile follow is a different shape entirely and
 * writing the event shape here would produce rows nothing reads:
 *
 *     entity_id         profile.user_id ?? profile.id   (legacy join key —
 *                       placeholder profiles have NO user_id, hence the ??)
 *     entity_type       the profile's type, not 'event'
 *     target_profile_id profile.id  ← M5.1 (D6): the CANONICAL key. Followed
 *                       profiles resolve by this; entity_id is only consulted
 *                       for legacy rows that predate it.
 *     from_profile_id   the FOLLOWER's personal profile (M6/R6.1). Two ends,
 *                       two columns — never conflate them.
 *
 * That is byte-for-byte the row MySceneScreen.addFavourite and
 * ProfileScreen.doFollow write, deliberately: favourites ARE follows, so a
 * third write shape would split one user intent across two states.
 *
 * ⚠ SUPABASE RETURNS ERRORS, IT DOES NOT THROW THEM — the heart only fills
 * when the write actually landed. HeartBtn's docblock records what discarding
 * that result cost: months of silently failing event saves, and three "new
 * follower" notifications for a follow that never happened.
 */
/**
 * ⭐⭐ THE GRADIENT TEXT OF THE PROFILE PAGE'S OWN FOLLOW BUTTON, so the `label`
 * variant is the same control the reader already met there rather than a
 * lookalike. ⚠ Inline for the same reason ProfileScreen does it inline: a
 * clipped-text gradient cannot be expressed as a plain colour token.
 */
const FOLLOW_LABEL_GRADIENT = {
  /* ⚠ A TOKEN WITH THE PROFILE PAGE'S RAMP AS ITS DEFAULT, so a surface with
     its own palette can retune it (`--follow-ramp`) without a second copy of
     this button existing. ⛔ Do not hardcode the ramp back. */
  backgroundImage: 'var(--follow-ramp, linear-gradient(135deg, #00E5FF, #BF5FFF))',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
};

/**
 * @param variant  'heart' (default) — the uniform in-my-scene mark.
 *                 'label'  — "+ FOLLOW" / "✓ FOLLOWING", the profile page's
 *                 wording, for surfaces where a bare heart does not say what
 *                 it would do. ⭐⭐ SAME COMPONENT EITHER WAY: the two-keyspace
 *                 read, the self check, the participation gate and the write
 *                 are the part that must never be reimplemented — only the
 *                 chrome differs, and the caller supplies that.
 */
export default function FollowHeartBtn({ profile, style, className, onChange, onError, variant = 'heart' }) {
  const { session } = useSession();
  const requestParticipation = useParticipation();
  const pid = profile?.id;
  const legacyId = profile?.user_id ?? profile?.id;
  const [followed, setFollowed] = useState(() => followedProfiles.has(pid));
  const [busy, setBusy] = useState(false);

  // Never offer to follow yourself.
  const isSelf = !!session?.user?.id && profile?.user_id === session.user.id;

  useEffect(() => {
    if (!session?.user?.id || !pid || isSelf) return;
    if (followedProfiles.has(pid)) return;           // already confirmed this session
    /* ⚠ `.limit(1)`, NEVER `.maybeSingle()` — ONE FOLLOW CAN HAVE TWO ROWS.
       The two keyspaces this OR spans are not exclusive: pre-M5 rows keyed
       entity_id by profile.id, current rows key it by user_id, and an account
       followed across that change owns one of each. maybeSingle() treats the
       second row as an ERROR (PGRST116) and returns data=null, so the heart
       read as unfollowed — and the follow it then tried to write collided with
       the row already there (23505), silently, forever. Measured on live data
       2026-08-08: one profile in the table was in exactly this state, and it
       was the one that could not be hearted. ProfileScreen already reads it
       this way (ProfileScreen.jsx:220); this was the outlier. */
    supabase.from('follows').select('id')
      .eq('user_id', session.user.id)
      .or(`target_profile_id.eq.${pid},entity_id.eq.${legacyId}`)
      .limit(1)
      .then(({ data }) => { if (data?.length) { followedProfiles.add(pid); setFollowed(true); } });
  }, [pid, legacyId, session?.user?.id, isSelf]);

  function report(intent, error) {
    console.error(
      `[follow-heart] ${intent} rejected —`,
      `code=${error?.code}`, `message=${error?.message}`,
      `details=${error?.details}`, `hint=${error?.hint}`,
    );
  }

  async function toggle(e) {
    e.stopPropagation();
    e.preventDefault();
    if (busy || !pid || isSelf) return;
    /**
     * ⭐ O2 — a signed-out tap OPENS THE PARTICIPATION GATE instead of dying
     * silently. Intent context is the profile ID ONLY; `display` carries the
     * type purely for the gate's copy and never enters the stored intent.
     * After auth the follow completes via lib/intentActions — the SAME
     * followProfile below, so the two-keyspace row shape has one author.
     */
    if (!session?.user?.id) {
      requestParticipation('follow_profile', {
        context: { profileId: pid },
        display: { type: profile?.type },
      });
      return;
    }
    setBusy(true);
    if (followed) {
      /* Both keyspaces, in lib/participation, for the same reason the read
         spans both: deleting only the entity_id match leaves a legacy row
         behind, the heart empties, and the next mount reads that survivor
         and fills it again. Matches ProfileScreen.toggleFollow. */
      const { error } = await unfollowProfile(session.user.id, profile);
      if (error) { report('unfollow', error); onError?.(error, 'unfollow'); setBusy(false); return; }
      setFollowed(false);
      onChange?.(false, profile);
    } else {
      // Write, cache and tracking in lib/participation — shared with the
      // intent executor. The heart only fills when the write landed.
      const { error } = await followProfile(session.user.id, profile);
      if (error) { report('follow', error); onError?.(error, 'follow'); setBusy(false); return; }
      setFollowed(true);
      onChange?.(true, profile);
    }
    setBusy(false);
  }

  if (isSelf) return null;

  return (
    <button
      /* ⚠ `yp-tap44` IS APPENDED, NOT SUBSTITUTED — the caller's className is
         still whatever it passed. Measured at 30×30 on My Scene with 27–130px
         of clearance, so the hit area cannot reach a neighbour. One edit here
         covers every follow control in the app; the alternative was ~50 call
         sites, which is how a few of them end up missed. */
      className={className ? `${className} yp-tap44` : 'yp-tap44'}
      onClick={toggle}
      aria-label={followed ? `Unfollow ${profile?.name || 'profile'}` : `Follow ${profile?.name || 'profile'}`}
      aria-pressed={followed}
      /* Liked styles last so they win over the caller's `style` — the same
         ordering bug HeartBtn documents, where a base border silently beat the
         saved-state one. */
      /* ⚠ The bare-heart reset is for the HEART. A label variant carries the
         caller's own chrome, and stripping background and border here would
         quietly undo it. */
      style={variant === 'label'
        ? style
        : { ...HEART_BARE_STYLE, ...style, ...(followed ? { color: 'var(--neon)' } : {}) }}
    >
      {variant === 'label'
        ? <span style={followed ? undefined : FOLLOW_LABEL_GRADIENT}>
            {followed ? '✓ FOLLOWING' : '+ FOLLOW'}
          </span>
        : <HeartGlyph filled={followed} />}
    </button>
  );
}
