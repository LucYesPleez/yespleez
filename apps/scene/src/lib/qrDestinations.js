/**
 * QR DESTINATIONS — the one registry of what a YesPleez QR code can open.
 *
 * ── ⭐⭐ THE PRODUCT PRINCIPLE, AS CODE ───────────────────────────────────
 *
 *     YesPleez owns the destination. The graphic is an export of it.
 *
 * A QR is a printed object. Once it is on a poster, a bathroom door or a
 * venue's front window, ⛔ it can never be edited — so what it encodes must be
 * a durable YesPleez ADDRESS, never a snapshot of content. Every rule below
 * follows from that one fact:
 *
 *   · the encoded string is `/q/{type}/{id}` — an entity id, which is
 *     permanent, ⛔ never a slug that could be re-pointed or a query string
 *     that could be dropped
 *   · resolution happens when the code is SCANNED, so an event whose venue,
 *     lineup, times or artwork changed still resolves
 *   · ⛔ NOTHING about a scan depends on a row in `qr_codes`. That table is the
 *     user's saved LIBRARY. Deleting a saved QR must not break a printed one,
 *     which is why the destination is in the URL and not behind a lookup.
 *
 * ── ⛔ DESTINATION IS NOT PRESENTATION ───────────────────────────────────
 *
 * This file answers "where does it go and who may point at it". It knows
 * nothing about pixels, paper, colour or templates — `qr/qrRender.js` and
 * `qr/qrPdf.js` own those, and take a URL. Adding a destination type must not
 * require touching either, and adding a poster template must not require
 * touching this. The brief asks for exactly that seam; it is here.
 *
 * ── ADDING A DESTINATION TYPE ────────────────────────────────────────────
 *
 * One entry in DESTINATIONS, one selector case in `qrEntities.js`, done. Stage,
 * Programme, Ticket and Check-in are all expected to arrive this way. ⛔ Do not
 * add a second registry, and ⛔ do not let a screen build a `/q/...` path by
 * hand — `qrPath()` is the only thing that may.
 */

import { PROFILE_TYPES } from './profileTypes';

/**
 * ⚠⚠ THE PRINTED ORIGIN IS A CONSTANT, ⛔ NEVER `window.location.origin`.
 *
 * `lib/shareTarget.shareUrl()` builds from the live origin, which is right for
 * a link you paste into a chat right now. It is WRONG for print: generating a
 * poster from `npm run dev` would bake `http://localhost:5173` into a QR that
 * is then sent to a printer, and nobody discovers it until the flyers arrive.
 * A printed destination is always production.
 *
 * ⚠ The `#` is HashRouter's, and it is load bearing — see App.jsx. If Scene
 * ever moves to a history router, this constant and `qrPath` change together
 * and every previously printed code keeps working only if the old hash form is
 * still served. ⛔ Do not change the router without answering that.
 */
export const PUBLIC_ORIGIN = 'https://yespleez.com';

/** Subjects a destination can point at. Drives which selector the UI shows. */
export const SUBJECT = Object.freeze({
  EVENT:   'event',
  PROFILE: 'profile',
});

/**
 * The destination registry.
 *
 *   key          the `/q/{key}/...` path segment. ⛔ PERMANENT once printed.
 *   label        what the generator's menu calls it
 *   scanLabel    the instruction shown on screen. ⚠ No em dashes.
 *   posterKicker the poster's sub-line, in caps. ⭐ DECLARED, ⛔ never derived
 *                by stripping "Scan for" off `scanLabel` — the two answer
 *                different questions and a future one may not rhyme at all.
 *   subject      which selector to show
 *   profileTypes for SUBJECT.PROFILE — which profile types are selectable
 *   route        the in-app path a scan resolves to
 *   available    false = architected, not offered yet (Festival)
 */
export const DESTINATIONS = Object.freeze({
  event: {
    key: 'event',
    label: 'Event',
    scanLabel: 'Scan for event details',
    posterKicker: "EVENT",
    blurb: 'Opens the public event page: who is playing, where, when, and how to get in.',
    subject: SUBJECT.EVENT,
    route: (id) => `/event/${id}`,
    available: true,
  },

  /**
   * ⭐⭐ DELIBERATELY SEPARATE FROM `event`, per the brief. Two different
   * questions: the event page answers "what is this?", set times answers
   * "what is happening, and when?". The second is what somebody standing in
   * the room at 9pm is asking, and it deserves its own printed code by the
   * door rather than a scroll down a poster page.
   *
   * ⚠ The set times themselves are NOT in the QR. Change the running order at
   * 4pm and the code taped to the wall since Tuesday shows the new one.
   */
  'set-times': {
    key: 'set-times',
    label: 'Set Times',
    scanLabel: 'Scan for set times',
    posterKicker: "SET TIMES",
    blurb: 'Opens the running order for the night. Stays correct when times change.',
    subject: SUBJECT.EVENT,
    route: (id) => `/event/${id}/set-times`,
    available: true,
  },

  venue: {
    key: 'venue',
    label: 'Venue',
    scanLabel: 'Scan for the venue',
    posterKicker: "VENUE",
    blurb: 'Opens the venue profile.',
    subject: SUBJECT.PROFILE,
    profileTypes: ['venue'],
    route: (id) => `/profile/${id}`,
    available: true,
  },

  /**
   * ⭐⭐ THE PERMANENT ONE. This is the code a venue prints once and puts on
   * the door, the bar, the tables and the toilet wall. It must never need
   * regenerating, so it points at the profile and lands on the gig list, which
   * is computed from today forward every time it is opened.
   *
   * ⚠ `?focus=whats-on` is a UI HINT, not part of the address. A scanner that
   * drops the query string still lands on the right venue, one scroll away.
   * ⛔ Never move identity into the query string for this reason.
   */
  'whats-on': {
    key: 'whats-on',
    label: "What's On",
    scanLabel: "Scan for what's on",
    posterKicker: "WHAT'S ON",
    blurb: 'Opens the current list of upcoming events. Print it once and leave it up.',
    subject: SUBJECT.PROFILE,
    profileTypes: ['venue', 'host'],
    route: (id) => `/profile/${id}?focus=whats-on`,
    available: true,
  },

  artist: {
    key: 'artist',
    label: 'Artist',
    scanLabel: 'Scan for the artist',
    posterKicker: "ARTIST",
    blurb: 'Opens a public artist profile.',
    subject: SUBJECT.PROFILE,
    profileTypes: ['artist', 'band', 'standup'],
    route: (id) => `/profile/${id}`,
    available: true,
  },

  /**
   * ⛔ ARCHITECTED, NOT BUILT — and the distinction is the point.
   *
   * The brief asks for Festival to exist in the architecture while the festival
   * model is not ready. `available: false` is how: the type is real, its route
   * is declared, `qrPath('festival', id)` already produces the address a future
   * festival QR will carry, and no menu offers it. When the Portal's model is
   * ready this flips to `true` and nothing else in the QR system moves.
   *
   * ⚠ Festival profiles are a PLATFORM type Scene renders but does not offer
   * (see profileTypes.js) — which is exactly why this is not simply switched on.
   */
  festival: {
    key: 'festival',
    label: 'Festival',
    scanLabel: 'Scan for the festival',
    posterKicker: "FESTIVAL",
    blurb: 'Opens the festival profile.',
    subject: SUBJECT.PROFILE,
    profileTypes: ['festival'],
    route: (id) => `/profile/${id}`,
    available: false,
  },
});

export const DESTINATION_KEYS = Object.keys(DESTINATIONS);

/** Is this a destination type we know about? Used by the `/q/` resolver. */
export function isDestinationType(type) {
  return Object.prototype.hasOwnProperty.call(DESTINATIONS, type);
}

/**
 * The in-app path a `/q/{type}/{id}` scan resolves to.
 * @returns {string|null} null for an unknown type or a missing id
 */
export function resolveDestination(type, id) {
  const d = DESTINATIONS[type];
  if (!d || !id) return null;
  return d.route(id);
}

/**
 * The poster's sub-line: what the code is, and when, in one letterspaced row.
 *
 *     posterKicker('set-times', 'Sat 21 Jun')  ->  "SET TIMES · SAT 21 JUN"
 *     posterKicker('whats-on')                 ->  "WHAT'S ON"
 *
 * ⭐ ONE PLACE. The poster, the on-screen proof and any future template all
 * call this, so a preview can never disagree with the print about what the
 * poster says.
 */
export function posterKicker(type, context = '') {
  const d = DESTINATIONS[type];
  return [d?.posterKicker, context].filter(Boolean).join(' · ').toUpperCase();
}

/** The `/q/` path itself — what gets encoded, minus the origin. */
export function qrPath(type, id) {
  if (!isDestinationType(type) || !id) return null;
  return `/q/${type}/${id}`;
}

/**
 * ⭐ THE ENCODED STRING. Everything printed goes through here.
 *
 * @param {string} type   a DESTINATIONS key
 * @param {string} id     the entity id
 * @param {string} [origin] override, for tests only. ⛔ Never pass window.location.origin.
 */
export function qrUrl(type, id, origin = PUBLIC_ORIGIN) {
  const path = qrPath(type, id);
  return path ? `${origin}/#${path}` : null;
}

/**
 * WHICH DESTINATIONS MAY THIS ACCOUNT CREATE?
 *
 * ⛔ THIS IS A MENU, NOT A PERMISSION. Every destination here is a PUBLIC page;
 * a QR grants nothing that typing the URL would not. What this stops is
 * offering somebody a generator for things that are not theirs — the same job
 * `lib/eventOwnership.isEventManager` does for the management UI, and the same
 * caveat applies: RLS is the boundary, this is the invitation.
 *
 * The rules, and why:
 *
 *   Event / Set Times   needs at least one event this account manages
 *   Venue               needs a venue profile
 *   What's On           needs a venue OR host profile (a promoter has a
 *                       what's-on too — it is their upcoming events)
 *   Artist              a performer profile of your own, OR an artist on one
 *                       of your bills. ⭐ The second arm is what makes an
 *                       Artist QR useful to a venue: the poster for tonight
 *                       wants the act's profile on it, and booking them is a
 *                       legitimate basis for printing their public address.
 *   Festival            never in V1 — `available: false` decides it here
 *
 * @param {object} ctx
 * @param {Array}  ctx.ownedProfiles  [{id, type, name}] from getOwnerProfiles + performers
 * @param {number} ctx.manageableEventCount
 * @param {number} ctx.bookedArtistCount
 * @returns {Array} the offerable destination descriptors, menu order
 */
export function destinationsForOwner({
  ownedProfiles = [],
  manageableEventCount = 0,
  bookedArtistCount = 0,
} = {}) {
  const types = new Set(ownedProfiles.map(p => p.type));
  const hasEvents = manageableEventCount > 0;

  return DESTINATION_KEYS
    .map(k => DESTINATIONS[k])
    .filter(d => {
      if (!d.available) return false;
      switch (d.key) {
        case 'event':
        case 'set-times':
          return hasEvents;
        case 'venue':
          return types.has('venue');
        case 'whats-on':
          return types.has('venue') || types.has('host');
        case 'artist':
          return bookedArtistCount > 0
            || d.profileTypes.some(t => types.has(t));
        default:
          return false;
      }
    });
}

/**
 * The accent a QR row wears, taken from the profile taxonomy where the
 * destination has one so the QR list matches every other identity surface.
 * ⛔ Do not hand-pick colours here — profileTypes.js owns them (10E.1).
 */
export function destinationAccent(type) {
  const d = DESTINATIONS[type];
  const pt = d?.profileTypes?.[0];
  if (pt && PROFILE_TYPES[pt]) return PROFILE_TYPES[pt].accent;
  // Event-subject destinations take the host accent: an event's QR is made by
  // whoever runs it, and that is the colour the host dashboard already uses.
  return PROFILE_TYPES.host.accent;
}

/**
 * ANALYTICS SEAM — declared, ⛔ deliberately not wired.
 *
 * The brief asks that scan tracking be possible later without reshaping the
 * system, and asks equally that V1 not introduce tracking to prove it. Both are
 * satisfied by an OPTIONAL source parameter:
 *
 *     /q/event/{id}?s={qr_code_id}
 *
 * · a scan can be attributed to the printed artefact it came from, so "the
 *   bathroom poster outperforms the bar" becomes answerable
 * · it is additive: strip it and the destination still resolves, which is why
 *   it is a query parameter and not part of the path
 * · ⛔ nothing writes it today, nothing reads it, and no export includes it.
 *   Turning it on is a product decision with a privacy answer attached, and
 *   `docs/analytics-vision` already rules event ids are masked in analytics —
 *   ⛔ any future scan record must satisfy that, not route around it.
 */
export function qrUrlWithSource(type, id, qrCodeId, origin = PUBLIC_ORIGIN) {
  const base = qrUrl(type, id, origin);
  if (!base || !qrCodeId) return base;
  return `${base}${base.includes('?') ? '&' : '?'}s=${qrCodeId}`;
}
