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
  'text', 'voice', 'image', 'video', 'file', 'location',
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
