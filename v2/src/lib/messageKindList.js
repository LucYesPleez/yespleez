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

/** Canonical kinds, in the migration's order. */
export const KINDS = [
  // Authored by the sender
  'text', 'voice', 'image', 'video', 'file', 'location', 'hand',
  // Authored by a workflow act
  'event', 'application', 'booking', 'approval',
  // Authored by the platform, via a system profile (C29)
  'system',
];

/** Human labels, used by the fallback and available to previews and badges. */
export const LABELS = {
  text:        'Message',
  voice:       'Voice message',
  image:       'Photo',
  video:       'Video',
  file:        'File',
  location:    'Location',
  // The MARK is the Hand; the WORD is Yes. This label is what an inbox
  // preview, a notification and a screen reader say, so it says what the
  // gesture means rather than what it looks like.
  hand:        'Yes',
  event:       'Event',
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
     * Two thirds of the thread, against the 76% every other kind may reach.
     *
     * A Voicey no longer stretches its wave to fill whatever width it is given —
     * bars are a fixed slice of time, so a short note draws a short wave. That
     * makes a full-width bubble the wrong container: past this the player is
     * mostly empty space for anything but a long recording.
     *
     * ⚠ This narrows the bubble RELATIVE TO A TEXT BUBBLE, which reverses part
     * of an earlier decision (voiceys were set to match text-bubble width on
     * phones). Owner's call, 2026-07-22, and it follows from the wave no longer
     * being stretched to justify the width.
     */
    maxWidth: '66.67%',
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
