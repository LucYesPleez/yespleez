/**
 * THE EVENT EDITOR'S DATA MODEL — pure, no React, no Supabase.
 *
 * ⭐ EXTRACTED SO THERE IS ONE EVENT EDITOR, NOT TWO. The Festival Companion
 * embeds the same editor rather than growing its own, and everything in this
 * file is what both sides have to agree on: the slot shape, and the mapping
 * between `events.config` and the form.
 *
 * ⭐⭐ THIS FILE IS THE ONE PLACE `events.config` IS INTERPRETED FOR EDITING.
 * That is the whole point. The standing rule is that nothing outside Scene's
 * `eventViewModel` reads that blob — a second reader in another app is how two
 * apps start disagreeing about what an event says. A shared editor does not
 * break the rule, it satisfies it: `fromConfig`/`toConfig` below are the single
 * writer, and Festival uses them rather than parsing anything itself.
 *
 * ⛔ No behaviour changed in the extraction. Every function here is the code
 * that was inline in CreateEventScreen, moved verbatim.
 */
import { DEFAULT_CROP_Y, MAX_SLIDES } from '@yespleez/event-presentation';

export function makeId() { return Math.random().toString(36).slice(2, 8); }

/** Editor slot → stored slot. */
export function slotToSave(sl) {
  return { id: sl.id, time: `${parseInt(sl.hh || 8)}:${String(sl.mm || '00').padStart(2, '0')}`, ampm: sl.ampm || 'PM', dur: sl.dur || 60, label: sl.label || '' };
}

/** Stored slot → editor slot. */
export function slotToEdit(sl) {
  const [hh, mm] = (sl.time || '8:00').split(':');
  return { id: sl.id || makeId(), hh: hh || '8', mm: (mm || '00').padStart(2, '0'), ampm: sl.ampm || 'PM', dur: sl.dur || sl.duration || 60, label: sl.label || '' };
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
    name: '', startDate: '', endDate: '', venue: '', genreText: '',
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
