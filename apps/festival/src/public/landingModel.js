// Explicit extension so `node --test` can run this module unbundled — the
// registry is plain data and imports nothing itself.
import { CATEGORIES } from '../config/categories.js';

/**
 * THE LANDING PAGE'S VIEW OF A FESTIVAL — pure shaping, no network.
 *
 * The public landing page renders exactly what the rows say and nothing more:
 * absent is absent (§2.8 of FESTIVAL_UX_v1 — never a placeholder apologising
 * for itself). Every field below is null or [] when the data does not exist,
 * and the screen renders nothing for it.
 *
 * ⭐ CATEGORIES SHOWN = open on the event ∩ applyable in the registry. This is
 * the same intersection Scene's apply flow serves, so the landing page can
 * never advertise a category the apply page will not offer. A category the
 * organiser opened that no profile type can apply to is the ORGANISER'S
 * broken state (Home, rung 1) — putting it in front of the public would
 * advertise a door that does not open.
 */

/** 'YYYY-MM-DD' → local Date, or null.
 *  ⛔ Never `new Date(str)` on a date-only column: that parses as UTC midnight
 *  and a later `.getDate()` is then timezone-dependent. Building from parts is
 *  local everywhere. */
export function parseDateOnly(str) {
  if (typeof str !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const LONG = { day: 'numeric', month: 'long', year: 'numeric' };

/** "16 – 19 January 2027", or one date, or null — same behaviour as the
 *  organiser topbar's formatter, so both surfaces describe dates identically. */
export function formatDateRange(startsOn, endsOn) {
  const start = parseDateOnly(startsOn);
  const end = parseDateOnly(endsOn);
  if (!start && !end) return null;
  if (start && end) {
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    return sameMonth
      ? `${start.getDate()} – ${end.toLocaleDateString('en-AU', LONG)}`
      : `${start.toLocaleDateString('en-AU', LONG)} – ${end.toLocaleDateString('en-AU', LONG)}`;
  }
  return (start || end).toLocaleDateString('en-AU', LONG);
}

/** "30 September 2026" or null. */
export function formatDate(dateStr) {
  const d = parseDateOnly(dateStr);
  return d ? d.toLocaleDateString('en-AU', LONG) : null;
}

/**
 * @param {object} args
 *   event        { id, name, applications_open, lat, lng }
 *   profile      { id, name, tagline, bio, location, website }
 *   settings     { starts_on, ends_on } | null
 *   categories   festival_categories rows with state = 'open'
 *   departments  festival_departments rows (unarchived), for the volunteer card
 * @returns the view model the screen renders, verbatim
 */
export function buildLanding({ event, profile, settings, categories = [], departments = [] }) {
  const open = new Set(categories.map(c => c.key));
  const closesByKey = Object.fromEntries(categories.map(c => [c.key, c.closes_at ?? null]));

  // Registry order, not row order — the organiser's toggling sequence is not a
  // presentation order.
  const apply = CATEGORIES
    .filter(cat => open.has(cat.key) && (cat.appliesAs?.length ?? 0) > 0)
    .map(cat => ({
      key: cat.key,
      label: cat.label,
      icon: cat.icon,
      noun: cat.noun,
      appliesAs: cat.appliesAs,
      closesOn: formatDate(closesByKey[cat.key]),
      // Real rows from the organiser, never a default list. Only the volunteer
      // card asks for them today, and an empty list renders nothing.
      departments: cat.asksDepartments ? departments.map(d => d.name) : [],
    }));

  return {
    eventId: event.id,
    // The occurrence's name leads; the organisation's name is the fallback so
    // an unnamed round still has a title rather than a hole.
    title: event.name || profile.name || '',
    festivalName: profile.name ?? null,
    tagline: profile.tagline ?? null,
    about: profile.bio ?? null,
    location: profile.location ?? null,
    website: profile.website ?? null,
    dates: formatDateRange(settings?.starts_on, settings?.ends_on),
    startsOn: settings?.starts_on ?? null,
    endsOn: settings?.ends_on ?? null,
    mapsUrl: buildMapsUrl(event, profile),
    // Both must be true for anyone to apply — the organiser's master switch
    // AND something actually accepting people. Same derivation the organiser's
    // own dashboard uses.
    applicationsOpen: Boolean(event.applications_open) && apply.length > 0,
    apply,
  };
}

// A directions link costs no API key and invents nothing: coordinates when the
// event has them, the stated location otherwise, nothing when neither exists.
function buildMapsUrl(event, profile) {
  // `events.lat/lng` are Postgres numerics — coerce rather than trust the
  // client library's choice of number-or-string.
  const lat = Number(event.lat);
  const lng = Number(event.lng);
  if (event.lat != null && event.lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://maps.google.com/?q=${lat},${lng}`;
  }
  if (profile.location) {
    return `https://maps.google.com/?q=${encodeURIComponent(profile.location)}`;
  }
  return null;
}
