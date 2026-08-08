/**
 * Wall-clock formatting shared by the thread and by message renderers.
 *
 * Extracted from `ConversationView` when the Voicey started drawing its own
 * timestamp. A renderer cannot import from the view that renders it —
 * ConversationView → messageKinds → VoiceMessage is already a chain, and
 * reaching back would close it into a cycle.
 *
 * Locale-aware by design: `toLocaleTimeString` decides 24h vs 12h from the
 * reader's own settings, so this is never hardcoded to one or the other.
 */
export const timeOf = iso =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
