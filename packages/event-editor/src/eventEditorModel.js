/**
 * THE EVENT EDITOR'S DATA MODEL — pure, no React, no Supabase.
 *
 * ⭐ EXTRACTED SO THERE IS ONE EVENT EDITOR, NOT TWO. Every host embeds the
 * same editor rather than growing its own, and everything in this file is what
 * they all have to agree on: the slot shape, and the mapping between
 * `events.config` and the form.
 *
 * ⭐⭐ THIS FILE IS THE ONE PLACE `events.config` IS INTERPRETED FOR EDITING.
 * That is the whole point. The standing rule is that a host's own view model is
 * the only other reader of that blob — a second interpreter is how two
 * applications start disagreeing about what an event says. A shared editor does
 * not break the rule, it satisfies it: `fromConfig`/`toConfig` below are the
 * single writer, and every host uses them rather than parsing anything itself.
 *
 * ⛔ No behaviour changed in the extraction. Every function here was moved
 * verbatim from the screen it used to live in.
 */
import { DEFAULT_CROP_Y, MAX_SLIDES } from '@yespleez/event-presentation';

export function makeId() { return Math.random().toString(36).slice(2, 8); }

/**
 * ── ⚠ FIELDS THIS EDITOR DOES NOT OFFER MUST STILL SURVIVE IT ────────
 *
 * `labelColor` and `pinned` are written by the SET TIMES tab on the event page
 * (SlotEditModal's colour picker, and LOCK SLOT), which is a different surface
 * from this form. This form has no control for either, and the version of these
 * functions that rebuilt a slot from a fixed key list therefore DELETED both the
 * moment an organiser opened the editor to change something unrelated — a
 * silent loss of work they did elsewhere, with no way to notice until the
 * colours were gone.
 *
 * ⛔ Carried through CONDITIONALLY. A slot that never had them must round-trip
 * byte-identical, or every existing event gains two null keys on its next save.
 */
function carryUnedited(out, sl) {
  if (sl.labelColor) out.labelColor = sl.labelColor;
  if ('pinned' in sl) out.pinned = !!sl.pinned;
  return out;
}

/** Editor slot → stored slot. */
export function slotToSave(sl) {
  return carryUnedited({
    id: sl.id,
    time: `${parseInt(sl.hh || 8)}:${String(sl.mm || '00').padStart(2, '0')}`,
    ampm: sl.ampm || 'PM',
    dur: sl.dur || 60,
    label: sl.label || '',
  }, sl);
}

/** Stored slot → editor slot. */
export function slotToEdit(sl) {
  const [hh, mm] = (sl.time || '8:00').split(':');
  return carryUnedited({
    id: sl.id || makeId(),
    hh: hh || '8',
    mm: (mm || '00').padStart(2, '0'),
    ampm: sl.ampm || 'PM',
    dur: sl.dur || sl.duration || 60,
    label: sl.label || '',
  }, sl);
}

export function generateSlots(startTime, endTime, slotLenMins) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let cur = sh * 60 + (sm || 0), end = eh * 60 + (em || 0);
  if (end <= cur) end += 24 * 60;
  const slots = [];
  while (cur + slotLenMins <= end) {
    const h24 = Math.floor(cur / 60) % 24, m = cur % 60;
    slots.push({ id: makeId(), hh: String(h24 % 12 || 12), mm: String(m).padStart(2, '0'), ampm: h24 >= 12 ? 'PM' : 'AM', dur: slotLenMins, label: '' });
    cur += slotLenMins;
  }
  return slots;
}

/** The form's shape when nothing has been loaded. */
export function emptyEventForm() {
  return {
    name: '', startDate: '', endDate: '', venue: '', venueProfileId: null,
    venueTown: '', venueState: '', venuePostcode: '', venueRequest: false,
    locationWithheld: false, showAreaMap: false, genreText: '',
    categoryBadge: '', openMicBadge: false, ticketLink: '', bio: '',
    slides: [], poster: '', posterThumb: '', posterFull: '',
    posterCropY: DEFAULT_CROP_Y,
    setTimesNeeded: true,
    days: [{ id: makeId(), name: '', slots: [] }],
    isPublic: true, appsOpen: true,
    artistsCanRemove: true, showRankedBackup: true, showGenrePickers: true,
    privateSetTimes: true, showTimesPublicly: false,
    requiredItems: [],
  };
}

/**
 * An `events` row → the form's values.
 *
 * ⚠ The absent-vs-zero rules moved with the code and matter: a missing
 * `posterCropY` means "no choice was made", NOT 0 — reading it as 0 would
 * silently move every existing event's cover band to the top of its poster.
 * Likewise `required_items` is NULL or '{}' for "none declared".
 */
export function fromConfig(row) {
  const c = row?.config || {};
  const hc = c.host_controls_config || {};
  const loadedDays = (c.days || []).map(d => ({ id: makeId(), name: d.name || '', slots: (d.slots || []).map(slotToEdit) }));

  return {
    name: row?.name || '',
    startDate: c.date || '',
    endDate: c.endDate || '',
    venue: c.venue || '',
    // ⚠ From the ROW, not the config blob — venue_profile_id is a column. An
    // event saved before the venue picker existed has NULL here, which is
    // "not linked", and the picker opens on its search field accordingly.
    venueProfileId: row?.venue_profile_id || null,
    // The importer has always written these; the editor can now read and keep
    // them rather than dropping the town on the first save.
    venueTown: c.suburb || '',
    venueState: c.state || '',
    venuePostcode: c.postcode || '',
    /* ⚠ BOTH SPELLINGS. `eventViewModel` reads `locationWithheld` OR
       `location_withheld` — older rows carry the snake_case one, so a form that
       only knew the camelCase spelling would show "not secret" for an event
       that IS, and then write that back over it. */
    locationWithheld: c.locationWithheld === true || c.location_withheld === true,
    /* ⭐ THE PENDING VENUE. A real room YesPleez does not know about yet: the
       organiser has asked for it to become a catalogue venue, and Studio
       decides. Until then it behaves exactly like an event-only location — no
       profile, not searchable, no venue page — so the flag changes only what
       Studio sees, never what the public does.
       ⛔ Meaningless once `venue_profile_id` is set: a confirmed request IS the
       link, so the request cannot outlive its own approval. */
    venueRequest: c.venueRequest === true && !row?.venue_profile_id,
    /* Only meaningful while withheld; see eventViewModel's note. */
    showAreaMap: c.showAreaMap === true,
    genreText: c.genres || '',
    categoryBadge: c.categoryBadge || '',
    openMicBadge: c.openMicBadge || false,
    ticketLink: c.ticketLink || '',
    bio: c.bio || '',
    poster: c.poster || '',
    posterCropY: typeof c.posterCropY === 'number' ? c.posterCropY : DEFAULT_CROP_Y,
    // Rejoin the stored split into the one ordered list the editor shows.
    slides: [c.cover, ...(Array.isArray(c.gallery) ? c.gallery : [])]
      .filter(u => typeof u === 'string' && u.trim())
      .slice(0, MAX_SLIDES),
    posterThumb: c.poster_thumb || '',
    posterFull: c.poster_full || '',
    isPublic: row?.is_public !== false,
    appsOpen: row?.applications_open !== false,
    requiredItems: row?.required_items || [],
    /**
     * ⚠ THE ONE FORM FIELD THAT HAD NO ROUND TRIP, AND WHAT IT COST.
     *
     * `emptyEventForm()` defaults this true and `toConfig` reads it, but nothing
     * ever returned it here, so `hydrate` left the toggle at its default. An
     * event deliberately saved with NO running order (`days: []`) therefore
     * reloaded with set times switched back ON and the form's one blank day
     * still attached — and the next save wrote `days: [{name:'', slots:[]}]`.
     * A round trip silently turned "this gig has no running order" into a
     * phantom Day 1, and the organiser's decision was the thing lost.
     *
     * DERIVED, never stored: the schedule IS the answer to "are set times
     * needed", so asking the stored days is the only version that cannot
     * disagree with them. A separate boolean would be a second source of truth
     * for a question the data already answers.
     */
    setTimesNeeded: (c.days || []).length > 0,
    // ⛔ Stays `undefined` for an empty schedule — the form then keeps its own
    // blank day so there is somewhere to add a slot. That is a different
    // question from the toggle above, which is why both exist.
    days: loadedDays.length > 0 ? loadedDays : undefined,
    artistsCanRemove: hc.artistsCanRemove !== false,
    showRankedBackup: hc.showRankedBackup !== false,
    showGenrePickers: hc.showGenrePickers !== false,
    privateSetTimes: hc.privateSetTimes !== false,
    showTimesPublicly: hc.showTimesPublicly === true,
  };
}

/** The form's values → the `config` blob written to `events`. */
export function toConfig(v) {
  return {
    name: v.name, date: v.startDate, endDate: v.endDate, venue: v.venue,
    // ⚠ `suburb` IS THE KEY eventViewModel ALREADY READS (its locality ladder
    // is venueProfile.suburb → cfg.suburb). Writing anything else here would
    // store a town the page cannot find. postcode feeds geo.js's centroid, so
    // an unlisted venue still gets a town-level map.
    suburb: v.venueTown || null,
    state: v.venueState || null,
    postcode: v.venuePostcode || null,
    /* ⚠ ALWAYS A BOOLEAN, never null. `eventViewModel` tests `=== true`, and a
       secret location that saved as null would silently become public. Writing
       the camelCase key only is deliberate: it is the one the view model reads
       first, and emitting both would create two places to disagree. */
    locationWithheld: v.locationWithheld === true,
    /* ⚠ ALWAYS FALSE ONCE LINKED. Studio confirming a request sets
       `venue_profile_id`; leaving the flag true would keep the event in the
       review queue forever, asking to create a venue that now exists. */
    venueRequest: v.venueRequest === true && !v.venueProfileId,
    showAreaMap: v.locationWithheld === true && v.showAreaMap === true,
    genres: v.genreText,
    categoryBadge: v.categoryBadge || null,
    openMicBadge: v.openMicBadge || null,
    ticketLink: v.ticketLink, bio: v.bio,
    // Split back into what heroMedia's ladder reads. Slide 1 is the cover; the
    // rest are the gallery. An empty cover keeps existing events on the
    // poster-derived rungs exactly as before.
    cover: v.slides[0] || '', gallery: v.slides.slice(1),
    poster: v.poster, poster_thumb: v.posterThumb, poster_full: v.posterFull,
    // Only meaningful when there is a poster and no cover; harmless otherwise,
    // and kept so removing a cover restores the chosen band.
    posterCropY: v.poster ? v.posterCropY : null,
    is_public: v.isPublic, applications_open: v.appsOpen,
    days: v.setTimesNeeded ? v.days.map(d => ({ name: d.name, slots: d.slots.map(slotToSave) })) : [],
    host_controls_config: {
      artistsCanRemove: v.artistsCanRemove,
      showRankedBackup: v.showRankedBackup,
      showGenrePickers: v.showGenrePickers,
      privateSetTimes: v.privateSetTimes,
      showTimesPublicly: v.showTimesPublicly,
    },
  };
}
