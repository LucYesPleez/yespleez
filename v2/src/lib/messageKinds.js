/**
 * WHAT A MESSAGE CAN BE — the client's half of the `kind` contract.
 *
 * The other half is `messages_kind_valid` in
 * `20260721000000_m9a_message_kinds.sql`. These two lists must be identical:
 * the database decides what may be STORED, this decides what may be RENDERED,
 * and a kind in one but not the other is a message that either cannot be
 * written or cannot be read. `messageKinds.test.js` reads the migration and
 * fails if they drift, so the pairing is enforced rather than remembered.
 *
 * ── WHY A LIST AND NOT JUST A SWITCH ─────────────────────────────────
 *
 * A `switch` answers "how do I draw this?". It cannot answer "is this a kind
 * this app has heard of?" — every unrecognised value falls to `default`
 * whether it is a kind we have not BUILT or a kind we have never HEARD OF.
 * Those are different situations with different honest messages to the user,
 * and telling them apart needs the list.
 *
 * ── BODY IS THE FALLBACK, FOR EVERY KIND ─────────────────────────────
 *
 * M9a keeps `body` NOT NULL and non-blank for every kind precisely so an
 * unrenderable message is still READABLE. A voice note writes 'Voice message';
 * an event card writes the event's name. So the fallback below renders `body`
 * rather than discarding it — the previous "Unsupported message type" branch
 * threw away text the schema guarantees is there and legible.
 */

/**
 * Every kind the database accepts, in the migration's order.
 *
 * Grouped by who authors them:
 *   the sender    text, voice, image, video, file, location
 *   a workflow    event, application, booking, approval
 *   the platform  system
 */
export const MESSAGE_KINDS = [
  'text', 'voice', 'image', 'video', 'file', 'location',
  'event', 'application', 'booking', 'approval',
  'system',
];

/** What the default is when a row predates `kind`, or a client omits it. */
export const DEFAULT_KIND = 'text';

/**
 * Human wording for a kind we know but cannot yet draw. Shown beside the
 * body fallback, so "Voice message" reads as a voice note we haven't built a
 * player for rather than as a bare line of text.
 */
export const KIND_LABELS = {
  text:        'Message',
  voice:       'Voice message',
  image:       'Photo',
  video:       'Video',
  file:        'Attachment',
  location:    'Location',
  event:       'Event',
  application: 'Application',
  booking:     'Booking',
  approval:    'Approval',
  system:      'System message',
};

const KNOWN = new Set(MESSAGE_KINDS);

/** Is this a kind this build has heard of at all? */
export function isKnownKind(kind) {
  return KNOWN.has(kind);
}

/**
 * Classify a message for rendering. Three outcomes, deliberately distinct:
 *
 *   'render'      we know it and we drew it — the renderer runs
 *   'unbuilt'     we know it, no renderer yet — body, labelled by kind
 *   'unknown'     a newer client wrote something we have never heard of —
 *                 body, and it is honest to suggest updating
 *
 * Collapsing the last two would tell a user on the CURRENT build to update
 * their app because we have not shipped voice notes. That is a lie the old
 * single fallback told.
 *
 * @param {string|undefined|null} rawKind  `message.kind`, possibly absent
 * @param {object} renderers               kind → component, from the caller
 */
export function classifyKind(rawKind, renderers = {}) {
  const kind = rawKind ?? DEFAULT_KIND;

  if (renderers[kind])  return { kind, status: 'render',  label: KIND_LABELS[kind] ?? null };
  if (isKnownKind(kind)) return { kind, status: 'unbuilt', label: KIND_LABELS[kind] ?? null };
  return { kind, status: 'unknown', label: null };
}
