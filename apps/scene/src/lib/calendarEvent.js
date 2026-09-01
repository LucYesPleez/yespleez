/**
 * THE CALENDAR PROJECTION MODULE — every YesPleez record that can become an
 * RFC 5545 iCalendar event becomes one HERE, and only here.
 *
 * ⭐ ONE GENERATOR, TWO CONSUMERS. The one-off ADD TO CALENDAR download
 * (SchedulePortrait → SlotCard) and the account-level subscription feed
 * (functions/calendar/feed.js via lib/calendarFeed.js) both compose the same
 * projections and the same VEVENT builder. ⛔ Never a second .ics
 * implementation anywhere — a feed that disagrees with the download about
 * when a set is would be the two-answers defect in its worst clothing.
 *
 * ── THE IDENTITY RULE ────────────────────────────────────────────────
 * Every projection's UID is derived from the canonical record id and NOTHING
 * else:
 *
 *     yespleez-slot-{slot_uuid}@yespleez.com        a set (unchanged from
 *                                                   the original milestone)
 *     yespleez-gig-{event_id}@yespleez.com          an event I'm performing at
 *     yespleez-event-{event_id}@yespleez.com        an event I'm attending
 *     yespleez-booking-{enquiry_id}@yespleez.com    a booked night (enquiry)
 *     yespleez-deadline-{enquiry_id}@yespleez.com   a respond-by deadline
 *
 * ⛔⛔ A UID NEVER CHANGES for the life of its record — not when the time
 * moves, the venue changes, or the event is renamed. A stable UID is what
 * lets a calendar client treat a later version as an UPDATE. DTSTAMP (the
 * generation instant) and SEQUENCE mark the newer version; in a SUBSCRIBED
 * calendar, removal is expressed by the item simply no longer appearing.
 *
 * ── THE TIMEZONE RULE ────────────────────────────────────────────────
 * Events carry no timezone (S2 defers it — see lib/scheduleNow.js); slot
 * times are the venue's wall clock. So timed DTSTART/DTEND are FLOATING
 * local date-times (no `Z`, no TZID) and whole-day items are VALUE=DATE.
 * ⛔⛔ NEVER convert to UTC here — that would bake the generating machine's
 * offset into the file, wrong for a Perth reader of a Melbourne gig and
 * wrong again across an Australian daylight-saving transition.
 *
 * ── THE DATA SOURCE ──────────────────────────────────────────────────
 * Everything is read from the canonical chain — `resolveSchedule`'s
 * day/entry objects, `buildVenue` for the venue with its `withheld` decision
 * intact, `addressLines` for the address so locality/state are never printed
 * twice, and `readDate`/`readEndDate` for the config's date spellings.
 * ⛔ Nothing here re-derives a date, a time or a venue for itself.
 */

import { axisOffsets, dayMidnight } from './scheduleNow';
import { timeKey } from './schedulePortrait';
import { buildVenue, readDate, readEndDate } from '../screens/event/eventViewModel';
import { addressLines } from '../screens/event/venueDisplay';
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

/**
 * `YYYY-MM-DD` (+ optional day offset) → iCalendar DATE (`YYYYMMDD`), for
 * whole-day items. Same noon-anchored roll as icsWallDateTime, same reason.
 */
export function icsDate(dateStr, addDays = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr ?? '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + addDays, 12);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
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

/**
 * The stable, deterministic UID for any projected record.
 * ⛔ Never random, never versioned, never derived from mutable fields.
 */
export function icsUid(kind, id) {
  return `yespleez-${kind}-${id}@yespleez.com`;
}

/** The original set UID — the ratified shape, kept verbatim. */
export function slotUid(slotUuid) {
  return icsUid('slot', slotUuid);
}

/**
 * SEQUENCE from a record's `updated_at`: whole minutes since 2026-01-01 UTC,
 * clamped at 0. Monotonic per record because updated_at is, which is all RFC
 * 5546 asks of it. Subscribed calendars mostly replace on refresh, so this
 * is belt-and-braces rather than load-bearing; 0 when nothing is known.
 */
export function sequenceFrom(updatedAt) {
  const t = Date.parse(updatedAt ?? '');
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((t - Date.UTC(2026, 0, 1)) / 60000));
}

/**
 * The one LOCATION builder — venue name + street + region.
 *
 * ⚠⚠ THE ADDRESS FIELD OFTEN ALREADY CONTAINS THE SUBURB. Bellingen Memorial
 * Hall's `location` is "32 Hyde St, Bellingen, NSW, 2454", and appending
 * locality/state after it printed "…, 2454, Bellingen, NSW" — the duplication
 * the first release shipped. `addressLines` is the canonical splitter the
 * venue section already uses; ⛔ never join the raw fields directly.
 *
 * ⚠ `withheld` is checked by every CALLER via buildVenue before this runs —
 * a secret location never reaches a LOCATION property at all.
 */
export function venueLocation(venue) {
  if (!venue || venue.withheld) return null;
  const { street, region } = addressLines({
    address: venue.address, locality: venue.locality,
    state: venue.state, postcode: venue.postcode,
  });
  return [venue.name, street, region].filter(Boolean).join(', ') || null;
}

/**
 * ⭐ THE GATE: is this entry a confirmed set worth a calendar event?
 *
 * `claim.status === 'confirmed'` is the SAME state that lets the public card
 * name the act (toClaim's translation: the artist accepted, or the organiser
 * hand-entered an act with no account to ask). The download button lives on
 * that card and exports exactly what the card shows, so it reads the same
 * value — a draft reads as open, an offered set as PENDING, a declined one
 * as unfilled, and none of those may reach a calendar. ⚠ This is an export
 * of pixels, not a decision about the booking; nothing here notifies,
 * writes, or books.
 */
function isConfirmedEntry(entry) {
  return entry?.claim?.status === 'confirmed';
}

/**
 * One resolved schedule entry → the calendar event's data, or null.
 *
 * Null is a REAL answer and the button's absence: not confirmed, no slot
 * uuid, or a set that cannot be placed on a clock (an unreadable date or a
 * time with no meridiem). Per the Rendering Contract an unplaceable set gets
 * NO calendar item, ⛔ never a file with a guessed time.
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
  const location = venueLocation(venue);

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
       null here and the builder omits DTEND rather than inventing an hour.
       ⛔ Do not default to 60: `toRenderSlot` already decided that question
       upstream, and deciding it twice is how two answers diverge. */
    dtend: dur > 0 ? icsWallDateTime(day.date, offset + dur) : null,
    location,
    description,
    url,
    sequence: sequenceFrom(entry.claim?.performance?.updated_at),
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
 * An EVENT as a whole-day calendar item — "I'm performing at this" or "I'm
 * going to this". Whole-day because the event's own start clock is the
 * schedule's business; the set projection above carries the precise times.
 *
 * @param kind 'gig' (on the bill) or 'event' (attending) — two UIDs, so a
 *   person who stops performing but keeps attending gets a clean handover
 *   rather than one item silently changing meaning.
 */
export function eventCalendarEvent({ event, venueProfile = null, kind = 'event' } = {}) {
  if (!event?.id) return null;
  const cfg = event.config || {};
  const date = readDate(cfg);
  const dtstart = icsDate(date);
  if (!dtstart) return null;
  /* ⚠ A BACKWARDS endDate is ignored, not obeyed — same rule as eventDays:
     honouring it would produce a negative-length event. String compare is
     safe on YYYY-MM-DD. DTEND is EXCLUSIVE per the RFC, hence +1 day. */
  const endDate = readEndDate(cfg);
  const lastDay = endDate && endDate >= date ? endDate : date;
  const venue = buildVenue({ event, cfg, venueProfile });
  const url = `${PUBLIC_ORIGIN}/#/event/${event.id}`;
  const performing = kind === 'gig';
  return {
    uid: icsUid(performing ? 'gig' : 'event', event.id),
    summary: performing && event.name ? `${event.name} (performing)` : event.name || 'YesPleez event',
    allDay: true,
    dtstart,
    dtend: icsDate(lastDay, 1),
    location: venueLocation(venue),
    description: [
      performing ? 'You are on the bill.' : null,
      venue.withheld ? 'Location: announced closer to the event' : null,
      url,
    ].filter(Boolean).join('\n'),
    url,
    sequence: sequenceFrom(event.updated_at),
  };
}

/**
 * An accepted venue enquiry as a booked night.
 *
 * ⛔⛔ THE PRIVATE HALF OF THE ROW NEVER REACHES THE CALENDAR. A
 * `venue_enquiries` row carries `note` and `proposed_fee` — negotiation
 * material. This projection reads id, the date, the proposed time and
 * length, and the venue's public name/region, and NOTHING else. ⛔ Never
 * spread the row into the output.
 */
export function enquiryBookingEvent({ enquiry, venue = null } = {}) {
  const date = enquiry?.date_requested || enquiry?.preferred_date || null;
  if (enquiry?.id == null || !date) return null;
  const venueName = venue?.name || null;
  const region = [venue?.suburb, venue?.state].filter(Boolean).join(', ');
  const url = `${PUBLIC_ORIGIN}/#/industry/artist?section=enquiries&tab=BOOKED`;

  /* Timed when the row says so: `proposed_time` is a Postgres TIME
     ("19:30:00"), `set_duration` minutes. Both optional; absent means a
     whole-day item, ⛔ never a guessed hour. */
  const t = /^(\d{1,2}):(\d{2})/.exec(String(enquiry.proposed_time ?? ''));
  const mins = t ? Number(t[1]) * 60 + Number(t[2]) : null;
  const durMins = Number(enquiry.set_duration);
  const timed = mins != null && icsWallDateTime(date, mins);

  return {
    uid: icsUid('booking', enquiry.id),
    summary: venueName ? `Gig at ${venueName}` : 'YesPleez booking',
    ...(timed
      ? {
          dtstart: timed,
          dtend: Number.isFinite(durMins) && durMins > 0 ? icsWallDateTime(date, mins + durMins) : null,
        }
      : { allDay: true, dtstart: icsDate(date), dtend: icsDate(date, 1) }),
    location: [venueName, region].filter(Boolean).join(', ') || null,
    description: ['Confirmed booking on YesPleez.', url].join('\n'),
    url,
    sequence: sequenceFrom(enquiry.updated_at || enquiry.created_at),
  };
}

/**
 * A genuine respond-by deadline — `venue_enquiries.respond_by` is the ONE
 * canonical date-to-answer-by in the schema. "New enquiry received" is a
 * notification, ⛔ never a calendar item; the deadline the venue actually
 * set is.
 */
export function enquiryDeadlineEvent({ enquiry, venue = null } = {}) {
  if (enquiry?.id == null || !enquiry?.respond_by) return null;
  const dtstart = icsDate(enquiry.respond_by);
  if (!dtstart) return null;
  const venueName = venue?.name || null;
  const url = `${PUBLIC_ORIGIN}/#/industry/artist?section=enquiries`;
  return {
    uid: icsUid('deadline', enquiry.id),
    summary: venueName ? `Respond to ${venueName} enquiry` : 'Respond to YesPleez enquiry',
    allDay: true,
    dtstart,
    dtend: icsDate(enquiry.respond_by, 1),
    location: null,
    description: ['Booking enquiry awaiting your answer on YesPleez.', url].join('\n'),
    url,
    sequence: sequenceFrom(enquiry.updated_at || enquiry.created_at),
  };
}

/* ── the iCalendar text itself ───────────────────────────────────────── */

/** One VEVENT as unfolded content lines. */
function veventLines(ev, { now, sequence, cancelled }) {
  const seq = Number.isFinite(sequence) ? sequence
    : Number.isFinite(ev.sequence) ? ev.sequence : 0;
  const dateValue = ev.allDay ? ';VALUE=DATE' : '';
  return [
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(ev.uid)}`,
    `DTSTAMP:${icsUtcDateTime(now)}`,
    `SEQUENCE:${seq}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    `DTSTART${dateValue}:${ev.dtstart}`,
    ...(ev.dtend && ev.dtend !== ev.dtstart ? [`DTEND${dateValue}:${ev.dtend}`] : []),
    `SUMMARY:${escapeIcsText(ev.summary)}`,
    ...(ev.location ? [`LOCATION:${escapeIcsText(ev.location)}`] : []),
    ...(ev.description ? [`DESCRIPTION:${escapeIcsText(ev.description)}`] : []),
    ...(ev.url ? [`URL:${ev.url}`] : []),
    'END:VEVENT',
  ];
}

const finish = lines => lines.map(foldIcsLine).join('\r\n') + '\r\n';

/**
 * ONE calendar event → a complete VCALENDAR string — the one-off download.
 *
 * @param opts.now       the generation instant (a Date) — becomes DTSTAMP.
 *                       Passed in so tests are deterministic.
 * @param opts.sequence  overrides the projection's own sequence.
 * @param opts.cancelled the product never auto-removes anything from a
 *                       downloaded calendar; this exists so it CAN later
 *                       hand out a cancellation (METHOD:CANCEL,
 *                       STATUS:CANCELLED) for the same UID.
 */
export function buildIcs(ev, { now = new Date(), sequence, cancelled = false } = {}) {
  if (!ev?.uid || !ev.dtstart) return null;
  return finish([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//YesPleez//Scene//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`,
    ...veventLines(ev, { now, sequence: sequence ?? 0, cancelled }),
    'END:VCALENDAR',
  ]);
}

/**
 * MANY calendar events → one subscribable VCALENDAR — the feed's payload.
 *
 * ⚠ SUBSCRIPTION SEMANTICS: clients replace the calendar with what the feed
 * serves, so a cancelled or removed record is expressed by NOT being in this
 * list. An event may still carry `cancelled: true` to ship an explicit
 * CANCELLED tombstone when the product wants one shown rather than removed.
 */
export function buildCalendar(events = [], { now = new Date(), name = 'YesPleez' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//YesPleez//Scene//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(name)}`,
    'X-WR-CALDESC:Your YesPleez gigs and commitments',
  ];
  for (const ev of events) {
    if (!ev?.uid || !ev.dtstart) continue;
    lines.push(...veventLines(ev, { now, cancelled: !!ev.cancelled }));
  }
  lines.push('END:VCALENDAR');
  return finish(lines);
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
 * automatically — the standard file is the whole contract. Persistent sync
 * is the SUBSCRIPTION's job (lib/calendarFeed.js), not this button's.
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
