import { formatDateRange } from './dates';

/**
 * AN EVENT SHARED INTO A CONVERSATION — the `event` message kind.
 *
 * ⭐ THE KIND ALREADY EXISTED. `messages_kind_valid` has permitted `'event'`
 * since the baseline, described there as "authored by a workflow act". Sharing
 * is the first thing to author one, so this needs NO migration — the column
 * was waiting.
 *
 * ── ⭐ A REFERENCE, PLUS A SNAPSHOT THAT IS ONLY A FALLBACK ───────────
 *
 * The payload carries `eventId` and a copy of how the event read when it was
 * sent. Those two do different jobs and must not be confused:
 *
 *   eventId    the truth. The card links here; the event page is live.
 *   snapshot   what to draw when the live event cannot be read.
 *
 * ⚠ THIS IS THE OPPOSITE CHOICE TO A SHARED RIDER, DELIBERATELY. An asset is
 * pinned to the version that was sent, because someone acted on that document
 * and it must not change under them. An event is the reverse: a moved door
 * time that still showed the old one in the chat would send somebody to the
 * wrong place. So the card prefers the LIVE event and falls back to the
 * snapshot — and when it does fall back, it says so rather than presenting
 * stale detail as current.
 *
 * ── ⚠ THE SNAPSHOT IS NOT A LEAK ─────────────────────────────────────
 *
 * `C32` — conversation content never leaves the conversation. This is the
 * other direction: public event detail entering a conversation, copied by a
 * participant who could already see it. Nothing about the conversation is
 * written back to the event.
 *
 * ⛔ Never put anything in here that the RECIPIENT could not otherwise read.
 * The snapshot is rendered without any permission check — that is its whole
 * purpose — so a private field copied in would be visible to someone the event
 * itself would have refused.
 */

/**
 * ⚠⚠ BUILT FROM THE VIEW MODEL, NEVER FROM THE EVENT ROW. Two hard reasons,
 * and the first one is a privacy bug I actually shipped for ten minutes:
 *
 * 1. ⛔ THE VENUE CAN BE WITHHELD. `eventViewModel` returns `where.venue` as
 *    NULL when the event hides it, and the page honours that. Reading
 *    `event.venue_profile_id`'s name directly would have put the venue of a
 *    location-withheld event into a chat message — past the very check the
 *    event page performs. The card skips permission checks by design (that is
 *    what makes it render when the event cannot be loaded), so it must consume
 *    a value that has ALREADY been through them.
 *
 * 2. There is no date column. `events` stores date, time and venue inside
 *    `config` jsonb, and the app's standing rule is that NOTHING outside
 *    `eventViewModel.js` reads `event.config`. A card that parsed it would be
 *    a second interpreter of the same jsonb, free to disagree with the page.
 *
 * @param eventId the row id — the only thing taken from the event itself
 * @param v       the view model, as `EventPage` already computed it
 */
export function eventCardBody(v) {
  const name = v?.name?.trim() || 'Event';
  const when = cardWhen(v);
  return when ? `${name} — ${when}` : name;
}

/**
 * The stored payload.
 *
 * ⭐ Deliberately small. Every field here is one that can go stale, so the card
 * carries the least that still renders something recognisable when the live
 * event is gone: what it was called, when it was, and where.
 */
export function eventCardPayload(eventId, v) {
  if (!eventId) return null;
  return {
    eventId,
    snapshot: {
      name:  v?.name || null,
      when:  cardWhen(v) || null,
      // Already withheld-aware — see the note above. NULL here means either
      // "no venue" or "deliberately not shown", and the card cannot tell the
      // difference, which is correct: both render nothing.
      venue: v?.identity?.where?.venue || null,
      // The cover, else the poster. Whichever the hero settled on is the image
      // that represents this event everywhere else.
      cover: v?.hero?.cover?.url || v?.hero?.poster?.url || null,
    },
  };
}

/**
 * "15 Aug 2026 · 8:00pm" — assembled from the view model's own parts.
 *
 * ⚠⚠ `formatDateRange` IS THE APP'S DATE FORMATTER, AND USING IT IS THE POINT.
 * The stored value is `2026-08-15`, and the first version of this card put
 * that raw ISO string into the conversation — three centimetres from an event
 * page reading "15 Aug 2026". It looked like a deliberate format until the two
 * were seen together.
 *
 * ⛔ Never hand-roll a date here. `lib/dates` splits the string by hand instead
 * of calling `new Date(str)` precisely because `new Date('2026-08-15')` parses
 * as UTC and lands on the 14th in some timezones — a bug that appears only for
 * the people it hurts.
 */
export function cardWhen(v) {
  const when = v?.identity?.when;
  if (!when) return '';
  const date = typeof when.date === 'string' ? formatDateRange(when.date, when.endDate) : '';
  const time = typeof when.startTime === 'string' ? when.startTime.trim() : '';
  if (date && time) return `${date} · ${time}`;
  return date || '';
}

/**
 * Read a stored card back.
 *
 * ⚠ TOLERANT ON PURPOSE. `payload` is jsonb with no per-kind CHECK (the
 * architecture's §3 decision), so a malformed one is a live possibility rather
 * than a theoretical one — and a renderer that throws takes the whole
 * conversation down with it, not just one bubble.
 */
export function readEventCard(message) {
  const p = message?.payload;
  if (!p || typeof p !== 'object') return null;
  const eventId = typeof p.eventId === 'string' ? p.eventId : null;
  if (!eventId) return null;
  const snap = p.snapshot && typeof p.snapshot === 'object' ? p.snapshot : {};
  const str = value => (typeof value === 'string' && value.trim() ? value : null);
  return {
    eventId,
    name:  str(snap.name),
    // Already formatted by `cardWhen` when it was sent. The renderer prints it
    // verbatim — see the note there about not re-parsing a typed date.
    when:  str(snap.when),
    venue: str(snap.venue),
    cover: str(snap.cover),
  };
}

/*
 * ⛔ THERE IS NO DATE FORMATTER HERE, DELIBERATELY.
 *
 * The first version had one: it parsed `event.start_at` into "Sat 15 Aug ·
 * 8:00 pm". `events` has no `start_at` — the date is a STRING inside `config`,
 * typed by the host — so every card it produced carried no date at all, and
 * the omission looked like the rendering contract working correctly rather
 * than like a bug. It shipped that way until the card was seen in a real
 * conversation.
 *
 * Formatting belongs to `eventViewModel`, which is the one interpreter of that
 * jsonb. `cardWhen` above assembles the view model's already-decided parts and
 * reformats nothing.
 */
