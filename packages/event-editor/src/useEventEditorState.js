import { useState, useRef, useCallback } from 'react';
import { useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { uploadPosterCrop } from '../../lib/uploadImage';
import { MAX_SLIDES } from '@yespleez/event-presentation';
import { makeId, emptyEventForm, fromConfig, toConfig } from './eventEditorModel';

/**
 * ALL OF THE EVENT EDITOR'S FORM STATE, in one place and owned by the caller.
 *
 * ⭐ WHY THIS EXISTS: `CreateEventScreen` was a screen, not a component — it
 * fetched, transformed, rendered, saved, navigated and deleted, with 45 pieces
 * of state in its body. Nothing could embed it. Splitting the plumbing from the
 * form is what lets Festival Companion render the IDENTICAL editor instead of
 * growing a second one.
 *
 * ⛔ EXTRACTION ONLY. Every hook, default, clamp and comment below is the code
 * that was inline in CreateEventScreen, moved unchanged. No features, no
 * redesign, no workflow change.
 *
 * The consumer keeps routing, session, loading and saving. This keeps the form.
 *
 * @param {object}  opts
 * @param {?string} opts.userId  needed only to name uploaded crops
 */
export function useEventEditorState({ userId } = {}) {
  const init = emptyEventForm();

  // ── Event details ────────────────────────────────────────────────────
  const [name, setName] = useState(init.name);
  const [startDate, setStartDate] = useState(init.startDate);
  const [endDate, setEndDate] = useState(init.endDate);
  const [venue, setVenue] = useState(init.venue);
  const [genreText, setGenreText] = useState(init.genreText);
  const [categoryBadge, setCategoryBadge] = useState(init.categoryBadge);
  const [openMicBadge, setOpenMicBadge] = useState(init.openMicBadge);
  const [ticketLink, setTicketLink] = useState(init.ticketLink);
  const [bio, setBio] = useState(init.bio);

  /**
   * THE CAROUSEL, as one ordered list — which is how it reads on the page and
   * how an organiser thinks about it. Slide 1 is the cover; the rest follow.
   * Stored split (cfg.cover + cfg.gallery[]) because that is what heroMedia's
   * ladder takes, and rung 2 (cover, no gallery) has to stay distinguishable
   * from rung 1. The split/rejoin lives in eventEditorModel.
   */
  const [slides, setSlides] = useState(init.slides);
  const [poster, setPoster] = useState(init.poster);
  const [posterThumb, setPosterThumb] = useState(init.posterThumb);
  const [posterFull, setPosterFull] = useState(init.posterFull);
  // Which horizontal slice of the poster becomes the Hero when there is no
  // Cover — spec §0.4. 0–100, the same scale `object-position` uses.
  const [posterCropY, setPosterCropY] = useState(init.posterCropY);
  const [posterDims, setPosterDims] = useState(null);   // natural w/h, for the crop geometry
  // How many times narrower than the poster the crop window is. 1 = full
  // width; larger = zoomed in.
  const [cropZoom, setCropZoom] = useState(1);
  const [cropX, setCropX] = useState(50);
  const [cropMode, setCropMode] = useState(false);
  // 8px before a drag starts, so a tap on a tile (or its ✕) is still a tap.
  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [mediaTab, setMediaTab] = useState('cover');
  const [cropBusy, setCropBusy] = useState(false);
  const [cropError, setCropError] = useState('');
  const [fullView, setFullView] = useState(false);
  const cropRef = useRef(null);
  const dragState = useRef(null);

  // ── Schedule ─────────────────────────────────────────────────────────
  const [setTimesNeeded, setSetTimesNeeded] = useState(init.setTimesNeeded);
  const [days, setDays] = useState(init.days);
  const [slotsCollapsed, setSlotsCollapsed] = useState(false);

  // ── Ownership and co-hosts ───────────────────────────────────────────
  const [owners, setOwners] = useState([]);
  const [ownerId, setOwnerId] = useState(null);
  const [coHosts, setCoHosts] = useState([]);

  // ── Host controls ────────────────────────────────────────────────────
  const [isPublic, setIsPublic] = useState(init.isPublic);
  const [appsOpen, setAppsOpen] = useState(init.appsOpen);
  const [artistsCanRemove, setArtistsCanRemove] = useState(init.artistsCanRemove);
  const [showRankedBackup, setShowRankedBackup] = useState(init.showRankedBackup);
  const [showGenrePickers, setShowGenrePickers] = useState(init.showGenrePickers);
  const [privateSetTimes, setPrivateSetTimes] = useState(init.privateSetTimes);
  const [showTimesPublicly, setShowTimesPublicly] = useState(init.showTimesPublicly);
  const [showHostInfo, setShowHostInfo] = useState(false);
  // P4 · requirement keys the host ticked. A real `events` column, NOT part of
  // `config` — config is the public event page's payload and requirements are
  // never rendered there.
  const [requiredItems, setRequiredItems] = useState(init.requiredItems);

  /* ── The crop rectangle over the poster ─────────────────────────────
     A 3:2 window the organiser sizes and moves. Percentages of the POSTER's own
     displayed box, so nothing needs measuring and the overlay cannot drift from
     what the browser lays out. Position travels the LEFTOVER space, exactly
     like object-position. */
  const cropGeom = (() => {
    if (!poster || !posterDims?.w || !posterDims?.h) return null;
    const { w, h } = posterDims;
    // A wide poster cannot hold a full-width 3:2 slice — it would be taller
    // than the image — so its minimum zoom is above 1 rather than the crop
    // being refused.
    const minZoom = Math.max(1, (2 * w) / (3 * h));
    const maxZoom = 4;
    const zoom = Math.min(maxZoom, Math.max(minZoom, cropZoom));
    const wPct = 100 / zoom;
    const hPct = ((2 / 3) * (w / h) * 100) / zoom;
    if (hPct > 100.01) return null;            // unreachable after the clamp; guards a bad dim read
    return {
      minZoom, maxZoom, zoom, wPct, hPct,
      leftPct: (100 - wPct) * (cropX / 100),
      topPct: (100 - hPct) * (posterCropY / 100),
      canMoveX: wPct < 99.9,
      canMoveY: hPct < 99.9,
    };
  })();

  // Whether the LIVE hero band (posterCropY driving object-position) still
  // describes what the organiser sees. It only can at full width — a zoomed
  // rectangle is not expressible as `object-position` on the original poster.
  const bandMatchesHero = !!cropGeom && cropGeom.wPct > 99.9;

  function startCropDrag(e) {
    if (!cropGeom) return;
    const touch = e.touches?.[0];
    if (!touch) e.preventDefault();
    const box = cropRef.current.getBoundingClientRect();
    const t = touch || e;
    dragState.current = {
      startX: t.clientX, startY: t.clientY,
      startCropX: cropX, startCropY: posterCropY,
      w: box.width, h: box.height,
    };

    const move = ev => {
      const c = ev.touches?.[0] || ev;
      const d = dragState.current;
      // Travel is the leftover space, not the whole poster.
      const travelX = d.w * (100 - cropGeom.wPct) / 100;
      const travelY = d.h * (100 - cropGeom.hPct) / 100;
      if (travelX > 0) {
        const nx = d.startCropX + ((c.clientX - d.startX) / travelX) * 100;
        setCropX(Math.min(100, Math.max(0, Math.round(nx))));
      }
      if (travelY > 0) {
        const ny = d.startCropY + ((c.clientY - d.startY) / travelY) * 100;
        setPosterCropY(Math.min(100, Math.max(0, Math.round(ny))));
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
  }

  /* Keep the rectangle showing right now as a carousel image. It stays put
     afterwards — the organiser is usually about to move to the next thing they
     want, and resetting would make them find their place again. */
  async function keepCrop() {
    if (!poster || !cropGeom || cropBusy || slides.length >= MAX_SLIDES) return;
    setCropBusy(true);
    setCropError('');
    try {
      const { url } = await uploadPosterCrop(
        poster,
        { zoom: cropGeom.zoom, x: cropX, y: posterCropY },
        userId,
        makeId(),
      );
      setSlides(s => [...s, url].slice(0, MAX_SLIDES));
    } catch (err) {
      console.error('Poster crop failed', err);
      setCropError('Could not save that crop. Try again.');
    } finally {
      setCropBusy(false);
    }
  }

  // ── Days and slots ───────────────────────────────────────────────────
  function addDay() { setDays(p => [...p, { id: makeId(), name: '', slots: [] }]); }
  function removeDay(id) { setDays(p => p.filter(d => d.id !== id)); }
  function updateDayName(id, name) { setDays(p => p.map(d => d.id === id ? { ...d, name } : d)); }
  // 1 hr to match the Quick Generator's own default (19:00–23:00 @ 60 min) — a
  // manually added slot shouldn't default to a different length than the
  // generated ones sitting next to it.
  function addSlot(dayId) { setDays(p => p.map(d => d.id !== dayId ? d : { ...d, slots: [...d.slots, { id: makeId(), hh: '8', mm: '00', ampm: 'PM', dur: 60, label: '' }] })); }
  function insertSlot(dayId, at) {
    setDays(p => p.map(d => {
      if (d.id !== dayId) return d;
      const slots = [...d.slots];
      slots.splice(at, 0, { id: makeId(), hh: '8', mm: '00', ampm: 'PM', dur: 60, label: '' });
      return { ...d, slots };
    }));
  }
  function updateSlot(dayId, slotId, field, value) {
    setDays(p => p.map(d => d.id !== dayId ? d : { ...d, slots: d.slots.map(sl => sl.id === slotId ? { ...sl, [field]: value } : sl) }));
  }
  function removeSlot(dayId, slotId) {
    setDays(p => p.map(d => d.id !== dayId ? d : { ...d, slots: d.slots.filter(sl => sl.id !== slotId) }));
  }

  /**
   * Fill the form from an `events` row.
   *
   * ⚠ `days` is only replaced when the row actually has some — an event saved
   * with no schedule keeps the one blank day the form starts with, rather than
   * rendering zero days and no way to add one. That conditional was in the
   * original load effect and is preserved here.
   */
  const hydrate = useCallback(row => {
    const v = fromConfig(row);
    setName(v.name);
    setStartDate(v.startDate);
    setEndDate(v.endDate);
    setVenue(v.venue);
    setGenreText(v.genreText);
    setCategoryBadge(v.categoryBadge);
    setOpenMicBadge(v.openMicBadge);
    setTicketLink(v.ticketLink);
    setBio(v.bio);
    setPoster(v.poster);
    setPosterCropY(v.posterCropY);
    setSlides(v.slides);
    setPosterThumb(v.posterThumb);
    setPosterFull(v.posterFull);
    setIsPublic(v.isPublic);
    setAppsOpen(v.appsOpen);
    setRequiredItems(v.requiredItems);
    if (v.days) setDays(v.days);
    setArtistsCanRemove(v.artistsCanRemove);
    setShowRankedBackup(v.showRankedBackup);
    setShowGenrePickers(v.showGenrePickers);
    setPrivateSetTimes(v.privateSetTimes);
    setShowTimesPublicly(v.showTimesPublicly);
  }, []);

  /** Everything the form currently holds, as one plain object. */
  const value = {
    name, startDate, endDate, venue, genreText, categoryBadge, openMicBadge,
    ticketLink, bio, slides, poster, posterThumb, posterFull, posterCropY,
    setTimesNeeded, days, isPublic, appsOpen, artistsCanRemove,
    showRankedBackup, showGenrePickers, privateSetTimes, showTimesPublicly,
    requiredItems, ownerId, owners, coHosts,
  };

  return {
    // values + setters, named exactly as they were in the screen so the JSX
    // that consumes them did not have to change during the extraction
    name, setName, startDate, setStartDate, endDate, setEndDate,
    venue, setVenue, genreText, setGenreText,
    categoryBadge, setCategoryBadge, openMicBadge, setOpenMicBadge,
    ticketLink, setTicketLink, bio, setBio,
    slides, setSlides, poster, setPoster, posterThumb, setPosterThumb,
    posterFull, setPosterFull, posterCropY, setPosterCropY,
    posterDims, setPosterDims, cropZoom, setCropZoom, cropX, setCropX,
    cropMode, setCropMode, mediaTab, setMediaTab, cropBusy, setCropBusy,
    cropError, setCropError, fullView, setFullView,
    setTimesNeeded, setSetTimesNeeded, days, setDays,
    slotsCollapsed, setSlotsCollapsed,
    owners, setOwners, ownerId, setOwnerId, coHosts, setCoHosts,
    isPublic, setIsPublic, appsOpen, setAppsOpen,
    artistsCanRemove, setArtistsCanRemove,
    showRankedBackup, setShowRankedBackup,
    showGenrePickers, setShowGenrePickers,
    privateSetTimes, setPrivateSetTimes,
    showTimesPublicly, setShowTimesPublicly,
    showHostInfo, setShowHostInfo,
    requiredItems, setRequiredItems,

    // refs and derived
    cropRef, dragState, dragSensors, cropGeom, bandMatchesHero,

    // actions
    startCropDrag, keepCrop,
    addDay, removeDay, updateDayName,
    addSlot, insertSlot, updateSlot, removeSlot,

    // the two halves of the config contract
    hydrate,
    value,
    toConfig: () => toConfig(value),
  };
}
