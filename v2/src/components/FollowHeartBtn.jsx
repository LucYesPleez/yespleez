import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getPersonalProfileId } from '../lib/actingProfile';
import { track, EVENTS } from '../lib/analytics';
import { followedProfiles } from '../lib/followedProfiles';
import { useSession } from '../App';
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
export default function FollowHeartBtn({ profile, style, className, onChange, onError }) {
  const { session } = useSession();
  const pid = profile?.id;
  const legacyId = profile?.user_id ?? profile?.id;
  const [followed, setFollowed] = useState(() => followedProfiles.has(pid));
  const [busy, setBusy] = useState(false);

  // Never offer to follow yourself.
  const isSelf = !!session?.user?.id && profile?.user_id === session.user.id;

  useEffect(() => {
    if (!session?.user?.id || !pid || isSelf) return;
    if (followedProfiles.has(pid)) return;           // already confirmed this session
    supabase.from('follows').select('id')
      .eq('user_id', session.user.id)
      .or(`target_profile_id.eq.${pid},entity_id.eq.${legacyId}`)
      .maybeSingle()
      .then(({ data }) => { if (data) { followedProfiles.add(pid); setFollowed(true); } });
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
    if (!session?.user?.id || busy || !pid || isSelf) return;
    setBusy(true);
    if (followed) {
      const { error } = await supabase.from('follows').delete()
        .eq('user_id', session.user.id).eq('entity_id', legacyId);
      if (error) { report('unfollow', error); onError?.(error, 'unfollow'); setBusy(false); return; }
      followedProfiles.delete(pid); setFollowed(false);
      onChange?.(false, profile);
    } else {
      const fromProfileId = await getPersonalProfileId(session.user.id);
      const { error } = await supabase.from('follows').insert({
        user_id: session.user.id, from_profile_id: fromProfileId,
        entity_id: legacyId, entity_type: profile.type, entity_name: profile.name,
        target_profile_id: pid,
      });
      if (error) { report('follow', error); onError?.(error, 'follow'); setBusy(false); return; }
      track(EVENTS.FOLLOWED, { entity_type: profile.type });
      followedProfiles.add(pid); setFollowed(true);
      onChange?.(true, profile);
    }
    setBusy(false);
  }

  if (isSelf) return null;

  return (
    <button
      className={className}
      onClick={toggle}
      aria-label={followed ? `Unfollow ${profile?.name || 'profile'}` : `Follow ${profile?.name || 'profile'}`}
      aria-pressed={followed}
      /* Liked styles last so they win over the caller's `style` — the same
         ordering bug HeartBtn documents, where a base border silently beat the
         saved-state one. */
      style={{ ...HEART_BARE_STYLE, ...style, ...(followed ? { color: 'var(--neon)' } : {}) }}
    >
      <HeartGlyph filled={followed} />
    </button>
  );
}
