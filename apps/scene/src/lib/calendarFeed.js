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
  enquiryBookingEvent, enquiryDeadlineEvent, diaryCalendarEvent,
} from './calendarEvent';

/**
 * ⭐ THE CATEGORY REGISTRY — every toggle the Calendar screen offers, in
 * display order. Only categories the schema can honestly serve are here:
 * soundcheck/load-in times and application deadlines have NO canonical data
 * yet, so they are ⛔ not listed rather than listed and empty.
 *
 * ⚠ `label` IS SET IN CAPS AS DATA because it is a Bebas Neue heading in the
 * settings idiom, exactly like the notification categories it sits beside.
 * `desc` is the DM Sans line under it — one sentence saying what lands in
 * the calendar, ⛔ never what it stops.
 */
/**
 * ⭐⭐ THE FOUR QUESTIONS. Every role answers the same ones; only the SUBJECT
 * changes. ⛔ This is what stops the calendar becoming five bespoke systems —
 * a new role is a lookup, not a feature.
 */
export const QUESTIONS = {
  on:        "WHAT'S ON",
  when:      "WHEN I'M NEEDED",
  committed: "WHAT I'VE COMMITTED TO",
  waiting:   "WHAT'S WAITING ON ME",
};

/** The roles Phase 2A serves, in chip order. ⛔ Festival/volunteer/vendor are
    OUT OF SCOPE — they live in the Portal's registry and their "when" row has
    no data until the general shift primitive exists. */
export const CALENDAR_ROLES = [
  { key: 'common', label: 'COMMON',  profileTypes: null },
  { key: 'punter', label: 'PUNTER',  profileTypes: ['punter'] },
  { key: 'artist', label: 'ARTIST',  profileTypes: ['artist', 'band', 'standup'] },
  { key: 'host',   label: 'HOST',    profileTypes: ['host'] },
  { key: 'venue',  label: 'VENUE',   profileTypes: ['venue'] },
];

/**
 * ⭐⭐ `defaultOn` IS A COMPATIBILITY FLAG, ⛔ NOT A STYLE CHOICE.
 *
 * ⛔⛔ INTRODUCING A CATEGORY MUST NEVER SILENTLY EXPAND A CALENDAR SOMEBODY
 * HAS ALREADY SUBSCRIBED. A subscribed client replaces its YesPleez items on
 * every poll, so a category that arrives switched ON pushes new entries into
 * a real diary without anyone asking. Genuinely NEW categories therefore
 * default OFF and the reader opts in.
 *
 * ⭐⭐ BUT THE FOUR ARTIST KEYS AND `attending` ARE NOT NEW — they are CAL1's
 * shipped categories under role-scoped names (`sets` → `artist_sets`,
 * `bookings` → `artist_playing` + `artist_bookings`, `deadlines` →
 * `artist_deadlines`). ⛔ Defaulting THOSE off would empty the calendar of
 * every existing subscriber, which is the same defect in the other
 * direction: silent CONTRACTION rather than silent expansion.
 *
 * ⭐ So the rule is per-category LINEAGE, ⛔ never a blanket
 * "missing key = OFF": a category defaults to whatever its predecessor did,
 * and a category with no predecessor defaults OFF.
 */
export const CALENDAR_CATEGORIES = [
  /* ── COMMON · every account, keyed on the USER, no role required ── */
  { key: 'attending', role: 'common', question: 'on', defaultOn: true,
    label: 'EVENTS I AM GOING TO', desc: 'Events you have saved.' },
  { key: 'diary', role: 'common', question: 'on', defaultOn: false,
    label: 'MY OWN DIARY', desc: 'Your own entries from My Scene.' },

  /* ── PUNTER ── */
  { key: 'punter_doors', role: 'punter', question: 'when', defaultOn: false,
    label: 'DOORS AND START TIMES',
    desc: 'Saved events land at their start time instead of taking the whole day, where the organiser has given one.' },

  /* ── ARTIST · all four are CAL1 categories renamed, so all four stay ON ── */
  { key: 'artist_playing', role: 'artist', question: 'on', defaultOn: true,
    label: 'EVENTS I AM PLAYING', desc: 'Nights you are on the bill.' },
  { key: 'artist_sets', role: 'artist', question: 'when', defaultOn: true,
    label: 'MY SET TIMES', desc: 'Your own set times, with the stage and the running order behind them.' },
  { key: 'artist_bookings', role: 'artist', question: 'committed', defaultOn: true,
    label: 'MY CONFIRMED BOOKINGS', desc: 'Nights a venue has booked you for.' },
  { key: 'artist_deadlines', role: 'artist', question: 'waiting', defaultOn: true,
    label: 'ENQUIRIES TO ANSWER', desc: 'Enquiries waiting on your answer, on the day they are due.' },

  /* ── HOST · new in 2A ── */
  { key: 'host_events', role: 'host', question: 'on', defaultOn: false,
    label: 'EVENTS I AM HOSTING', desc: 'Nights you are running.' },
  { key: 'host_settimes', role: 'host', question: 'when', defaultOn: false,
    label: 'SET TIMES FOR MY EVENTS', desc: 'The running order on the events you host.' },

  /* ── VENUE · new in 2A ── */
  { key: 'venue_events', role: 'venue', question: 'on', defaultOn: false,
    label: 'EVENTS AT MY VENUE', desc: 'Nights on at your room.' },
  { key: 'venue_settimes', role: 'venue', question: 'when', defaultOn: false,
    label: 'RUNNING ORDER AT MY ROOM', desc: 'Set times for the nights at your venue.' },
  { key: 'venue_bookings', role: 'venue', question: 'committed', defaultOn: false,
    label: 'BOOKINGS AT MY VENUE', desc: 'Bookings confirmed for your room.' },
];

/**
 * ⭐⭐ THE TEST A CATEGORY MUST PASS (owner, 2026-09-02):
 *
 *     A CALENDAR ITEM PUTS YOU SOMEWHERE AT A TIME, OR DEMANDS AN ANSWER BY
 *     A DATE. Anything else is a FACT ABOUT something already in the
 *     calendar, and belongs on the event page or the dashboard.
 *
 * ⛔⛔ THIS IS WHAT KILLED "ACTS I HAVE BOOKED". Booking an act creates no new
 * obligation on a new date: the night is already there as EVENTS I AM
 * HOSTING, and the acts are already named at real times by SET TIMES FOR MY
 * EVENTS. Who is on the bill is roster information. ⛔ Do not reintroduce it
 * pointed at `lineup_members` either — that would be a better-implemented
 * category that still should not exist.
 *
 * ⚠⚠ THE ARTIST AND VENUE BOOKING ROWS LOOK IDENTICAL AND ARE NOT. An
 * accepted `venue_enquiries` row frequently has NO event record at all, so it
 * is a night that exists NOWHERE ELSE in the calendar — it passes the test.
 * The host version failed precisely because it only ever read enquiries
 * already attached to one of your own events, so by construction it could
 * only duplicate a night you already had.
 */
export const ABSENT_CATEGORIES = [
  { role: 'host',  question: 'committed',
    why: 'The acts on your bill are part of the night you are already hosting, not a separate commitment.' },
  { role: 'host',  question: 'waiting',
    why: 'Scene has no application closing date (applications_open is a boolean) and no host-side respond-by.' },
  { role: 'venue', question: 'waiting',
    why: 'respond_by is set by the venue for the artist, so a venue has no answer-by date of its own.' },
  { role: 'punter', question: 'committed',
    why: 'Saving an event is not a commitment anybody else relies on.' },
  { role: 'punter', question: 'waiting',
    why: 'Nothing is ever waiting on a punter.' },
];

/**
 * ⚠⚠ THE PRE-2A KEYS, AND WHY THEY ARE STILL READ.
 *
 * The shipped feed stored four flat keys. Absence means ON, so ⛔ only an
 * explicit `false` carries information — and silently dropping those keys
 * would turn every deliberate OFF back ON behind the user's back. Each legacy
 * key therefore still switches off whatever it used to switch off.
 *
 * ⚠ `bookings` covered TWO of the new questions (the events you play AND the
 * enquiry bookings), so it maps to both. ⛔ Do not "tidy" this away until the
 * stored rows have been migrated.
 */
const LEGACY_KEYS = {
  sets:      ['artist_sets'],
  bookings:  ['artist_playing', 'artist_bookings'],
  deadlines: ['artist_deadlines'],
  attending: ['attending'],
};

/**
 * ⭐⭐ THE PRECEDENCE, AND THE ORDER IS THE WHOLE CONTRACT:
 *
 *     1. an EXPLICIT value for the category itself      always wins
 *     2. an EXPLICIT value for its CAL1 predecessor     preserves the old choice
 *     3. the category's own `defaultOn`                 lineage, ⛔ not a blanket
 *
 * ⛔⛔ STEP 1 IS `typeof === 'boolean'`, ⛔ NOT `=== false`. Once somebody has
 * switched a new category ON, that stored `true` must survive — a rule that
 * only looked for `false` would keep re-applying the OFF default and the
 * toggle would silently spring back every poll.
 *
 * ⚠ Step 2 reads the legacy key BOTH ways for the same reason: a CAL1 user who
 * explicitly turned set times ON keeps them ON, and one who turned them OFF
 * keeps them OFF.
 */
export function mergeCategories(stored = {}) {
  const legacyValue = {};
  for (const [legacy, targets] of Object.entries(LEGACY_KEYS)) {
    if (typeof stored?.[legacy] === 'boolean') {
      for (const t of targets) legacyValue[t] = stored[legacy];
    }
  }
  const out = {};
  for (const c of CALENDAR_CATEGORIES) {
    if (typeof stored?.[c.key] === 'boolean') out[c.key] = stored[c.key];
    else if (typeof legacyValue[c.key] === 'boolean') out[c.key] = legacyValue[c.key];
    else out[c.key] = c.defaultOn === true;
  }
  return out;
}

/**
 * ⭐ WHICH CATEGORIES A READER HAS NEVER ANSWERED FOR — used by the screen to
 * say "off until you turn it on" rather than letting a switch that has never
 * been touched look like a setting somebody chose.
 */
export function untouchedCategories(stored = {}) {
  return CALENDAR_CATEGORIES
    .filter(c => typeof stored?.[c.key] !== 'boolean')
    .filter(c => !Object.entries(LEGACY_KEYS).some(([legacy, targets]) =>
      targets.includes(c.key) && typeof stored?.[legacy] === 'boolean'))
    .map(c => c.key);
}

/**
 * ⭐ WHICH ROLES THIS ACCOUNT ACTUALLY HOLDS, from the profile types the RPC
 * reports. ⛔ NEVER inferred from participation or from having been booked —
 * the profile IS the identity, and guessing a role from activity is how
 * somebody who once played a gig becomes an "artist" forever.
 *
 * ⚠ `common` is always present; it needs no profile.
 */
export function rolesForAccount(profileTypes = []) {
  const held = new Set((profileTypes || []).map(t => String(t || '').toLowerCase()));
  return CALENDAR_ROLES.filter(r => !r.profileTypes || r.profileTypes.some(t => held.has(t)));
}

/** The categories to show for a role, grouped by question, in grammar order. */
export function categoriesForRole(roleKey) {
  return CALENDAR_CATEGORIES.filter(c => c.role === roleKey);
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
  const push = ev => { if (ev) out.push(ev); };

  /* ── ARTIST ─────────────────────────────────────────────────────── */
  if (cats.artist_sets) {
    for (const gig of payload.gigs || []) out.push(...setEventsForGig(gig));
  }
  if (cats.artist_playing) {
    for (const gig of payload.gigs || []) {
      push(eventCalendarEvent({ event: gig.event, venueProfile: gig.venue || null, kind: 'gig' }));
    }
  }
  if (cats.artist_bookings) {
    for (const row of payload.bookings || []) push(enquiryBookingEvent(row));
  }
  if (cats.artist_deadlines) {
    for (const row of payload.deadlines || []) push(enquiryDeadlineEvent(row));
  }

  /* ── HOST ───────────────────────────────────────────────────────── */
  if (cats.host_events) {
    for (const g of payload.hosting || []) {
      push(eventCalendarEvent({ event: g.event, venueProfile: g.venue || null, kind: 'hosting' }));
    }
  }
  /* ⚠ ONE PROJECTION, TWO SUBJECTS. A host's running order and an artist's own
     set are the SAME slot rows through the SAME function — the summary differs
     only because the claim differs. ⛔ No second set-time implementation. */
  if (cats.host_settimes) {
    for (const g of payload.hosting || []) out.push(...setEventsForGig(g));
  }
  /* ⛔ NO "committed" BRANCH FOR HOST — see ABSENT_CATEGORIES. The acts on a
     bill are a property of a night already in the calendar, ⛔ not an
     appointment of their own. */

  /* ── VENUE ──────────────────────────────────────────────────────── */
  if (cats.venue_events) {
    for (const g of payload.venue_events || []) {
      push(eventCalendarEvent({ event: g.event, venueProfile: g.venue || null, kind: 'venue' }));
    }
  }
  if (cats.venue_settimes) {
    for (const g of payload.venue_events || []) out.push(...setEventsForGig(g));
  }
  if (cats.venue_bookings) {
    for (const row of payload.venue_bookings || []) push(enquiryBookingEvent(row));
  }

  /* ── COMMON ─────────────────────────────────────────────────────── */
  if (cats.attending) {
    for (const row of payload.attending || []) {
      /* ⚠ TIMED ONLY IF THE PUNTER ASKED. `punter_doors` is the punter's
         "when I'm needed"; without it a saved event stays a whole-day banner,
         exactly as it shipped. */
      push(eventCalendarEvent({
        event: row.event, venueProfile: row.venue || null, kind: 'event',
        timed: !!cats.punter_doors,
      }));
    }
  }
  if (cats.diary) {
    for (const entry of payload.diary || []) push(diaryCalendarEvent({ entry }));
  }

  /* ⭐⭐ ONE ITEM PER UID, FIRST WINS, AND THE ORDER ABOVE IS THE PRIORITY.
     An account that plays at, hosts, owns the venue for AND saved the same
     night would otherwise get four banners for one evening. The artist
     reading is kept because it is the most personal: "you are on the bill"
     beats "this is on at your venue". ⚠ Set-time UIDs collide the same way
     when you host the event you are playing — same slot, same instant, one
     entry. */
  const seenUid = new Set();
  const seenEvent = new Set();
  return out.filter(ev => {
    if (!ev?.uid || seenUid.has(ev.uid)) return false;
    /* ⚠⚠ THE EVENT-LEVEL DEDUPE CANNOT BE UID EQUALITY. The four role kinds
       mint FOUR different uids for one night (`gig`/`hosting`/`venue`/`event`),
       so this compares the EVENT. ⛔ Slot items carry no `eventId` and are
       deduped by uid alone, which is correct — one slot is one instant. */
    if (ev.eventId) {
      if (seenEvent.has(ev.eventId)) return false;
      seenEvent.add(ev.eventId);
    }
    seenUid.add(ev.uid);
    return true;
  });
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
