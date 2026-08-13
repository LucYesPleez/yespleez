// The date maths and the private overlay behind the owner's calendar. Pure —
// no React, no fetching, so the rules that are easy to get wrong are testable.
//
// ⭐⭐ ONE PROJECTION, EVERY PRIVATE ENTRY POINT. Available Dates and Enquiries
// both build their dots from `buildMarkers` here. They were going to drift the
// moment one of them learned about a status the other did not — which is
// exactly how the enquiry card's status colours ended up disagreeing with the
// tabs above them.
//
// ⛔ NOTHING HERE IS EVER GIVEN TO THE PUBLIC CALENDAR. The privacy boundary is
// that a public caller never asks for these values, so there is no flag to
// invert and no branch to get wrong.
import { normaliseStatus, STATUS_TAB_COLOR } from './enquiryUtils';

/** Canonical status order. Both directions — a day can hold an outgoing ask. */
export const STATUS_ORDER = ['new', 'seen', 'shortlisted', 'awaiting', 'interested', 'accepted', 'booked', 'declined'];

/** Status → dot colour. ⛔ Not a new palette: the tab map, reused. */
export const dotColour = (status) => STATUS_TAB_COLOR[String(status).toUpperCase()] || 'var(--muted)';

const iso = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

/**
 * Every date an enquiry touches.
 *
 * ⚠ A MULTI-DAY BOOKING BELONGS TO EVERY ONE OF ITS DAYS. An act playing the
 * 20th to the 22nd is committed on the 21st, and a calendar that marks only the
 * first day tells the organiser the 21st is free — which is worse than telling
 * them nothing, because they will book over it.
 *
 * Where no end date exists the range is the single day. That is the honest
 * reading of a record that only ever named one date, not an assumption that the
 * booking is short: `venue_enquiries` has a single `date_requested` column and
 * genuinely cannot express a range.
 *
 * ⛔ NOON, NOT MIDNIGHT. `new Date('2026-08-20')` is parsed as UTC and lands on
 * the 19th in every timezone behind it, so a range built from midnight silently
 * shifts a day west of Greenwich. Midday is far enough from both edges that no
 * offset can move the calendar date.
 *
 * ⛔ Capped. A malformed or open-ended range must not walk the loop forever.
 */
export function datesCovered(enq, maxDays = 60) {
  const start = enq?.date_requested || enq?.preferred_date || null;
  if (!start) return [];
  const end = enq?.date_requested_end || enq?.end_date || null;
  if (!end || end <= start) return [iso(start)];

  const out = [];
  const cur = new Date(`${start}T12:00:00`);
  const stop = new Date(`${end}T12:00:00`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(stop.getTime())) return [iso(start)];
  while (cur <= stop && out.length < maxDays) {
    out.push(iso(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * dateStr → the enquiries touching it.
 *
 * One enquiry appears under several dates by design; the calendar counts
 * per-day, not per-record.
 */
export function indexByDate(enquiries = []) {
  const map = {};
  for (const enq of enquiries || []) {
    for (const ds of datesCovered(enq)) (map[ds] ||= []).push(enq);
  }
  return map;
}

/**
 * dateStr → dot colours, ready for the calendar grid.
 *
 * ⭐ THE ONE PLACE A PRIVATE DOT IS DECIDED. Available Dates and Enquiries both
 * call this, so a date cannot show two enquiries in one entry point and three
 * in the other — which is the state-leakage the owner's calendar exists to
 * prevent. An owner looking at Available Dates must not have to remember to
 * check Enquiries before changing a date.
 */
export function buildMarkers(enquiries = []) {
  const byDate = indexByDate(enquiries);
  const markers = {};
  for (const [ds, list] of Object.entries(byDate)) markers[ds] = list.map(e => dotColour(normaliseStatus(e)));
  return markers;
}

/**
 * What is happening on one date: the count and a per-status breakdown, in the
 * canonical order rather than whatever order the rows arrived in.
 */
export function summariseDate(list = []) {
  const counts = {};
  for (const e of list || []) { const s = normaliseStatus(e); counts[s] = (counts[s] || 0) + 1; }
  return {
    total: (list || []).length,
    breakdown: STATUS_ORDER.filter(s => counts[s]).map(s => ({ status: s, count: counts[s] })),
  };
}

/** The statuses actually present, for a key that never explains an absent colour. */
export function statusesPresent(byDate = {}) {
  const present = new Set(Object.values(byDate).flat().map(e => normaliseStatus(e)));
  return STATUS_ORDER.filter(s => present.has(s));
}
