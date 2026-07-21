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
 * Canonical kinds and their labels, re-exported so this file stays the one
 * import anything needs. They LIVE in `messageKindList.js` — plain data with
 * no JSX, so the data layer and `node --test` can reach them; both are shut
 * out of this file by the JSX in it.
 *
 * MUST stay in step with the CHECK in `20260721000000_m9a_message_kinds.sql`
 * — the database is the authority, this is the client's copy of the same list.
 */
export { KINDS, LABELS, isKind, isBareKind, BARE_KINDS, shapeFor, KIND_SHAPE, materialFor, KIND_MATERIAL } from './messageKindList';
import { KINDS, LABELS, handScale, HAND_SCALE_MIN } from './messageKindList';
import VoiceMessage from '../components/VoiceMessage';
import HandIcon from '../components/HandIcon';

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


/**
 * kind → renderer. text and voice are implemented; the rest resolve to the
 * fallback until they have one. Registered deliberately rather than left
 * absent, so this file is the complete picture of what exists and what does not.
 *
 * Voice was the first kind added after this registry existed, and it cost one
 * import and one line here. That was the entire point of building the registry
 * before the feature rather than during it.
 */
const RENDERERS = {
  text:  renderText,
  voice: message => <VoiceMessage message={message} />,
  // The Hand: YesPleez's universal acknowledgement. A BARE kind — see
  // BARE_KINDS — so MessageBubble draws no container around this and the mark
  // stands alone in the thread.
  hand:  message => <HandMessage message={message} />,
};

/**
 * A Hand, standing on its own in the thread.
 *
 * No bubble, no background, no label. The mark IS the message: an
 * acknowledgement is not someone SAYING "yes", it is someone GIVING a yes, and
 * a speech bubble around it turns the gesture into a picture of a gesture.
 * Messenger's standalone 👍 is the same idea with a borrowed symbol.
 *
 * The word 'Yes' still exists — in `body`, where the inbox preview, the push
 * notification and the screen reader read it. It is simply not drawn here,
 * because next to the mark it would be a caption explaining the obvious.
 *
 * Size comes from `payload.scale`, defaulting to 1. Press-and-hold sizing is
 * not built, but nothing here needs to change when it is.
 */
function HandMessage({ message }) {
  const scale = handScale(message?.payload?.scale ?? HAND_SCALE_MIN);

  return (
    <span
      // Presentational, so the accessible name comes from `body` via the
      // thread rather than from the mark. Without this a screen reader would
      // announce nothing at all — the mark carries no text.
      role="img"
      aria-label="Yes"
      style={{ display: 'inline-flex', color: 'var(--text)' }}
    >
      <HandIcon size={HAND_BASE_PX * scale} />
    </span>
  );
}

/**
 * The default drawn size of an acknowledgement.
 *
 * Deliberately large — several times an icon. It is standing in open space
 * with no bubble to give it presence, and at bubble-text size it would read as
 * a stray glyph someone left behind rather than as a deliberate gesture.
 */
const HAND_BASE_PX = 58;

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
