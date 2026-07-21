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
    radius: 24,              // 20 → 24, softer and more deliberate
    padding: '15px 17px',    // 12/16 → more room around the player
    minHeight: 76,           // gives it presence next to a one-line text bubble
    tail: false,
  },
};

/** Geometry overrides for this kind, or null for a standard bubble. */
export function shapeFor(kind) {
  return KIND_SHAPE[kind] ?? null;
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
