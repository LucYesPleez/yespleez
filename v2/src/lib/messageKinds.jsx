/**
 * THE MESSAGE KIND REGISTRY.
 *
 * One place that says what a message can be and how each kind renders.
 * `MessageBubble` resolves a renderer from here and knows nothing else about
 * kinds — so adding Voiceys, an event card or a booking offer is a renderer
 * plus an entry, never a change to the thread, the dock, the inbox or the
 * bubble itself.
 *
 * Doing this BEFORE Voiceys is the point. Built during Voiceys, the seams
 * would be shaped around voice specifically and every later kind would fight
 * them.
 *
 * ── THE CONTRACT EVERY KIND HONOURS ──────────────────────────────────
 *
 *   kind      a value from KINDS, matching the DB CHECK (M9a)
 *   body      ALWAYS legible text. For non-text kinds this is the fallback
 *             an older client, a notification preview and a screen reader
 *             use. A kind that cannot describe itself in text breaks those
 *             three surfaces silently.
 *   payload   kind-specific structure, owned by the renderer.
 *
 * ── UNKNOWN KINDS ARE A NORMAL CASE, NOT AN ERROR ────────────────────
 *
 * A newer client can write a kind this build has never heard of. That must
 * render as something honest rather than an empty bubble — which is why
 * `body` is required and why the fallback renders it.
 */

/**
 * Canonical kinds. MUST stay in step with the CHECK in
 * `20260721000000_m9a_message_kinds.sql` — the database is the authority, this
 * is the client's copy of the same list.
 */
export const KINDS = [
  // Authored by the sender
  'text', 'voice', 'image', 'video', 'file', 'location',
  // Authored by a workflow act
  'event', 'application', 'booking', 'approval',
  // Authored by the platform, via a system profile (C29)
  'system',
];

/** Text is the only kind with a renderer today. Everything else falls back. */
function renderText(message) {
  return (
    <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {message.body}
    </div>
  );
}

/**
 * Used for a KNOWN kind with no renderer yet, and for an UNKNOWN kind from a
 * newer client. Both render `body`, because that is exactly what body is for.
 *
 * The label is what stops it looking broken: "Voice message" alone reads like
 * a bug, "🎤 Voice message" plus a note that this build cannot play it reads
 * like a version gap, which is the truth.
 */
function renderFallback(message, kind) {
  const known = KINDS.includes(kind);
  return (
    <div>
      <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {message.body}
      </div>
      <div style={{ marginTop: 4, fontSize: 11, color: 'rgba(255,255,255,.38)', fontStyle: 'italic' }}>
        {known
          ? `${LABELS[kind] ?? kind} — not supported in this version yet`
          : 'Unsupported message type — update the app to view this'}
      </div>
    </div>
  );
}

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

/**
 * kind → renderer. Only text is implemented; the rest resolve to the fallback
 * until they have one. Registered deliberately rather than left absent, so
 * this file is the complete picture of what exists and what does not.
 */
const RENDERERS = {
  text: renderText,
};

/**
 * Resolve a renderer for a message.
 *
 * Never throws and never returns null — a thread must render whatever it is
 * given. An unrenderable message is still a message the participant sent.
 */
export function renderMessage(message) {
  // ?? 'text' is now a REAL fallback for exactly one case: a client that has
  // not refetched since M9a. Since M9a's column is NOT NULL with a default,
  // every row in the database has a kind — so an undefined one reaching here
  // means the SELECT did not ask for it, which is invisible on screen because
  // it renders as text and looks perfectly correct.
  //
  // That is precisely how the dispatch stayed fiction: it never failed, it
  // just never routed. So say something rather than degrade silently.
  if (import.meta.env?.DEV && message && message.kind === undefined) {
    console.warn(
      '[messageKinds] message %s arrived with no `kind`. Every row has one since M9a, ' +
      'so the read path dropped it — check MESSAGE_COLUMNS in lib/messaging.js. ' +
      'This renders as text and will look correct.',
      message.id ?? '(no id)',
    );
  }

  const kind = message?.kind ?? 'text';
  const renderer = RENDERERS[kind];
  return renderer ? renderer(message) : renderFallback(message, kind);
}

/** True when this build can render the kind properly, rather than falling back. */
export function isRenderable(kind) {
  return Boolean(RENDERERS[kind ?? 'text']);
}
