import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getPersonalProfileId } from '../lib/actingProfile';
import { track, EVENTS } from '../lib/analytics';
import { likedEvents } from '../lib/likedEvents';
import { useSession } from '../App';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The heart as it sits ON a poster — EventCard's `cornerAction` slot.
 *
 * Exported rather than copied so What's On and My Scene cannot drift into two
 * subtly different save buttons, which is the same problem the two portrait
 * event cards had before they were unified.
 */
export const HEART_OVERLAY_STYLE = {
  width: 30, height: 30, borderRadius: '50%',
  background: 'rgba(0,0,0,.55)',
  // ⚠ LONGHAND, not the `border` shorthand. The liked state below sets
  // `borderColor`, and React warns — correctly — that mixing the two for one
  // property causes styling bugs. It did: the shorthand won, so a saved heart
  // never showed its pink ring.
  borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(255,255,255,.3)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#fff', cursor: 'pointer', padding: 0,
};

/**
 * THE save-to-scene affordance — one glyph, one relationship.
 *
 * Extracted from WhatsOnScreen so My Scene's catalogue floor and What's On
 * share the exact interaction: a heart that toggles a `follows` row with
 * entity_type 'event'. That row is ALSO what My Scene reads as SAVED /
 * ATTENDING, so this is not a like button that happens to resemble saving —
 * it IS the save. A second lookalike writing a different table would split
 * one user intent across two states.
 *
 * `onChange(liked)` fires ONLY when the write actually landed — My Scene uses
 * it to toast and refresh its saved section in place. `onError(error, intent)`
 * fires when it did not. `style` allows placement without a CSS module class
 * (the floor cards position it over the poster).
 *
 * ⚠ SUPABASE RETURNS ERRORS, IT DOES NOT THROW THEM.
 *
 * This component used to discard both results. A rejected insert was therefore
 * indistinguishable from a saved one: the heart filled, My Scene toasted
 * "Saved — find it under SAVED", and no row existed. That is exactly how the
 * event heart went unnoticed for months while `follows_entity_type_check`
 * rejected every single 'event' row with 23514 (confirmed 2026-07-31 by
 * authenticated probe; the constraint permits only the profile types).
 *
 * The same lesson is written on ProfileScreen.doFollow, which learned it the
 * expensive way — three "new follower" notifications delivered to a real
 * person for a follow that never happened. Never discard the result again.
 */
export default function HeartBtn({ event, className, style, onChange, onError }) {
  const { session } = useSession();
  const [liked, setLiked] = useState(() => likedEvents.has(event.id));
  const [busy,  setBusy]  = useState(false);
  const isReal = UUID_RE.test(event.id);

  useEffect(() => {
    if (!session?.user?.id || !isReal) return;
    if (likedEvents.has(event.id)) return; // already confirmed this session
    supabase.from('follows').select('id').eq('user_id', session.user.id).eq('entity_id', event.id).maybeSingle()
      .then(({ data }) => {
        if (data) { likedEvents.add(event.id); setLiked(true); }
      });
  }, [event.id, session?.user?.id, isReal]);

  /** Printed as text, not as an object: a collapsed [{…}] in the console hides
   *  the one thing worth reading — code, message, details, hint. */
  function report(intent, error) {
    console.error(
      `[heart] ${intent} rejected —`,
      `code=${error?.code}`, `message=${error?.message}`,
      `details=${error?.details}`, `hint=${error?.hint}`,
    );
  }

  async function toggle(e) {
    e.stopPropagation();
    if (!session?.user?.id || busy || !isReal) return;
    setBusy(true);
    if (liked) {
      const { error } = await supabase.from('follows').delete().eq('user_id', session.user.id).eq('entity_id', event.id);
      if (error) { report('unsave', error); onError?.(error, 'unsave'); setBusy(false); return; }
      likedEvents.delete(event.id); setLiked(false);
      onChange?.(false);
    } else {
      // M6 (R6.1): stamp attribution at write time — personal act (§A6/§A9).
      const fromProfileId = await getPersonalProfileId(session.user.id);
      const { error } = await supabase.from('follows').insert({ user_id: session.user.id, from_profile_id: fromProfileId, entity_id: event.id, entity_type: 'event', entity_name: event.name });
      // The heart must not fill and nothing may claim a save happened. The
      // UI's state is the write's state, not the tap's.
      if (error) { report('save', error); onError?.(error, 'save'); setBusy(false); return; }
      track(EVENTS.FOLLOWED, { entity_type: 'event' });
      likedEvents.add(event.id); setLiked(true);
      onChange?.(true);
    }
    setBusy(false);
  }

  // Liked styles come LAST so they win. They used to be first, with the
  // caller's `style` spread over the top, which meant an overlay heart's base
  // border silently overrode the saved-state one.
  return (
    <button className={className} onClick={toggle} style={{ ...style, ...(liked ? { color: 'var(--neon)', borderColor: 'rgba(255,45,120,.5)' } : {}) }}>
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill={liked ? 'var(--neon)' : 'none'} stroke={liked ? 'var(--neon)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    </button>
  );
}
