/**
 * THE KIND LIST, AS DATA — no JSX, so anything may import it.
 *
 * `messageKinds.jsx` is still the registry and still the single source of
 * truth for what a kind IS; it re-exports these two so nothing has to know
 * this file exists. The split is purely about reach:
 *
 *   - `node --test` has no JSX transform, so a test cannot import the .jsx at
 *     all. The kind contract was therefore verified by regex over source text,
 *     which works but proves less than importing the real value.
 *   - `messaging.js` mirrors the database's CHECK when validating a send, the
 *     same way it mirrors messages_body_not_blank. Importing the registry
 *     would pull JSX into the data layer and break its tests.
 *
 * The list stays in ONE place. This is where it lives; the registry maps it to
 * renderers.
 *
 * MUST match the CHECK in `20260721000000_m9a_message_kinds.sql`.
 * `messageKindContract.test.js` fails if it drifts.
 */

/**
 * Canonical kinds, in the migration's order.
 *
 * ⚠ ORDER IS PART OF THE CONTRACT — `messageKindContract.test.js` compares
 * this array to the CHECK with `deepEqual`, so a kind added in a different
 * position here than in the SQL fails the suite even though both lists hold
 * the same members.
 */
export const KINDS = [
  // Authored by the sender · M9i put `audio` beside `voice` deliberately,
  // because that is the distinction people get wrong: `voice` is the Voicey
  // recorder, `audio` is an uploaded track. ⛔ Never compress a master into a
  // Voicey. ⭐ HD is METADATA (`payload.hd`), never a kind — there is no
  // `hd_audio`, and adding one would double this list per quality tier.
  'text', 'voice', 'audio', 'image', 'video', 'file', 'location', 'hand',
  // Canonical objects shared into a conversation, BY REFERENCE (M9i).
  'event', 'profile',
  // Authored by a workflow act
  'application', 'booking', 'approval',
  // Authored by the platform, via a system profile (C29)
  'system',
];

/** Human labels, used by the fallback and available to previews and badges. */
export const LABELS = {
  text:        'Message',
  voice:       'Voice message',
  // ⚠ "Audio", never "Voice message" — the two are different things and this
  // label is what a notification preview and an older client show. ⭐ An HD
  // master is still Audio here: quality lives in `payload.hd`, so the label
  // does not fork into "HD Audio" and leave every consumer with two names for
  // one kind. A surface that wants to say HD reads the payload.
  audio:       'Audio',
  image:       'Photo',
  video:       'Video',
  file:        'File',
  location:    'Location',
  // ⚠ THE UI NEVER SAYS "YES" (owner, 2026-07-26). The mark is the YesPleez
  // Hand and the word is Acknowledged — one name for the gesture everywhere
  // it is described, so the product does not use two words for one thing.
  //
  // `HAND_BODY` in hands.js is still the literal 'Yes', deliberately: that is
  // the stored message BODY, already written into every existing hand message
  // and into notification rows that quote it. Changing it would split history
  // for a string a user rarely sees, since the mark itself renders. Labels are
  // presentation and change freely; stored text does not.
  hand:        'Acknowledged',
  event:       'Event',
  // A profile shared into the conversation — a REFERENCE to the canonical row,
  // never a copy of it (M9i).
  profile:     'Profile',
  application: 'Application',
  booking:     'Booking',
  approval:    'Approval',
  system:      'System message',
};

/** True when the database's CHECK would accept this kind. */
export function isKind(kind) {
  return KINDS.includes(kind);
}

/**
 * KINDS THAT ARE NOT DRAWN IN A BUBBLE.
 *
 * A bubble says "someone said this". Some messages are not saying anything —
 * they ARE the thing. An acknowledgement is a mark, and wrapping a mark in a
 * speech bubble makes it look like a picture of a gesture rather than the
 * gesture itself. Messenger's standalone 👍 works for exactly this reason.
 *
 * Bare kinds keep everything else a message has — position in the thread, the
 * sender's side, the avatar, the timestamp, read state, scrolling. ONLY the
 * container is dropped: no background, no border, no padding, no tail.
 *
 * Declared here rather than branched on inside the bubble, because "is this
 * drawn in a bubble" is a property of the KIND, and the kind list is the one
 * place that knows about kinds.
 */
export const BARE_KINDS = new Set(['hand']);

/** True when this kind renders as a standalone graphic, not inside a bubble. */
export function isBareKind(kind) {
  return BARE_KINDS.has(kind);
}

/**
 * KINDS THAT CANNOT BE GIVEN A YES.
 *
 * A Hand IS a Yes. Double-tapping one to say Yes to it is a Yes about a Yes,
 * which the product has no meaning for — the ratified rule is that a
 * CONVERSATION Hand is a message and a MESSAGE Hand is metadata, and this would
 * be metadata about a message that is itself only that gesture.
 *
 * ── IT ALSO REMOVES A LAYOUT PROBLEM RATHER THAN HIDING ONE ──────────
 *
 * Because this kind has no bubble, its timestamp sat below the mark and made the
 * message's bottom edge the clock — so the Yes badge, anchored to the frame's
 * bottom-left corner as it is for every kind, landed on the time. That was fixed
 * once by moving the clock beside the mark, and the owner reverted it: they did
 * not want the Hand message redrawn. Refusing the gesture removes the case
 * instead of positioning around it, and leaves the badge contract untouched.
 *
 * ⚠ AN ALLOW-BY-DEFAULT LIST. A kind not named here CAN be handed, so image,
 * video, file, location and every future kind inherit the gesture without
 * touching this. Only a kind that is itself an acknowledgement belongs here.
 */
export const UNHANDABLE_KINDS = new Set(['hand']);

/** True when a message of this kind can be given a Yes by double-tapping it. */
export function canReceiveHand(kind) {
  return !UNHANDABLE_KINDS.has(kind);
}

/**
 * CONTAINER GEOMETRY FOR KINDS THAT ARE NOT PLAIN BUBBLES.
 *
 * `BARE_KINDS` answered "chrome or no chrome". This answers the question one
 * step in: a kind can keep the chrome and still not be shaped like a message.
 *
 * A voice note is the case that forced it. Inside a standard bubble it reads as
 * a chat message with a player dropped into it; given its own proportions it
 * reads as a purpose-built audio component that happens to live in a thread.
 * Only the SHAPE differs — the fill, border and colour are the bubble's, so a
 * Voicey still belongs to whoever sent it.
 *
 * Geometry only, deliberately. Nothing here may set a colour: the moment this
 * map can restyle a bubble, "what kind is this" and "how does this look" stop
 * being separable and every future kind arrives with its own palette.
 *
 * `tail: false` drops the asymmetric corner. A tail is what makes a rectangle
 * read as speech, and a voice note is not speech — it is an object.
 */
export const KIND_SHAPE = {
  voice: {
    /**
     * ⚠ NO maxWidth HERE, DELIBERATELY. A Voicey takes the frame's 76% like
     * every other kind — the point is that it behaves like a text bubble: short
     * ones are physically short, long ones grow, and the ceiling they grow into
     * is the same ceiling text grows into.
     *
     * It was 66.67% for one round. That narrowed a Voicey relative to a text
     * bubble, which is the opposite of the consistency being asked for, and it
     * also cost the growth phase a third of its range.
     */
    radius: 24,              // 20 → 24, softer and more deliberate
    padding: '15px 17px',    // 12/16 → more room around the player
    minHeight: 76,           // gives it presence next to a one-line text bubble
    tail: false,
    // The player already draws a line carrying its duration. Left to the
    // bubble, the clock would land on a SECOND line underneath it — two
    // timings stacked, saying different things, in a component whose whole
    // point is that it is one object. So the renderer draws both on one line:
    // length on the left, clock on the right.
    ownsTimestamp: true,
    // Hover and press states live in CSS. They cannot be inline — there is no
    // inline `:hover` — and putting them in React state would re-render the
    // component on mouse movement, which for this kind means competing with
    // the playhead.
    className: 'yp-voice-bubble',
  },

  /**
   * A photo (M11). Almost no chrome: the picture is the message, and a wide
   * mount around it reads as a frame someone put the photo in.
   *
   * ⚠ NOT `padding: 0`. 4px keeps the bubble's own edge visible as a hairline
   * around the picture, which is what still ties it to its sender — at zero the
   * photo becomes a bare rectangle and the sent/received material stops being
   * readable at all. It is the smallest padding that leaves the material doing
   * its job.
   *
   * `ownsTimestamp` is deliberately ABSENT, unlike voice. A Voicey claims the
   * line because it already draws a duration there and two timings stacked
   * would contradict each other. A photo draws no time of its own, so the
   * bubble's ordinary clock-and-receipt row is exactly right.
   */
  image: {
    radius: 20,
    padding: 4,
    tail: false,
  },

  /**
   * A document (M12). Keeps the tail and ordinary bubble corners — unlike a
   * photo or a Voicey it IS a thing someone said, and it sits in the thread as
   * a message rather than as an object.
   *
   * Padding is tightened to 5 because the row inside already draws its own
   * inset around the icon and name; the bubble's usual 12/16 on top of that
   * left the attachment floating in the middle of a much larger box.
   */
  file: {
    radius: 18,
    padding: 5,
  },

  /**
   * A shared event. Same treatment as a document and for the same reason: the
   * card draws its own border and cover, so the bubble's usual 12/16 would put
   * a frame around a frame — the exact mistake the composer capsule was
   * redesigned to remove.
   *
   * Keeps the TAIL. Sharing an event is something a person did in the middle
   * of a conversation, not an object that arrived, so it should read as one of
   * their turns.
   */
  event: {
    radius: 18,
    padding: 4,
  },
};

/** Geometry overrides for this kind, or null for a standard bubble. */
export function shapeFor(kind) {
  return KIND_SHAPE[kind] ?? null;
}

/**
 * MATERIAL — the finish a kind is made of, kept apart from its geometry.
 *
 * `KIND_SHAPE` is forbidden from carrying colour, and a test enforces it. This
 * is where colour is allowed to live instead. The separation is the point: one
 * map answers "what shape is this", the other "what is it made of", and neither
 * can quietly become the other.
 *
 * ── WHY DIRECTION STILL BRANCHES ─────────────────────────────────────
 *
 * A Voicey gets its own finish, but it must still say WHO SENT IT — that is
 * what the bubble fill has always carried. So the material is per direction:
 * sent takes the deep violet, received a neutral glass of the same family.
 * Giving both the violet would have made a Voicey the one message type where
 * you cannot tell at a glance whose it is.
 *
 * ── DEEP VIOLET, NOT BRIGHT PURPLE ───────────────────────────────────
 *
 * ⚠ THIS OBJECT IS THE ONE THAT DECIDES. It is spread LAST over the bubble's
 * own style, so whatever `ConversationView` sets for a sent bubble is discarded
 * for a Voicey. A previous pass retuned `SENT_BUBBLE` there and nothing visibly
 * changed, because this was overriding all of it. If a Voicey looks wrong, look
 * here FIRST — this is where its colour actually lives.
 *
 * A dark venue with intelligent lighting, not purple paint. The purple is the
 * lighting design; the surface is black glass. Those are different aesthetics,
 * and the old body — a saturated violet at .88 — was firmly the second one.
 *
 * Alphas stay high (.90–.94) so the wallpaper sits behind the content instead
 * of competing with it, and the blur keeps it glass rather than paint.
 *
 * The inset top hairline is a highlight, not a bevel — one pixel of light at
 * the top edge, no bottom shadow, nothing skeuomorphic.
 *
 * ── WHAT NOW CARRIES DIRECTION ───────────────────────────────────────
 *
 * Sent no longer wins on saturation, so the warning above matters MORE, not
 * less. Sent is now the DARKER of the two and carries the magenta edge and the
 * violet bloom; received stays neutral and slightly lighter with a plain white
 * hairline. Direction reads from lighting rather than from hue — which is the
 * thing to check first if the two ever stop being tellable apart.
 */
export const KIND_MATERIAL = {
  voice: {
    sent: {
      background:
        // 1 · a violet bloom behind the glass, .34 → .10. It should look like
        //     something lit BEHIND the surface, not like tinted glass.
        'radial-gradient(120% 85% at 50% -10%, rgba(167,110,255,.10) 0%, rgba(167,110,255,0) 62%) padding-box,' +
        // 2 · the body. Was rgba(74,44,146) — thirty points of spread between
        //     red and blue, i.e. the purple WAS the material. Six points now:
        //     roughly 90% black, 8% charcoal, 2% purple.
        'linear-gradient(158deg, rgba(22,20,28,.90) 0%, rgba(12,11,16,.94) 100%) padding-box,' +
        // 3 · MAGENTA EDGE LIGHTING. A gradient border, not a flat one: a
        //     uniform coloured outline is a drawn line, while an edge that
        //     catches at one corner and dies away is light landing on a surface.
        'linear-gradient(150deg, rgba(255,79,216,.42) 0%, rgba(191,95,255,.15) 44%, rgba(255,255,255,.04) 100%) border-box',
      border: '1px solid transparent',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.07), 0 10px 26px -18px rgba(0,0,0,.95)',
      backdropFilter: 'blur(14px)',
    },
    received: {
      background:
        'radial-gradient(120% 85% at 50% -10%, rgba(255,255,255,.07) 0%, rgba(255,255,255,0) 62%),' +
        'linear-gradient(158deg, rgba(32,32,44,.86) 0%, rgba(20,20,30,.90) 100%)',
      border: '1px solid rgba(255,255,255,.11)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.07), 0 10px 26px -18px rgba(0,0,0,.95)',
      backdropFilter: 'blur(14px)',
    },
  },
};

/** The finish for this kind and direction, or null to use the bubble's own. */
export function materialFor(kind, isMine) {
  const m = KIND_MATERIAL[kind];
  if (!m) return null;
  return (isMine ? m.sent : m.received) ?? null;
}

/**
 * ACKNOWLEDGEMENT SIZING — designed in now, driven later.
 *
 * A quick tap sends the default. A future press-and-hold will send something
 * bigger, the way Messenger grows an emoji the longer you hold it.
 *
 * `payload.scale` is stored rather than a pixel size: pixels are a rendering
 * decision that changes with the design, while "the sender meant this one
 * BIGGER" is a fact about the message that stays true forever. Storing pixels
 * would freeze today's layout into every row.
 *
 * Supported from the outset because payload shape is the expensive thing to
 * change afterwards — every Hand sent before a scale existed would need
 * rewriting, which is the same asymmetry that made waveform peaks a
 * record-time decision.
 */
export const HAND_SCALE_MIN = 1;
export const HAND_SCALE_MAX = 3;

/** Clamp an incoming scale. Payloads are unvalidated by design (M9a). */
export function handScale(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return HAND_SCALE_MIN;
  return Math.min(HAND_SCALE_MAX, Math.max(HAND_SCALE_MIN, n));
}
