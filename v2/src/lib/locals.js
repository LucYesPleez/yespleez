/**
 * LOCALS — the rotating slice of the local scene.
 *
 * NOT a recommender. It answers "who and what makes up my scene?", which no
 * other section carries: Spotlight is forward-looking events, Your People is
 * backward-looking changes, FOLLOWING is people you already chose. LOCALS is
 * people you have NOT chosen, near you, rotated so the section is worth
 * looking at again tomorrow.
 *
 * ⚠ A LADDER, NOT A SCORE (my-scene-philosophy rule 3). Three rungs, in order:
 *
 *   1. NEARBY        placeable and inside the radius, most recently active first
 *   2. ACTIVE        everyone else, most recently active first
 *   3. UNPLACEABLE   no location at all — last, but never dropped
 *
 * ⚠ UNKNOWN ≠ FAR, same law as the scene floor. A profile with no postcode is
 * not far away; its distance is unknown. It sits on the last rung rather than
 * being excluded, so thin location coverage cannot empty the section.
 *
 * ROTATION IS DETERMINISTIC AND DAILY. The rungs are concatenated into one
 * ordered pool, then a window of `limit` is taken starting at an offset
 * derived from the date, wrapping around the end. Same day = same faces for
 * everyone looking; next day = the next window. No Math.random: a random
 * section could show the same person twice in a week and a different one on
 * every re-render, and neither is explainable.
 */

import { profileCoords } from './geo';

/** Every profile type a person can browse. There is no `festival` type — a
 *  festival organiser is a `host`. `punter` is deliberately absent: personal
 *  profiles are not part of the public scene. */
export const LOCALS_TYPES = ['artist', 'band', 'standup', 'venue', 'host'];

export const LOCALS_LIMIT = 10;

/** Days since epoch for a YYYY-MM-DD string — the rotation clock. Parsed as
 *  UTC noon so a timezone offset can never shift which day this is. */
export function localsDayIndex(isoDate) {
  if (!isoDate) return 0;
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return 0;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** Most recently active first. Missing timestamps sort last rather than
 *  throwing the order — an undated profile is not a brand new one. */
function byRecentlyActive(a, b) {
  return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
}

/**
 * @param {object[]} profiles      candidate rows (id, user_id, type, postcode, lat, lng, updated_at…)
 * @param {object|null} originCoords  the user's coords, or null when unknown
 * @param {Set|Array} excludeIds   profiles the user owns — never shown back to them
 * @param {number} radiusKm        the "nearby" cut, or null for "no radius applied"
 * @param {string} isoDate         today, YYYY-MM-DD — the rotation seed
 * @param {number} limit           how many to show
 * @param {function} withinRadius  injected distance test, so this stays unit-testable
 */
export function buildLocals({
  profiles = [],
  originCoords = null,
  excludeIds = [],
  radiusKm = null,
  isoDate = '',
  limit = LOCALS_LIMIT,
  withinRadius = null,
} = {}) {
  const skip = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);

  const eligible = profiles.filter(p => {
    if (!p) return false;
    if (skip.has(p.id) || skip.has(p.user_id)) return false;
    return LOCALS_TYPES.includes(String(p.type || '').toLowerCase());
  });

  const nearby = [];
  const active = [];
  const unplaceable = [];

  for (const p of eligible) {
    const c = profileCoords(p);
    if (!c) { unplaceable.push(p); continue; }
    // No origin or no radius means nothing can be called "near" — everyone
    // placeable is simply active. We do not guess the user's location.
    const isNear = originCoords && radiusKm && withinRadius
      ? withinRadius(originCoords, c, radiusKm)
      : false;
    (isNear ? nearby : active).push(p);
  }

  nearby.sort(byRecentlyActive);
  active.sort(byRecentlyActive);
  unplaceable.sort(byRecentlyActive);

  /* ⚠ IT MAY REACH FURTHER, BUT IT MUST SAY SO. The rail showed Daddy
     Longlegs, who is in Cairns — 1678 km from Bellingen — because "everyone
     else" was a silent second rung (owner, 2026-08-03). The reach was not the
     problem; the silence was: "if there's no new gigs I'd rather it push out
     into nearby events, but it has to say that."

     So local comes first and fills the rail on its own wherever it can. Only
     when it cannot does the pool widen, and then `expanded` is true and the
     section says which of its cards are from further afield. The same shape as
     YOUR AREA's "None within 20 km — showing N within 100 km" line, which is
     already the house pattern for a borrowed net.

     `unplaceable` sits with the locals rather than in the widened rung:
     unknown ≠ far, and only 92 of 109 profiles carry a postcode, so treating
     them as distant would push most of a thin catalogue behind a disclosure
     it does not deserve. */
  const local = [...nearby, ...unplaceable];
  const canPlace = !!(originCoords && radiusKm);
  const expanded = canPlace && local.length < limit && active.length > 0;
  const farIds = expanded ? new Set(active.map(p => p.id ?? p.user_id)) : new Set();

  /* ⚠ WHEN IT REACHES FURTHER, THE LOCALS STILL LEAD. Rotating one combined
     pool would let a borrowed card outrank a local one on some days, which
     inverts the section's whole purpose. So the local cards are pinned to the
     front and only the borrowed tail rotates — the rail still changes daily,
     but never at the expense of showing your own scene first. */
  if (expanded) {
    const need = Math.min(limit - local.length, active.length);
    const start = (localsDayIndex(isoDate) * need) % active.length;
    const borrowed = [];
    for (let i = 0; i < need; i++) borrowed.push(active[(start + i) % active.length]);
    return { items: [...local, ...borrowed], pool: local.length + active.length,
      nearby: nearby.length, expanded: true, localCount: local.length, farIds };
  }

  // With no origin nothing is known to be distant, so nothing is being
  // borrowed and there is nothing to disclose.
  const pool = canPlace ? local : [...nearby, ...active, ...unplaceable];
  if (pool.length === 0) return { items: [], pool: 0, nearby: 0, expanded: false, localCount: 0, farIds };
  // Fewer than a full window means rotation would only reshuffle the same
  // faces — show them in ladder order instead, which is the honest ordering.
  if (pool.length <= limit) {
    return { items: pool, pool: pool.length, nearby: nearby.length,
      expanded, localCount: local.length, farIds };
  }

  const start = (localsDayIndex(isoDate) * limit) % pool.length;
  const items = [];
  for (let i = 0; i < limit; i++) items.push(pool[(start + i) % pool.length]);

  return { items, pool: pool.length, nearby: nearby.length,
    expanded, localCount: local.length, farIds };
}
