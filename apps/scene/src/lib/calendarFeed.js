/**
 * THE FEED CORE — one authenticated user's YesPleez commitments as ONE
 * subscribable iCalendar.
 *
 * ── THE SHAPE OF THE SYSTEM ──────────────────────────────────────────
 *
 *     canonical rows (RPC calendar_feed_payload, token-scoped)
 *         ↓ this file
 *     calendar projections (lib/calendarEvent — the ONE projection module)
 *         ↓
 *     VCALENDAR text (buildCalendar — the ONE generator)
 *
 * ⛔ This file holds NO iCalendar knowledge and NO second schedule model: it
 * feeds the raw rows through `resolveSchedule` + `indexPerformances` exactly
 * as `useEventData` does, so the feed can never disagree with the app about
 * when a set is.
 *
 * ⚠ PURE AND PORTABLE. Runs in the browser test runner (node:test) and in
 * the Cloudflare Pages Function (functions/calendar/feed.js). ⛔ No supabase
 * client, no React, no DOM.
 *
 * ── UPDATE / REMOVAL SEMANTICS ───────────────────────────────────────
 * A subscribed calendar is REPLACED by what the feed serves on each poll:
 *   record changes            → same UID, new times/fields → item updates
 *   booking cancelled/removed → row leaves the payload → item disappears
 *   category switched off     → that category's items disappear
 *   master sync off           → the feed serves an EMPTY calendar, so the
 *                               client clears YesPleez items ⛔ without the
 *                               stored preferences being touched
 */

import { PUBLIC_ORIGIN } from './qrDestinations';
import { resolveSchedule } from './scheduleModel';
import { indexPerformances } from './eventSlots';
import { readDate } from '../screens/event/eventViewModel';
import {
  buildCalendar, calendarEventsBySlot, eventCalendarEvent,
  enquiryBookingEvent, enquiryDeadlineEvent,
} from './calendarEvent';

/**
 * ⭐ THE CATEGORY REGISTRY — every toggle the Calendar screen offers, in
 * display order. Only categories the schema can honestly serve are here:
 * soundcheck/load-in times and application deadlines have NO canonical data
 * yet, so they are ⛔ not listed rather than listed and empty.
 *
 * `group` is the heading the screen renders the toggle under.
 */
export const CALENDAR_CATEGORIES = [
  { key: 'sets',      group: 'BOOKINGS',  label: 'Set times' },
  { key: 'bookings',  group: 'BOOKINGS',  label: 'Confirmed bookings' },
  { key: 'attending', group: 'EVENTS',    label: 'Events I am attending' },
  { key: 'deadlines', group: 'DEADLINES', label: 'Enquiry response deadlines' },
];

/** Absent means ON — the house convention (absence-means-default). */
export function mergeCategories(stored = {}) {
  const out = {};
  for (const c of CALENDAR_CATEGORIES) out[c.key] = stored?.[c.key] !== false;
  return out;
}

/**
 * One gig's payload → the user's OWN confirmed set projections.
 *
 * The payload's `performances`/`members` are already scoped server-side to
 * the feed's user, so every claim that survives `calendarEventsBySlot`'s
 * confirmed gate is this user's own accepted set. `slots`/`stages` are the
 * WHOLE event's — the rollover walk needs every slot on the stage, and slot
 * times are not private on an event this user is booked on.
 */
function setEventsForGig(gig) {
  const membersById = {};
  for (const m of gig.members || []) membersById[m.id] = m;
  /* `primary`, ⛔ not `bySlot` — resolveSchedule keys ONE claim per slot
     (`claims?.[r.id]`), exactly as useEventData passes it. All rows here are
     the feed user's own, so "primary" can only ever pick between their own
     performances on a contested slot. */
  const { primary } = indexPerformances(gig.performances || [], membersById);
  const resolved = resolveSchedule({
    slots: gig.slots || [],
    stages: gig.stages || [],
    claims: primary,
    eventDate: readDate(gig.event?.config || {}),
  });
  return Object.values(calendarEventsBySlot(resolved, {
    event: gig.event, venueProfile: gig.venue || null,
  }));
}

/**
 * The RPC payload → the list of calendar projections, honouring the master
 * switch and the category toggles. Exposed separately from the text builder
 * so tests can assert on data rather than regexes.
 */
export function feedEvents(payload) {
  if (!payload || payload.found === false || payload.enabled === false) return [];
  const cats = mergeCategories(payload.categories);
  const out = [];

  if (cats.sets) {
    for (const gig of payload.gigs || []) out.push(...setEventsForGig(gig));
  }
  if (cats.bookings) {
    for (const gig of payload.gigs || []) {
      const ev = eventCalendarEvent({ event: gig.event, venueProfile: gig.venue || null, kind: 'gig' });
      if (ev) out.push(ev);
    }
    for (const row of payload.bookings || []) {
      const ev = enquiryBookingEvent(row);
      if (ev) out.push(ev);
    }
  }
  if (cats.attending) {
    /* ⚠ An event the user performs AT and also saved appears once, as the
       gig — the stronger claim. Without this a bill member who hearted their
       own gig gets two all-day banners for one night. */
    const gigIds = new Set((payload.gigs || []).map(g => g.event?.id).filter(Boolean));
    for (const row of payload.attending || []) {
      if (gigIds.has(row.event?.id)) continue;
      const ev = eventCalendarEvent({ event: row.event, venueProfile: row.venue || null, kind: 'event' });
      if (ev) out.push(ev);
    }
  }
  if (cats.deadlines) {
    for (const row of payload.deadlines || []) {
      const ev = enquiryDeadlineEvent(row);
      if (ev) out.push(ev);
    }
  }
  return out;
}

/**
 * The RPC payload → the complete VCALENDAR text the feed endpoint serves.
 *
 * ⚠ A DISABLED feed is an EMPTY calendar, ⛔ not an error: the subscribed
 * client then clears the YesPleez items, which is what "stop synchronising"
 * means to a calendar. An UNKNOWN token is the endpoint's 404 and never
 * reaches this function.
 */
export function feedCalendar(payload, { now = new Date() } = {}) {
  return buildCalendar(feedEvents(payload), { now });
}

/**
 * The subscription URLs for a token.
 *
 * ⭐ PUBLIC_ORIGIN, ⛔ never window.location — a subscription outlives the
 * tab it was copied in, same reasoning as the QR destinations. The path is
 * a REAL server path (the Pages Function), ⛔ not a hash route.
 *
 * `webcal://` is the scheme Apple Calendar and many clients register for
 * "subscribe to this"; Google Calendar takes the https form under
 * "From URL". Both fetch the identical feed.
 */
export function calendarFeedUrl(token) {
  return `${PUBLIC_ORIGIN}/calendar/feed?token=${token}`;
}

export function calendarWebcalUrl(token) {
  return calendarFeedUrl(token).replace(/^https:/, 'webcal:');
}
