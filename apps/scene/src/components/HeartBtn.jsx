import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { saveEvent, unsaveEvent } from '../lib/participation';
import { likedEvents } from '../lib/likedEvents';
import { useSession } from '../App';
import { useParticipation } from './ParticipationGate';
import { announceTeach } from '../lib/firstUseTeach';

import { HEART_OVERLAY_STYLE, HEART_BARE_STYLE, HeartGlyph } from './heartStyles';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ⚠ The styles and the glyph now live in ./heartStyles — that file imports
   NOTHING that reaches App, which is what stops the cycle
   App → MySceneScreen → FollowHeartBtn → HeartBtn → App from putting
   HEART_OVERLAY_STYLE in the temporal dead zone. Re-exported here so existing
   `from './HeartBtn'` imports keep working, but NEW code importing only the
   styles should import ./heartStyles directly and stay out of the cycle. */
export { HEART_OVERLAY_STYLE, HEART_BARE_STYLE, HeartGlyph };

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
  const requestParticipation = useParticipation();
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
    if (busy || !isReal) return;
    /**
     * ⭐ O2 — a signed-out tap OPENS THE PARTICIPATION GATE. This was a
     * silent `return`: the most natural "I want in" moment in the product,
     * and the tap died with no feedback at all. The gate captures the
     * returnIntent (this route, this event id) and after auth the save
     * completes via lib/intentActions — the SAME saveEvent below, never a
     * second write path.
     */
    if (!session?.user?.id) {
      requestParticipation('save_event', { context: { eventId: event.id } });
      return;
    }
    setBusy(true);
    if (liked) {
      const { error } = await unsaveEvent(session.user.id, event.id);
      if (error) { report('unsave', error); onError?.(error, 'unsave'); setBusy(false); return; }
      setLiked(false);
      onChange?.(false);
    } else {
      // The write, cache update and tracking live in lib/participation —
      // shared with the intent executor. The heart must not fill and nothing
      // may claim a save happened unless the write landed: the UI's state is
      // the write's state, not the tap's.
      const { error } = await saveEvent(session.user.id, event);
      if (error) { report('save', error); onError?.(error, 'save'); setBusy(false); return; }
      setLiked(true);
      onChange?.(true);
      /**
       * ⭐ O4 · the first save is the moment MY SCENE becomes a real place —
       * the heart is obvious, where it went is not. Announced only after the
       * write LANDED, so nothing is taught about a save that did not happen.
       * ⛔ This must not learn whether the lesson will be shown; that is
       * lib/firstUseTeach's job, once.
       */
      announceTeach('saved_event');
    }
    setBusy(false);
  }

  // Liked styles come LAST so they win. They used to be first, with the
  // caller's `style` spread over the top, which meant an overlay heart's base
  // border silently overrode the saved-state one.
  return (
    <button
      /* ⚠ APPENDED, NOT SUBSTITUTED — the caller's className survives. Same
         treatment as FollowHeartBtn: one edit here covers every event heart in
         the app rather than ~28 call sites. Touch-only; see `.yp-tap44`. */
      className={className ? `${className} yp-tap44` : 'yp-tap44'}
      onClick={toggle}
      /* ⚠ THERE WAS NO ACCESSIBLE NAME AT ALL. This button is an SVG glyph and
         nothing else, so a screen reader announced 28 of them on My Scene as
         "button", "button", "button". Found while giving it a 44px target —
         the same class of problem, and the event was already in scope, so it
         is named here rather than left for a sweep that may not come.
         Mirrors FollowHeartBtn, which already labels and presses correctly. */
      aria-label={liked
        ? `Remove ${event?.name || 'this event'} from your scene`
        : `Save ${event?.name || 'this event'} to your scene`}
      aria-pressed={liked}
      style={{ ...style, ...(liked ? { color: 'var(--neon)', borderColor: 'rgba(255,45,120,.5)' } : {}) }}
    >
      <HeartGlyph filled={liked} />
    </button>
  );
}
