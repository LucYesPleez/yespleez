/**
 * ADD TO CALENDAR — a confirmed set as a standard RFC 5545 .ics event.
 *
 * ⭐ THIS IS NOT A CALENDAR SYSTEM. One confirmed YesPleez set becomes one
 * standard iCalendar event the device's own calendar app can import. ⛔ No
 * Google/Apple/Microsoft calendar APIs, no OAuth, no sync, no server side.
 *
 * ── THE IDENTITY RULE ────────────────────────────────────────────────
 * The UID is derived from the canonical slot uuid (`event_slots.id`, the same
 * `slot_uuid` that keys performances, claims and notifications) and NOTHING
 * else:
 *
 *     yespleez-slot-{slot_uuid}@yespleez.com
 *
 * ⛔⛔ THE UID NEVER CHANGES for the life of the slot — not when the start
 * time moves, not when the venue changes, not when the event is renamed.
 * A stable UID is what lets a calendar app treat a re-imported file as an
 * UPDATE to the event it already holds rather than a second unrelated one.
 * DTSTAMP (the generation instant) and SEQUENCE are what mark a newer
 * version of the same UID.
 *
 * ── THE TIMEZONE RULE ────────────────────────────────────────────────
 * Events carry no timezone (S2 defers it — see lib/scheduleNow.js); slot
 * times are the venue's wall clock. So DTSTART/DTEND are emitted as FLOATING
 * local date-times (no `Z`, no TZID): the calendar shows 9:00 PM as 9:00 PM,
 * which is the only claim the data actually makes.
 * ⛔⛔ NEVER convert to UTC here — that would bake the EXPORTING device's
 * offset into the file, which is wrong for a Perth reader of a Melbourne
 * gig and wrong again across an Australian daylight-saving transition.
 * Floating time also makes DST a non-event: the wall clock is preserved by
 * construction on either side of a transition. DTSTAMP alone is UTC, as the
 * RFC requires for it.
 *
 * ── THE DATA SOURCE ──────────────────────────────────────────────────
 * Everything is read from the canonical chain — `resolveSchedule`'s day/entry
 * objects (event_slots + performances via toClaim), `slotWindow` for the
 * concrete instant (the same rollover-aware derivation the live schedule
 * uses), and `buildVenue` for the venue with its `withheld` decision intact.
 * ⛔ Nothing here re-derives a date, a time or a venue for itself.
 */

import { axisOffsets, dayMidnight } from './scheduleNow';
import { timeKey } from './schedulePortrait';
import { buildVenue } from '../screens/event/eventViewModel';
import { PUBLIC_ORIGIN } from './qrDestinations';

/** Two-digit pad. */
const p2 = n => String(n).padStart(2, '0');

/**
 * A day's date + minutes past its midnight → floating iCalendar DATE-TIME.
 *
 * ⚠⚠ CALENDAR ARITHMETIC, ⛔ NEVER EPOCH ARITHMETIC. `slotWindow`'s epoch
 * values measure ELAPSED time, which is what "is it playing now" needs — but
 * on a DST transition day elapsed and wall time disagree: Sydney's midnight
 * on 2026-10-04 is AEST and its 9:00 PM is AEDT, so midnight + 21h of epoch
 * reads back as 10:00 PM through the local getters. A calendar entry states
 * the WALL clock, so it is built from the day's date and the minute offset
 * directly, and the DST test exists because the epoch route shipped first
 * and failed it.
 *
 * ⚠ `minutes` may exceed 24h — the rollover walk puts a 1:00 AM closer at
 * 25h — and the date rolls forward by calendar days. Anchored at NOON for the
 * roll so a zone whose midnight does not exist cannot skew the date parts.
 */
export function icsWallDateTime(dateStr, minutes) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr ?? '').trim());
  if (!m || !Number.isFinite(minutes) || minutes < 0) return null;
  const dayAdd = Math.floor(minutes / 1440);
  const mins = minutes - dayAdd * 1440;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dayAdd, 12);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}` +
    `T${p2(Math.floor(mins / 60))}${p2(mins % 60)}00`;
}

/** A Date → UTC iCalendar DATE-TIME with `Z` — for DTSTAMP only. */
export function icsUtcDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}` +
    `T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
}

/**
 * RFC 5545 §3.3.11 TEXT escaping: backslash first (or it re-escapes the
 * escapes), then semicolon, comma, and any line break as a literal `\n`.
 */
export function escapeIcsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 §3.1 line folding: a content line longer than 75 OCTETS is split
 * with CRLF followed by a single space. Counted in UTF-8 bytes, ⛔ not code
 * units — an emoji in an act name must not push a line past the limit.
 */
export function foldIcsLine(line) {
  const bytes = ch => (ch.codePointAt(0) <= 0x7f ? 1 : ch.codePointAt(0) <= 0x7ff ? 2 : ch.codePointAt(0) <= 0xffff ? 3 : 4);
  const out = [];
  let cur = '', len = 0, budget = 75;
  for (const ch of line) {
    const b = bytes(ch);
    if (len + b > budget) {
      out.push(cur);
      cur = ' ';
      len = 1;
      budget = 75;
    }
    cur += ch;
    len += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

/** The stable, deterministic UID for a slot. ⛔ Never random, never versioned. */
export function slotUid(slotUuid) {
  return `yespleez-slot-${slotUuid}@yespleez.com`;
}

/**
 * ⭐ THE GATE: is this entry a confirmed set worth a calendar event?
 *
 * `claim.status === 'confirmed'` is the SAME state that lets the public card
 * name the act (toClaim's translation: the artist accepted, or the organiser
 * hand-entered an act with no account to ask). This button lives on that card
 * and exports exactly what the card shows, so it reads the same value — a
 * draft reads as open, an offered set as PENDING, a declined one as unfilled,
 * and none of those may reach a calendar. ⚠ This is an export of pixels, not
 * a decision about the booking; nothing here notifies, writes, or books.
 */
function isConfirmedEntry(entry) {
  return entry?.claim?.status === 'confirmed';
}

/**
 * One resolved schedule entry → the calendar event's data, or null.
 *
 * Null is a REAL answer and the button's absence: not confirmed, no slot
 * uuid, or a set that cannot be placed on a clock (`slotWindow` null — an
 * unreadable date or a time with no meridiem). Per the Rendering Contract an
 * unplaceable set gets NO control, ⛔ never a file with a guessed time.
 *
 * @param event        the events row (id, name, config)
 * @param venueProfile the linked venue profile row, or null
 * @param day          a day from `resolveSchedule` (carries `date` + stages)
 * @param entry        `{ slot, claim }` from that day's stage slots
 */
export function slotCalendarEvent({ event, venueProfile = null, day, entry } = {}) {
  if (!event?.id || !entry?.slot?.id) return null;
  if (!isConfirmedEntry(entry)) return null;
  /* The SAME primitives the live schedule reads — the day's own date and the
     per-stage rollover walk — so this cannot disagree with the page about
     when a set is. ⛔ Not `slotWindow`: its epoch values are elapsed time,
     and the wall clock diverges from them across a DST transition (see
     icsWallDateTime). Null anywhere = unplaceable = no calendar event. */
  const base = dayMidnight(day?.date);
  if (!base) return null;
  const offset = axisOffsets(day).get(timeKey(entry.slot));
  if (offset == null) return null;
  const rawDur = Number(entry.slot?.dur);
  const dur = Number.isFinite(rawDur) && rawDur > 0 ? rawDur : 0;
  const dtstart = icsWallDateTime(day.date, offset);
  if (!dtstart) return null;

  const venue = buildVenue({ event, cfg: event.config || {}, venueProfile });
  /* ⚠ `withheld` SURVIVES INTO THE FILE: a secret location exports no
     LOCATION at all. A calendar entry outlives the reveal, so leaking the
     address here would undo the organiser's decision permanently. */
  const location = venue.withheld ? null
    : [venue.name, venue.address, venue.locality, venue.state]
        .filter(Boolean).join(', ') || null;

  /* The PRINTED origin, not window.location — a calendar entry is read months
     later from anywhere, the same reasoning as the QR destinations. */
  const url = `${PUBLIC_ORIGIN}/#/event/${event.id}`;

  const act = entry.claim?.name || null;
  const summary = act && event.name ? `${act} at ${event.name}`
    : act || event.name || 'YesPleez set';

  const description = [
    act ? `Set: ${act}` : null,
    event.name ? `Event: ${event.name}` : null,
    venue.withheld ? 'Location: announced closer to the event' : null,
    url,
  ].filter(Boolean).join('\n');

  return {
    uid: slotUid(entry.slot.id),
    summary,
    dtstart,
    /* ⚠ A slot with no readable duration has a start and nothing more —
       null here and buildIcs omits DTEND rather than inventing an hour.
       ⛔ Do not default to 60: `toRenderSlot` already decided that question
       upstream, and deciding it twice is how two answers diverge. */
    dtend: dur > 0 ? icsWallDateTime(day.date, offset + dur) : null,
    location,
    description,
    url,
  };
}

/**
 * The whole resolved schedule → `{ [slot.id]: calendarEvent }` for every
 * confirmed, placeable set. The projection components look their slot up here
 * rather than each re-asking the questions above.
 */
export function calendarEventsBySlot(resolved, { event, venueProfile = null } = {}) {
  const out = {};
  for (const day of resolved?.days || []) {
    for (const stage of day?.stages || []) {
      for (const entry of stage?.slots || []) {
        const cal = slotCalendarEvent({ event, venueProfile, day, entry });
        if (cal) out[entry.slot.id] = cal;
      }
    }
  }
  return out;
}

/**
 * The calendar event → a complete RFC 5545 VCALENDAR string, CRLF line
 * endings, folded content lines.
 *
 * @param opts.now       the generation instant (a Date) — becomes DTSTAMP.
 *                       Passed in so tests are deterministic.
 * @param opts.sequence  RFC SEQUENCE. Defaults to 0; a caller that knows a
 *                       set time changed may pass a higher number. Between
 *                       equal SEQUENCEs, calendar apps fall back to the newer
 *                       DTSTAMP — which regeneration always refreshes.
 * @param opts.cancelled V1 never auto-removes anything from anyone's
 *                       calendar; this exists so the product CAN later hand
 *                       out a cancellation (METHOD:CANCEL, STATUS:CANCELLED)
 *                       for the same UID.
 */
export function buildIcs(ev, { now = new Date(), sequence = 0, cancelled = false } = {}) {
  if (!ev?.uid || !ev.dtstart) return null;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//YesPleez//Scene//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(ev.uid)}`,
    `DTSTAMP:${icsUtcDateTime(now)}`,
    `SEQUENCE:${Number.isFinite(sequence) ? sequence : 0}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    `DTSTART:${ev.dtstart}`,
    ...(ev.dtend && ev.dtend !== ev.dtstart ? [`DTEND:${ev.dtend}`] : []),
    `SUMMARY:${escapeIcsText(ev.summary)}`,
    ...(ev.location ? [`LOCATION:${escapeIcsText(ev.location)}`] : []),
    ...(ev.description ? [`DESCRIPTION:${escapeIcsText(ev.description)}`] : []),
    ...(ev.url ? [`URL:${ev.url}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/** `Karioke Kev at Solstice` → `yespleez-set-karioke-kev-at-solstice.ics`. */
export function icsFilename(title) {
  const slug = String(title || 'set')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'set';
  return `yespleez-set-${slug}.ics`;
}

/**
 * Hand the .ics to the browser/device — the same one-download-path object-URL
 * pattern as lib/qr/qrExport, so the blob is always revoked.
 *
 * ⚠ This HANDS the file to the device; what happens next is the platform's.
 * Desktop browsers download it, Android offers the calendar app, iOS Safari
 * opens its calendar preview. ⛔ No claim is made that an iOS PWA imports it
 * automatically — the standard file is the whole contract.
 */
export function downloadCalendarEvent(cal, opts = {}) {
  const ics = buildIcs(cal, opts);
  if (!ics) return false;
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = icsFilename(cal.summary);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return true;
}
