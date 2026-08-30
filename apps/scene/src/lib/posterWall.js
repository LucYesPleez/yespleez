/**
 * Poster Wall — the pure model. RATIFIED 2026-08-31 (memory
 * project_poster_wall): My Scene's ARCHIVE tense. The wall is a QUERY over
 * relationship records, never a maintained collection:
 *
 *   participation (played / hosted)          → always on the wall
 *   follows of an event (saved / hearted)    → only once the event is PAST
 *
 * The only user-authored wall state is curation: a hidden set, plus per-item
 * position/size overrides. Membership itself can never be edited.
 *
 * Everything visual about an item — rotation, paper size, tape dressing —
 * is seeded deterministically from the event id, so the same wall renders
 * every visit and new posters JOIN it rather than reshuffling it.
 */
import { isArchived } from './eventBuckets';
import { eventSpan } from './eventDays';

/* Paper sizes — the ONLY sizes a poster may take (A-series, ratio 1:√2).
   Widths are wall-units; the layout scales them to the viewport. Resizing
   steps through these, never free-scales. */
export const POSTER_SIZES = ['a5', 'a4', 'a3'];
export const SIZE_WIDTHS = { a5: 118, a4: 158, a3: 212 };
export const A_RATIO = Math.SQRT2;

export const NOTE_W = 120;   // post-it notes are square-ish, one size
export const NOTE_H = 116;
export const STICKER_W = 62; // logo stickers, one size

/** Deterministic 32-bit hash of a string id. */
export function hashId(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* A tiny deterministic PRN stream off one id — each call site takes a named
   channel so adding a new visual property never shifts the existing ones. */
function chan(id, salt) {
  return hashId(salt + ':' + id) / 4294967295;
}

/** The seeded look of one wall item. Pure function of its id. */
export function seedFor(id) {
  const r = (salt) => chan(id, salt);
  return {
    rot: Math.round((r('rot') * 12 - 6) * 10) / 10,          // -6°..6°
    size: POSTER_SIZES[Math.floor(r('size') * 3)],           // a5/a4/a3
    tape: Math.floor(r('tape') * 4),                          // dressing variant
    dx: Math.round(r('dx') * 22 - 11),                        // jitter, px
    dy: Math.round(r('dy') * 18 - 9),
  };
}

/**
 * Membership. Inputs are the relationship records already fetched:
 *   events           deduped event rows ({id, name, config, …})
 *   playedIds        Set — lineup membership (on_bill) for this user
 *   hostedIds        Set — events this user hosts
 *   followedIds      Set — follows rows with entity_type 'event'
 *
 * Returns poster/note items, oldest first (the wall accumulates downward).
 * ⚠ "is this past" is asked of isArchived, which delegates to
 * deriveEventStatus — never re-derived here (the UTC-slice family of bugs).
 */
export function buildWallItems({ events = [], playedIds, hostedIds, followedIds, todayStr } = {}) {
  const played = playedIds || new Set();
  const hosted = hostedIds || new Set();
  const followed = followedIds || new Set();
  const items = [];
  const seen = new Set();

  for (const ev of events) {
    if (!ev?.id || seen.has(ev.id)) continue;
    seen.add(ev.id);

    const isParticipant = played.has(ev.id) || hosted.has(ev.id);
    const isPast = isArchived(ev, todayStr);
    if (!isParticipant && !(followed.has(ev.id) && isPast)) continue;

    const cfg = ev.config || {};
    const art = cfg.poster_full || cfg.poster || null;
    const span = eventSpan(ev);
    items.push({
      id: ev.id,
      kind: art ? 'poster' : 'note',
      img: art,
      name: ev.name || cfg.name || 'Event',
      date: span?.start || null,
      venue: cfg.venue_name || cfg.venue || cfg.location || '',
      badge: played.has(ev.id) ? 'PLAYED' : hosted.has(ev.id) ? 'HOSTED' : 'WENT',
      multiDay: !!(span && span.end > span.start),
      seed: seedFor(ev.id),
    });
  }

  // Oldest first: the wall reads top-down as time passing; a new poster joins
  // at the bottom instead of displacing everything above it.
  items.sort((a, b) => String(a.date || '9999') < String(b.date || '9999') ? -1
    : String(a.date || '9999') > String(b.date || '9999') ? 1
    : String(a.id) < String(b.id) ? -1 : 1);
  return items;
}

/** Logo stickers from followed acts. logosByProfile is fetchDistributableLogos' map. */
export function buildStickers({ followedProfiles = [], logosByProfile = {} } = {}) {
  const out = [];
  for (const p of followedProfiles) {
    for (const logo of logosByProfile[p.id] || []) {
      if (!logo?.url) continue;
      out.push({
        id: 'sticker:' + logo.id,
        kind: 'sticker',
        img: logo.url,
        name: p.name || 'Profile',
        profileId: p.id,
        seed: seedFor('sticker:' + logo.id),
      });
    }
  }
  return out;
}

/* ── Curation state — hide + per-item overrides ─────────────────────────
   Membership is derived; PLACEMENT is user data. The stored shape:
   { hidden: [id], pos: { [id]: {x, y} }, size: { [id]: 'a4' } } */
export const EMPTY_WALL_STATE = Object.freeze({ hidden: [], pos: {}, size: {} });

export function applyWallState(items, state = EMPTY_WALL_STATE) {
  const hidden = new Set(state.hidden || []);
  return items.filter(it => !hidden.has(it.id)).map(it => ({
    ...it,
    sizeOverride: state.size?.[it.id] || null,
    posOverride: state.pos?.[it.id] || null,
  }));
}

export function nextSize(size) {
  return POSTER_SIZES[(POSTER_SIZES.indexOf(size) + 1) % POSTER_SIZES.length];
}

/* ── Time breakdowns — filters over the ONE wall, never separate walls ── */
export function wallYears(items) {
  const ys = new Set();
  for (const it of items) if (it.date) ys.add(it.date.slice(0, 4));
  return [...ys].sort().reverse();
}

/** period: null (all) | {year} | {year, month: '01'..'12'} — string compare
    on the event's LOCAL start date, never a timestamp slice. */
export function inPeriod(item, period) {
  if (!period) return true;
  if (item.kind === 'sticker') return !period.month; // stickers dress the wall, not a month
  if (!item.date) return false;
  if (item.date.slice(0, 4) !== period.year) return false;
  if (period.month && item.date.slice(5, 7) !== period.month) return false;
  return true;
}

/** The secondary numbers. Posters are the interface; these stay a corner chip. */
export function wallStats(items, { festivalIsh = isFestivalIsh } = {}) {
  const posters = items.filter(it => it.kind !== 'sticker');
  const venues = new Set(posters.map(p => (p.venue || '').trim().toLowerCase()).filter(Boolean));
  return {
    posters: posters.length,
    venues: venues.size,
    stickers: items.length - posters.length,
    festivals: posters.filter(festivalIsh).length,
  };
}

function isFestivalIsh(p) {
  // A multi-day event reads as a festival; without a type column this is the
  // honest derivable answer, not a stored genre.
  return !!p.multiDay;
}

/* ── Layout — deterministic shelf pack with overlap ─────────────────────
   Returns items with {x, y, w, h, z}. Overrides win; everything else flows
   from seeds alone, so the wall is identical on every visit. */
export function layoutWall(items, wallWidth) {
  const W = Math.max(280, wallWidth || 360);
  const GUTTER = 14;
  const placed = [];
  let x = GUTTER, rowY = 12, rowMaxH = 0, z = 1;

  for (const it of items) {
    let w, h;
    if (it.kind === 'sticker') { w = STICKER_W; h = STICKER_W; }
    else if (it.kind === 'note') { w = NOTE_W; h = NOTE_H; }
    else {
      const size = it.sizeOverride || it.seed.size;
      w = SIZE_WIDTHS[size];
      h = Math.round(w * A_RATIO);
    }

    if (it.kind === 'sticker') {
      // Stickers do not consume shelf space — they perch over the wall at
      // seeded spots inside the area posters have already claimed.
      placed.push({ ...it, w, h, deferred: true, z: 200 + (z++) });
      continue;
    }

    if (x + w > W - GUTTER + 24) {           // +24: allow edge overhang
      x = GUTTER;
      rowY += Math.round(rowMaxH * 0.86);    // rows overlap like real layers
      rowMaxH = 0;
    }
    const px = Math.min(Math.max(0, x + it.seed.dx), Math.max(0, W - w));
    const py = Math.max(0, rowY + it.seed.dy);
    placed.push({ ...it, w, h, x: it.posOverride?.x ?? px, y: it.posOverride?.y ?? py, z: z++ });
    x += Math.round(w * 0.94);               // slight horizontal overlap
    rowMaxH = Math.max(rowMaxH, h);
  }

  const wallHeight = placed.filter(p => !p.deferred)
    .reduce((m, p) => Math.max(m, p.y + p.h), 320) + 40;

  for (const p of placed) {
    if (!p.deferred) continue;
    p.x = p.posOverride?.x ?? Math.round(chan(p.id, 'sx') * (W - p.w));
    p.y = p.posOverride?.y ?? Math.round(chan(p.id, 'sy') * Math.max(1, wallHeight - p.h - 60)) + 30;
    delete p.deferred;
  }
  return { items: placed, height: wallHeight };
}
