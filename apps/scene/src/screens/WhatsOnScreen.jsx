import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { SkeletonRow, SkeletonEventCard } from '../components/Skeleton';
import { useNavigate } from 'react-router-dom';
import { useEvents } from '../lib/useEvents';
import { trackFiltered } from '../lib/analytics';
import { eventCoords, postcodeCoords, withinRadius } from '../lib/geo';
import { resolveLocationToPostcodes } from '../lib/auLocations';
import { today, dateStr, weekendRange, formatDisplayDate, localDateStr } from '../lib/dates';
import { selectFeaturedEvents, replayHistory, FAIRNESS_WINDOW_DAYS, FEATURED_SLOTS } from '../lib/featuredEvent';
import { useFeaturedAllocations } from '../lib/useFeaturedAllocations';
import { useTentativeDates } from '../lib/useTentativeDates';
import { useProfileLocation } from '../lib/useProfileLocation';
import { useSession } from '../App';
import FeaturedEventCard from '../components/FeaturedEventCard';
import HeartBtn from '../components/HeartBtn';
import { HEART_OVERLAY_STYLE, HEART_BARE_STYLE } from '../components/heartStyles';
import EventCard from '../components/EventCard';
import s from './WhatsOnScreen.module.css';
import { eventCategoryBadges } from '../lib/eventBadges';
import { eventCardImage } from '../lib/eventImage';
import { eventRunsOn, eventRunsOnAny, eventDates } from '../lib/eventDays';
import { useDragScroll } from '../hooks/useDragScroll';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES   = ['S','M','T','W','T','F','S'];

/* ⚠ The underlying list is NOT date-capped — the page size below is a reading
   limit, not a scope limit. */
/* COMING UP opens SHORT and grows on demand (owner, 2026-08-21).

   ⭐ SIX ROWS ARE RENDERED SO THAT FIVE AND A BIT ARE SEEN. The container is
   clipped to 5.5 rows, so the sixth is half-visible under a fade — the list
   says 'there is more' by showing some of it, which no button on its own can
   do. ⛔ Do not 'fix' the half row: it IS the affordance.

   The first press adds 6, every press after adds 10. Someone who taps once is
   usually still scanning; someone who taps twice has decided to read the lot,
   and making them tap six more times to get there is the actual annoyance.

   ⚠ 89px is MEASURED, not guessed: a 64px thumb, 12px padding top and bottom,
   and the 1px rule. If .comingRow's padding or thumb changes, this changes. */
/* ⭐ ONE WAY TO SEE MORE: the button appends the next 20 rows, in place.

   ⛔ DO NOT PUT THE 5.5-ROW SCROLL WINDOW BACK (owner, 2026-08-22: "add more
   show less button doesnt do anything"). With a fixed-height box around the
   list, ADD MORE appended rows below the fold of the box, so pressing it
   changed nothing you could see. The page scrolls; the section does not.

   ⚠ Every loaded row stays in the DOM. Fine into the low hundreds, and
   useEvents caps at 200 anyway; past that the answer is windowing, ⛔ not a
   bigger number here. */
const COMING_UP_INITIAL    = 20;
const COMING_UP_STEP       = 20;

/* Matches ANNOUNCED_CAP in lib/sceneFloor.js, where this section used to live. */
const JUST_ANNOUNCED_CAP = 8;

/* The hero rotation. Same numbers as My Scene's Spotlight rail — a reader
   moving between the two screens meets one rhythm, not two. */
const FEATURED_RAIL_GAP = 12;
const FEATURED_AUTOPLAY_MS = 3000;

const DATE_TABS = [
  { id: 'TONIGHT',   label: 'TONIGHT',    sub: "What's on now" },
  { id: 'WEEKEND',   label: 'WEEKEND',    sub: 'Fri – Sun' },
  { id: 'COMING UP', label: 'COMING UP',  sub: 'Next 2 weeks' },
  /* ⚠ NO `.toUpperCase()` HERE. Every other tab's sub is sentence case
     ("What's on now", "Fri – Sun", "Next 2 weeks") and this one shouted
     "AUGUST" beside them. The sub is the one line in this row the font does
     NOT already case for us — the labels above are Bebas Neue, which has no
     lowercase glyphs, so their caps are the typeface and not a choice. */
  { id: 'ALL',       label: 'THIS MONTH', sub: MONTH_NAMES[new Date().getMonth()] },
];

// FESTIVAL intentionally not offered as a Discover/What's On filter this
// release — see HOST_CATEGORIES in profileTaxonomy.js.
const CATEGORIES = ['ALL', 'DJ', 'BAND / LIVE', 'COMEDY', 'SPOKEN WORD'];


function matchesCategory(event, category) {
  if (category === 'ALL') return true;
  const cfg = event.config || {};
  const text = ((cfg.genres || '') + ' ' + (event.name || '')).toLowerCase();
  if (category === 'DJ')          return /dj|electronic|house|techno|drum.n.bass|dnb/.test(text);
  if (category === 'BAND / LIVE') return /band|live.music|folk|roots|rock|acoustic|singer|muso/.test(text);
  if (category === 'COMEDY')      return /comedy|standup|stand.up|open.mic/.test(text);
  if (category === 'SPOKEN WORD') return /spoken.word|poetry|slam/.test(text);
  if (category === 'MARKET')      return /market/.test(text);
  if (category === 'WORKSHOP')    return /workshop/.test(text);
  return true;
}

function buildDateStrip(year, month) {
  const days = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d);
    days.push({ d, day: DAY_NAMES[dt.getDay()], iso: `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` });
  }
  return days;
}

function useDateRange(tab) {
  return useMemo(() => {
    const t = today();
    if (tab === 'TONIGHT')   return { from: t, to: dateStr(14) };
    if (tab === 'WEEKEND')   return weekendRange();
    if (tab === 'COMING UP') return { from: t, to: dateStr(14) };
    return { from: t, to: dateStr(365) };
  }, [tab]);
}

function formatShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
}

function formatMedDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  const day = d.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase();
  const num = d.getDate();
  const mon = d.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase();
  return `${day} ${num} ${mon}`;
}

// ── Card components ──────────────────────────────────
// HeartBtn moved to components/HeartBtn.jsx so My Scene's catalogue floor
// shares the exact save interaction (one glyph, one `follows` row).

/**
 * THE PORTRAIT EVENT CARD — one design, app-wide.
 *
 * This was a local `WeekendCard`: a 210×260 tile with the poster bled to all
 * four edges and the name, venue and date laid over it under a gradient. My
 * Scene meanwhile used the shared EventCard's "scroll" variant — poster
 * confined to a band across the top, text on a solid panel beneath — so the
 * same event looked like two different products depending on the tab you were
 * standing in. Owner, 2026-07-31: "make them all look like the one inside my
 * scene. its a much cleaner card."
 *
 * So the local component is gone rather than restyled to match. Two lookalike
 * cards drift; one shared card cannot. The heart moves into EventCard's
 * `cornerAction` slot with the same overlay style My Scene uses.
 */
function PortraitEventCard({ event, onClick }) {
  return (
    <EventCard
      variant="scroll"
      event={event}
      onClick={onClick}
      /* Bare — this is a grid card, not a hero. The ring stays only on the
         FEATURED hero below, whose heart sits over poster artwork. */
      cornerAction={<HeartBtn event={event} style={HEART_BARE_STYLE} />}
    />
  );
}

function ComingUpRow({ event, onClick }) {
  const cfg    = event.config || {};
  // Cover first, poster as the fallback — see lib/eventImage.js.
  const poster = eventCardImage(event) || '';
  // The host's explicit chip beats auto-detection — see eventCategoryBadges.
  // This row used to call getEventBadges() alone and drop the chosen category.
  const badges = eventCategoryBadges(cfg, event.name);
  const genreList = (cfg.genres || '').split(',').map(g => g.trim()).filter(Boolean).slice(0, 2);

  return (
    <div className={s.comingRow} onClick={onClick}>
      <div className={s.comingThumb} style={poster ? { backgroundImage: `url(${poster})` } : {}} />
      <div className={s.comingInfo}>
        <div className={s.comingName}>{event.name}</div>
        {cfg.venue && (
          <div className={s.comingVenue}>
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 3 }}>
              <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>
            </svg>
            {cfg.venue}
          </div>
        )}
        {(badges.length > 0 || genreList.length > 0) && (
          <div className={s.comingTags}>
            {badges.map(b => <span key={b.label} className={s.comingBadge} style={{ background: b.bg, color: b.col }}>{b.label}</span>)}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
        <div className={s.comingDate}>{formatMedDate(cfg.date)}</div>
        <HeartBtn event={event} className={s.comingHeart} />
      </div>
    </div>
  );
}

// ── Main screen ──────────────────────────────────────

export default function WhatsOnScreen() {
  const navigate = useNavigate();
  const [dateTab,         setDateTab]         = useState('TONIGHT');
  const [category,        setCategory]        = useState('ALL');
  const [postcode,        setPostcode]        = useState('');
  const [radius,          setRadius]          = useState('50');
  /**
   * ⭐ THE PROFILE'S POSTCODE IS THE DEFAULT SEARCH AREA.
   *
   * What's On used to open with no location at all, so the person most likely
   * to want local events — someone who has already told us where they live —
   * had to type their own postcode in to get them. The profile answers that
   * question once, for the whole app, and ⛔ there is deliberately no What's On
   * specific location store to drift out of step with it.
   *
   * ⚠ SEEDS ONCE, AND NEVER FIGHTS THE TYPING. `seededRef` latches the moment
   * a value lands, so a late-arriving profile row cannot yank the field back to
   * the home town while somebody is halfway through looking somewhere else.
   * ⛔ Signed out this stays blank, which shows the whole guide — browsing must
   * never require a location.
   */
  const { session } = useSession() || {};
  const profilePostcode = useProfileLocation(session?.user?.id);
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !profilePostcode) return;
    seededRef.current = true;
    setPostcode(prev => prev || profilePostcode);
  }, [profilePostcode]);
  /* How many COMING UP rows are on screen. Grows by a page on ADD MORE, and resets whenever the
     filters change — a fresh filter is a fresh list, so it starts at the top again. */
  /* How many COMING UP rows are LOADED. The window shows 5.5 of them whatever
     this is; ADD MORE lengthens the scroll rather than the page. */
  const [comingUpShown, setComingUpShown] = useState(COMING_UP_INITIAL);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [pickerMonth,     setPickerMonth]     = useState(() => new Date(today()).getMonth());
  const [pickerYear,      setPickerYear]      = useState(() => new Date(today()).getFullYear());
  const todayIso = today();
  const [stripMonth,   setStripMonth]   = useState(() => { const d = new Date(todayIso); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [selectedDate, setSelectedDate] = useState(null);
  const stripRef     = useRef(null);
  const dragRef      = useRef({ dragging: false, startX: 0, scrollLeft: 0, moved: false });
  const tonightRef   = useRef(null);
  const weekendRef   = useRef(null);
  const comingUpRef  = useRef(null);
  const calRef       = useRef(null);

  function scrollToSection(id) {
    const map = { TONIGHT: tonightRef, WEEKEND: weekendRef, 'COMING UP': comingUpRef, ALL: calRef };
    const ref = map[id];
    if (ref?.current) setTimeout(() => {
      const top = ref.current.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, 50);
  }
  const chipsDrag    = useDragScroll('whatson-filter-chips');
  const weekendDrag1 = useDragScroll('whatson-weekend-1');
  const weekendDrag2 = useDragScroll('whatson-weekend-2');
  const announcedDrag = useDragScroll('whatson-just-announced');
  const featuredDrag  = useDragScroll('whatson-featured');
  /* The hero rotation's position, and whether a hand is on it. Mirrors My
     Scene's Spotlight rail exactly — same scroll handler, same autoplay,
     same dots — because it is the same interaction and a second dialect of
     it would be one more thing to keep in step. */
  const [featIndex,  setFeatIndex]  = useState(0);
  const [featPaused, setFeatPaused] = useState(false);
  const prefersReducedMotion = useMemo(
    () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  /* ⚠ One useDragScroll per rail, named rather than mapped: hooks must run in
     the same order every render, so they can never come out of a .map(). */

  const stripDays = useMemo(() => buildDateStrip(stripMonth.year, stripMonth.month), [stripMonth]);

  useEffect(() => {
    if (!stripRef.current) return;
    const todayBtn = stripRef.current.querySelector('[data-today="true"]');
    if (todayBtn) todayBtn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [stripDays]);

  function onStripMouseDown(e) {
    const el = stripRef.current; if (!el) return;
    dragRef.current = { dragging: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft, moved: false };
    el.style.cursor = 'grabbing';
  }
  function onStripMouseMove(e) {
    if (!dragRef.current.dragging) return;
    const el = stripRef.current; if (!el) return;
    const dx = (e.pageX - el.offsetLeft) - dragRef.current.startX;
    if (Math.abs(dx) > 4) dragRef.current.moved = true;
    el.scrollLeft = dragRef.current.scrollLeft - dx;
  }
  function onStripMouseUp() {
    if (!stripRef.current) return;
    stripRef.current.style.cursor = 'grab';
    dragRef.current.dragging = false;
  }

  // ⚠ No upper date bound here, deliberately. This used to be capped at 14
  // days ("for the 3-section layout"), but the calendar strip and THIS MONTH
  // tab both let you browse further out than that — a hard cutoff meant an
  // event dated day 15+ was invisible everywhere on this screen (calendar,
  // featured, all of it), not just missing from Coming Up. The `.limit(200)`
  // inside useEvents is the real safety net; Coming Up gets its OWN 14-day
  // cap below so its "Next 2 weeks" label stays true regardless.
  const { events: realEvents, loading } = useEvents(todayIso, null);
  // REAL EVENTS ONLY. The demo merge that used to pad this screen is gone — a thin scene now
  // shows as thin. Every card here is a record someone can actually open.
  const events = realEvents;

  /* Nights someone has pencilled in but not listed. Dots only — see
     lib/useTentativeDates.js for why they never become cards. */
  const { tentative, tentativeDaySet } = useTentativeDates();

  /* ⭐⭐ EVERY DAY THE EVENT OCCUPIES, not just the day it opens. A three-day
     festival marks three dots on the picker; it used to mark one, and the other
     two days looked empty while it was running. See lib/eventDays.js. */
  const eventDaySet = useMemo(() => {
    const set = new Set();
    events.forEach(ev => eventDates(ev).forEach(d => set.add(d)));
    return set;
  }, [events]);

  // When a specific date is selected, filter to the events RUNNING on it —
  // ⛔ not the events that START on it. Picking the Saturday of a Fri–Sun
  // festival used to return nothing.
  const dateFiltered = useMemo(() => {
    if (!selectedDate) return events;
    return events.filter(ev => eventRunsOn(ev, selectedDate));
  }, [events, selectedDate]);

  // Weekend range (Fri/Sat/Sun)
  const wr = useMemo(() => weekendRange(), []);
  const weekendDates = useMemo(() => {
    const dates = new Set();
    const fri = new Date(wr.from + 'T12:00:00');
    for (let i = 0; i < 3; i++) {
      const d = new Date(fri);
      d.setDate(d.getDate() + i);
      /* ⚠ THIS ONE WAS NOT BROKEN, AND THAT IS THE PROBLEM. The anchor is
         `wr.from + 'T12:00:00'` — local NOON — so the UTC slice landed on the
         right day for every timezone within ±12h. ⛔ Correct only by an
         invariant nobody stated, one edit away from silently becoming the same
         defect as the other four. `localDateStr` says what is meant, and the
         output is unchanged. */
      dates.add(localDateStr(d));
    }
    return dates;
  }, [wr]);

  /**
   * DISTANCE FILTERING — via the venue, and never by discarding the unknown.
   *
   * The origin is a postcode the user typed (or resolved from a town name).
   * The radius select only bites once there is an origin; until then it is
   * inert, so the screen behaves exactly as it did before anyone touches it.
   */
  const originPostcode = useMemo(() => {
    const t = String(postcode || '').trim();
    if (/^\d{4}$/.test(t)) return t;
    const codes = resolveLocationToPostcodes(t);
    return codes.length ? [...codes].sort()[0] : '';
  }, [postcode]);
  const originCoords = useMemo(() => postcodeCoords(originPostcode), [originPostcode]);
  const radiusKm     = originPostcode ? Number(radius) : null;

  /**
   * ⚠ UNKNOWN IS STILL NOT FAR — it is now simply INCLUDED.
   *
   * An event whose venue has no postcode is not far away, its distance is
   * merely unknown, and dropping it would have hidden 21 of 30 live events on
   * the day the radius shipped. Those events used to be quarantined under a
   * LOCATION UNAVAILABLE heading, which announced a gap in our data as though
   * it were a property of the gig: "Return 2 Resonance, Coffs Hinterland" is a
   * perfectly real night out, and "Coffs Hinterland" is a region rather than a
   * suburb, so it resolves to no postcode and never will.
   *
   * They now flow into the ordinary sections. ⚠ THE HONEST COST: an unplaced
   * event shows for EVERY search area, because we cannot say it is outside one.
   * At this catalogue size that is plainly better than hiding it; the real fix
   * is a postcode on the event, not a filter here.
   */
  const inRange = useCallback((ev) => {
    if (!radiusKm || !originCoords) return 'near';        // no radius = everything is "near"
    const c = eventCoords(ev, ev.venue);
    if (!c) return 'near';        // unplaceable, so never excluded by distance
    const pc = ev.venue_profile_id ? ev.venue?.postcode : ev.postcode;
    return withinRadius(originCoords, c, radiusKm, originPostcode, pc) ? 'near' : 'far';
  }, [radiusKm, originCoords, originPostcode]);

  const passes = useCallback(
    (ev) => matchesCategory(ev, category) && inRange(ev) === 'near',
    [category, inRange],
  );

  /**
   * ── THE FEATURED HERO ────────────────────────────────────────────────
   *
   * ⛔ This used to be `events.find(ev => ev.config?.featured)`. That took the
   * whole section dark from 16 Aug 2026: the one hand-set pick was dated
   * 15 Aug, `useEvents` drops anything before today, so `find` returned
   * undefined and the heading, the card and any fallback all vanished with it.
   * Nothing logged it. See lib/featuredEvent.js for the replacement's rules.
   *
   * ⚠ THE LEDGER IS SHARED; ONLY THE PICK IS CONTEXTUAL. `replayHistory` is
   * deliberately called with NO viewer location, so every client derives the
   * identical fairness history. If replay took the viewer's origin, two people
   * would disagree about how much exposure an event has had, and "fairly
   * distributed" would mean nothing. Location enters only in the live call
   * below, where it re-ranks today's candidates.
   */
  const fairnessFrom = useMemo(() => dateStr(-FAIRNESS_WINDOW_DAYS), []);
  const { allocations } = useFeaturedAllocations(fairnessFrom);

  /**
   * ⚠⚠ THE REPLAY NEEDS THE RECENT PAST, AND THIS IS WHY IT GETS ITS OWN POOL.
   *
   * `events` above starts at TODAY. Replaying the last 30 days over a
   * today-onwards list means every past day is contested only by events that
   * have not happened yet — so the gigs coming up this week absorb a month of
   * allocations they never actually held, and the hero jumps to whatever is
   * furthest away. Measured on the live catalogue: it pushed the pick from a
   * gig 3 days out to one 14 days out.
   *
   * ⭐ This second call is FREE. `useEvents` fetches one cached query keyed
   * ['events','all'] and filters by date in JS, so asking for a wider window
   * costs a filter, not a round trip.
   */
  const { events: featuredPool } = useEvents(fairnessFrom, null);
  const featuredHistory = useMemo(() => (
    allocations.length
      ? allocations
      : replayHistory({ events: featuredPool, fromIso: fairnessFrom, toIso: dateStr(-1) })
  ), [allocations, featuredPool, fairnessFrom]);

  /**
   * THREE CARDS, NOT ONE (fe3, 2026-08-24).
   *
   * Studio's queue takes as many of the three positions as it holds live
   * allocations for today; the ranking engine backfills the rest. ⛔ The
   * section is never manual-only: an empty queue must not be an empty hero,
   * which is the failure this whole module exists to prevent.
   */
  const featuredPicks = useMemo(() => selectFeaturedEvents({
    events: featuredPool,
    todayIso: todayIso,
    history: featuredHistory,
    originCoords,
    originPostcode,
    radiusKm,
    limit: FEATURED_SLOTS,
  }), [featuredPool, todayIso, featuredHistory, originCoords, originPostcode, radiusKm]);

  /** Which hero card is centred, for the position dots. */
  function onFeaturedScroll(e) {
    const el = e.currentTarget;
    const first = el.firstElementChild;
    if (!first) return;
    const step = first.getBoundingClientRect().width + FEATURED_RAIL_GAP;
    const idx = Math.max(0, Math.min(featuredPicks.length - 1, Math.round(el.scrollLeft / step)));
    setFeatIndex(prev => (prev === idx ? prev : idx));
  }

  function scrollFeaturedTo(i) {
    const el = featuredDrag.ref.current;
    const card = el?.children?.[i];
    if (!el || !card) return;
    // From the live boxes, not offsetLeft — these cards' offsetParent is not
    // the rail, so offsetLeft measures against the wrong element.
    el.scrollTo({ left: el.scrollLeft + card.getBoundingClientRect().left - el.getBoundingClientRect().left, behavior: 'smooth' });
  }

  /**
   * Autoplay, keyed on the INDEX so the timer restarts on every movement —
   * including the reader's. It advances a beat after things go still and never
   * yanks a rail a hand is already moving. Paused on hover/touch, off entirely
   * under prefers-reduced-motion.
   *
   * ⚠ MUST STAY BELOW `featuredPicks` — a dep array is evaluated during render,
   * and reading a const declared later throws before the screen can paint. My
   * Scene learned this the hard way with the identical rail.
   */
  useEffect(() => {
    if (featuredPicks.length < 2 || featPaused || prefersReducedMotion) return;
    const n = featuredPicks.length;
    const t = setTimeout(() => scrollFeaturedTo((featIndex + 1) % n), FEATURED_AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [featIndex, featPaused, featuredPicks.length, prefersReducedMotion]);
  /* ⭐⭐ THE THREE LANES BELOW ASK "IS IT ON?", ⛔ NEVER "DOES IT START?".
     A festival running Friday to Sunday is on all three days. Matching the
     start date alone listed it on Friday and dropped it on Saturday, which is
     why organisers were splitting one festival into one event per day.
     The lanes stay MUTUALLY EXCLUSIVE, in this order of precedence:
       TONIGHT      runs today (including a festival that opened yesterday)
       THIS WEEKEND runs on a weekend day still to come, and not today
       COMING UP    everything else upcoming
     ⛔ Without that precedence a Fri–Sun festival starting today would appear
     in all three at once — three cards for the one event, which is the very
     duplication this work exists to end. */
  const tonightEvents  = useMemo(() => events.filter(ev => eventRunsOn(ev, todayIso) && passes(ev)), [events, todayIso, passes]);
  // Weekend days STILL TO COME. Mid-weekend the range opens on a Friday that has
  // already been, so the nights gone drop out here rather than in each filter.
  const futureWeekendDates = useMemo(
    () => new Set([...weekendDates].filter(d => d > todayIso)),
    [weekendDates, todayIso]);
  const weekendEvents  = useMemo(() => events.filter(ev =>
    eventRunsOnAny(ev, futureWeekendDates) && !eventRunsOn(ev, todayIso) && passes(ev)),
    [events, futureWeekendDates, todayIso, passes]);
  /* ⚠ NOT DATE-CAPPED (owner, 2026-08-02). This used to cut at `d <= dateStr(14)` so the list
     could run dry while events existed just past the fortnight. The full upcoming list is kept
     here; only how much of it is ON SCREEN is limited, and ADD MORE lifts that limit. */
  const comingUpAll = useMemo(() => events.filter(ev => {
    const d = ev.config?.date;
    // Held by an earlier lane? Then it is not "coming up" — see the precedence
    // note above. Both checks span the whole run, not just the opening day.
    if (!d || eventRunsOn(ev, todayIso) || eventRunsOnAny(ev, futureWeekendDates)) return false;
    return passes(ev);
  }).sort((a, b) => (a.config?.date || '').localeCompare(b.config?.date || '')),
    [events, futureWeekendDates, todayIso, passes]);


  useEffect(() => { setComingUpShown(COMING_UP_INITIAL); }, [category, postcode, radius, selectedDate]);

  /* ONE limit: how many rows are rendered. ADD MORE raises it by 20 and the
     new rows appear directly under the last one. */
  const comingUpEvents = useMemo(() => comingUpAll.slice(0, comingUpShown), [comingUpAll, comingUpShown]);
  const comingUpHasMore = comingUpAll.length > comingUpEvents.length;
  /**
   * JUST ANNOUNCED — freshly added to the gig guide, moved here from My Scene.
   *
   * ⭐ This is event DISCOVERY, so it belongs on the browsing surface. My Scene
   * is the user's own scene; a gig nobody has heard of yet is exactly what they
   * have no relationship with.
   *
   * ⚠ DELIBERATELY NOT LOCATION FILTERED, which is the rule it arrived with:
   * venue coverage is thin, so a radius would empty this section on precisely
   * the newest rows, which are the least likely to have a placed venue yet.
   * The category chip still applies — that is a stated intent, not a guess
   * about geography.
   */
  const justAnnounced = useMemo(() => {
    const newSince = new Date(Date.now() - 14 * 86400000).toISOString();
    return events
      .filter(ev => matchesCategory(ev, category) && ev.created_at && ev.created_at >= newSince)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, JUST_ANNOUNCED_CAP);
  }, [events, category]);
  /* Back to the fortnight wording the section shipped with (owner, 2026-08-02). */
  const comingUpSub    = 'NEXT TWO WEEKS';
  const comingUpTabSub = 'Next 2 weeks';

  // A3 · DEMAND, from the highest-traffic surface in the app.
  //
  // Debounced because the postcode box fires per keystroke; the category chips
  // are instant but share the timer so a chip tap plus a typed postcode record
  // as ONE ask rather than two.
  //
  // ⚠ THE COUNT MUST STAY ON `realEvents`. Demo events were removed from this screen, so
  // `events` is real-only today and the distinction is currently moot — but the rule is not.
  // Scene Pulse compares demand against SUPPLY to decide what to import, and anything
  // fabricated is not supply. Counting padding would report "techno in Coffs: 5 events" where
  // there is one real one, silently destroying the exact signal this table exists to produce.
  // If any synthetic card ever returns to this screen, it does NOT come through here.
  //
  // Discovery 2.1 · postcode and radius now genuinely filter this screen, so
  // the region is reported as APPLIED (`location`) rather than `regionIntent`.
  // A typed location that resolves to nothing still cannot filter, so that one
  // case keeps the intent form — the rule is unchanged, only which branch a
  // given input lands in.
  useEffect(() => {
    if (loading) return;                   // a count taken mid-fetch is a lie
    const t = setTimeout(() => {
      const real = realEvents.filter(ev => matchesCategory(ev, category) && inRange(ev) === 'near');
      trackFiltered({
        surface: 'whats_on',
        category: category === 'ALL' ? null : category,
        ...(originPostcode
          ? { location: originPostcode, radiusKm: radiusKm || undefined }
          : { regionIntent: postcode }),
        results: real.length,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [category, postcode, originPostcode, radiusKm, loading, realEvents, inRange]);

  /* ONE WORD, AND IT NAMES WHAT IS ACTUALLY IN THE RAIL (owner, 2026-08-02).
     `weekendEvents` already excludes today, so by Saturday the only thing left in here IS
     Sunday — calling that "THIS WEEKEND" alongside a TONIGHT rail holding Saturday said the
     same thing twice. On Sunday the rail is empty and the whole block is hidden by its own
     `length > 0` guard, so no heading is needed for that case.
       Mon–Fri -> WEEKEND (Sat + Sun ahead)      Sat -> SUNDAY      Sun -> section hidden
     Two words also cost the row its only wrap: ALSO THIS WEEKEND measured 133.7px beside a
     100px pill in 185px of usable space at 320px. WEEKEND is 63.6px. */
  const isSaturday = useMemo(() => new Date().getDay() === 6, []);
  const weekendHeading = isSaturday ? 'SUNDAY' : 'WEEKEND';

  /* The pill matches the heading. Mon–Fri it carries the full Fri–Sun span (owner, 2026-08-02:
     the range describes the weekend, not what is left of it). On Saturday the heading already
     says SUNDAY, so repeating "FRI … – SUN …" underneath would state two different things at
     once; the pill narrows to that day's date, which is the one thing the heading does not
     carry. */
  const weekendLabel = useMemo(() => {
    const fri = new Date(wr.from + 'T12:00:00');
    const sun = new Date(fri); sun.setDate(sun.getDate() + 2);
    const mon = d => d.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase();
    if (isSaturday) return `${sun.getDate()} ${mon(sun)}`;
    const fmt = d => `${d.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase()} ${d.getDate()} ${mon(d)}`;
    return `${fmt(fri)} – ${fmt(sun)}`;
  }, [wr, isSaturday]);

  function openEvent(ev) {
    navigate(`/event/${ev.id}`);
  }

  function prevMonth() {
    setStripMonth(({ year, month }) => month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 });
  }
  function nextMonth() {
    setStripMonth(({ year, month }) => month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 });
  }

  return (
    <div className={s.screen}>
      <div style={{ height: 66 }} />

      <div className={s.hero}>
        <div className={s.heroTitle}>WHATS HAPPENIN'</div>
        <div className={s.heroSub}>Live music · Comedy · Events · Near you</div>
      </div>

      <div className={s.dateTabs}>
        {DATE_TABS.map(({ id, label, sub }) => {
          /* This tab scrolls to the COMING UP section, so it must not describe a different
             window than the heading it lands on — the module-level `sub` is the fortnight
             wording and only holds while the fortnight is the binding limit. */
          const subText = id === 'COMING UP' ? comingUpTabSub : sub;
          return (
            <button key={id} className={dateTab === id ? s.dateTabActive : s.dateTab}
              onClick={() => { setDateTab(id); setSelectedDate(null); if (id === 'ALL') setMonthPickerOpen(true); else scrollToSection(id); }}>
              <div className={s.dateTabLabel}>{label}</div>
              {subText && <div className={s.dateTabSub}>{subText}</div>}
            </button>
          );
        })}
      </div>

      {/* Calendar date strip */}
      <div ref={calRef} className={s.calWrap}>
        <div className={s.calHeader}>
          <button className={s.monthBtn} onClick={() => { setPickerMonth(stripMonth.month); setPickerYear(stripMonth.year); setMonthPickerOpen(true); }}>
            <span>{MONTH_NAMES[stripMonth.month]} {stripMonth.year}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div className={s.monthNav}>
            <button onClick={prevMonth}>←</button>
            <button onClick={nextMonth}>→</button>
          </div>
        </div>
        <div className={s.dateStrip} ref={stripRef}
          onMouseDown={onStripMouseDown} onMouseMove={onStripMouseMove}
          onMouseUp={onStripMouseUp} onMouseLeave={onStripMouseUp} style={{ cursor: 'grab' }}>
          {stripDays.map(({ d, day, iso }) => {
            const isToday    = iso === todayIso;
            const isSelected = iso === selectedDate;
            const hasEvent   = eventDaySet.has(iso);
            /* ⚠ A LISTED GIG ALWAYS WINS THE DOT. When a night has both, the
               solid dot is the true statement and the hollow one would only
               add noise — a tentative date beside a confirmed one changes
               nothing about whether something is on. */
            const hasTentative = !hasEvent && tentativeDaySet.has(iso);
            return (
              <button key={iso} data-today={isToday}
                className={isSelected ? s.stripDayActive : isToday ? s.stripDayToday : s.stripDay}
                onClick={() => { if (!dragRef.current.moved) setSelectedDate(prev => prev === iso ? null : iso); }}>
                <span className={s.stripDayName}>{day}</span>
                <span className={s.stripDayNum}>{d}</span>
                {hasEvent && <span className={s.stripDot} />}
                {hasTentative && <span className={s.stripDotTentative} title="Someone has pencilled in a night" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter row */}
      <div className={s.filterWrap}>
        <div className={s.chipLabel}>WHAT ARE YOU LOOKING FOR?</div>
        <div className={s.chips} ref={chipsDrag.ref} onMouseDown={chipsDrag.onMouseDown} onMouseMove={chipsDrag.onMouseMove} onMouseUp={chipsDrag.onMouseUp} onMouseLeave={chipsDrag.onMouseLeave} style={{ cursor:'grab' }}>
          <div className={s.postcodeWrap}>
            <input className={s.postcodeInput} type="text" inputMode="numeric" maxLength={4}
              placeholder="📍 Town/City" value={postcode} onChange={e => setPostcode(e.target.value)} autoComplete="off" />
          </div>
          {/* Shown once the typed text resolves to somewhere real — a town
              name works as well as a 4-digit postcode. */}
          {!!originPostcode && (
            <select className={s.radiusSelect} value={radius} onChange={e => setRadius(e.target.value)}>
              {['0','5','25','50','100','200'].map(r => <option key={r} value={r}>{r} km</option>)}
            </select>
          )}
          {CATEGORIES.map(cat => (
            // Only the selected chip is active. The old `|| category === 'ALL'`
            // lit every chip on the default view, so the screen opened looking
            // like all five categories were selected at once.
            <button key={cat} className={category === cat ? s.chipActive : s.chip} onClick={() => setCategory(cat)}>{cat}</button>
          ))}
        </div>
      </div>

      {/* Month picker modal */}
      {monthPickerOpen && (
        <>
          <div className={s.pickerOverlay} onClick={() => setMonthPickerOpen(false)} />
          <div className={s.pickerModal}>
            <div className={s.pickerHandle} />
            <div className={s.pickerSelects}>
              <select className={s.pickerSelect} value={pickerMonth} onChange={e => setPickerMonth(+e.target.value)}>
                {MONTH_NAMES.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select>
              <select className={s.pickerSelectYear} value={pickerYear} onChange={e => setPickerYear(+e.target.value)}>
                {[2024,2025,2026,2027,2028].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className={s.pickerNav}>
              <button onClick={() => { if (pickerMonth === 0) { setPickerMonth(11); setPickerYear(y => y-1); } else setPickerMonth(m => m-1); }}>←</button>
              <span className={s.pickerNavLabel}>{MONTH_NAMES[pickerMonth]} {pickerYear}</span>
              <button onClick={() => { if (pickerMonth === 11) { setPickerMonth(0); setPickerYear(y => y+1); } else setPickerMonth(m => m+1); }}>→</button>
            </div>
            <div className={s.pickerDayHeaders}>
              {['S','M','T','W','T','F','S'].map((d,i) => <div key={i}>{d}</div>)}
            </div>
            <div className={s.pickerGrid}>
              {(() => {
                const firstDay = new Date(pickerYear, pickerMonth, 1).getDay();
                const daysInMonth = new Date(pickerYear, pickerMonth+1, 0).getDate();
                const pickerMonthStr = `${pickerYear}-${String(pickerMonth+1).padStart(2,'0')}`;
                const cells = [];
                for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} />);
                for (let d = 1; d <= daysInMonth; d++) {
                  const iso = `${pickerMonthStr}-${String(d).padStart(2,'0')}`;
                  const isToday = iso === todayIso;
                  const hasDot  = eventDaySet.has(iso);
                  const cls = isToday ? s.pickerDayToday : hasDot ? s.pickerDayEvent : s.pickerDay;
                  cells.push(
                    <button key={d} className={cls}
                      onClick={() => { if (hasDot || isToday) { setSelectedDate(iso); setStripMonth({ year: pickerYear, month: pickerMonth }); setMonthPickerOpen(false); } }}>
                      {d}
                      {hasDot ? <span style={{ width:4, height:4, borderRadius:'50%', background: isToday ? 'var(--neon2)' : '#FF2D78', display:'block', flexShrink:0 }} /> : <span style={{ width:4, height:4, display:'block' }} />}
                    </button>
                  );
                }
                return cells;
              })()}
            </div>
          </div>
        </>
      )}

      {/* ── Event sections ── */}
      {loading && (
        <div className={s.list}>
          {[0,1,2,3].map(i => <SkeletonRow key={i} />)}
        </div>
      )}

      {/* Date-specific view */}
      {!loading && selectedDate && (
        <div className={s.list}>
          <div className={s.sectionHead}>
            <button className={s.backBtn} onClick={() => setSelectedDate(null)}>← BACK</button>
            <span className={s.sectionHeadDate}>{formatShortDate(selectedDate)}</span>
          </div>
          {dateFiltered.length === 0
            ? <div className={s.emptyDay}><div className={s.emptyDayTitle}>NOTHING ANNOUNCED YET</div><div className={s.emptyDaySub}>No events for this date.</div></div>
            : dateFiltered.map(ev => <ComingUpRow key={ev.id} event={ev} onClick={() => openEvent(ev)} />)
          }

          {/* ── PENCILLED IN ────────────────────────────────────────────
              ⛔ TEXT, NEVER A CARD. Owner, 2026-08-21: "i dont want event
              cards until they make an actual event for it." A card carries a
              poster frame, a tap target and an implied event page, and this
              has none of the three — it is one promoter saying a night might
              be theirs. Rendering it as a listing would announce something
              nobody has announced.

              ⚠ Title only. `notes` never leaves the database (see the pe2
              view), so there is nothing here to leak. */}
          {(() => {
            const pencilled = tentative.filter(t => t.event_date === selectedDate);
            if (!pencilled.length) return null;
            return (
              <div style={{ marginTop: dateFiltered.length ? 18 : 0, padding: '12px 14px', border: '1px dashed rgba(185,128,255,.35)', borderRadius: 12 }}>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 12, letterSpacing: 2, color: '#BF5FFF', marginBottom: 6 }}>
                  PENCILLED IN
                </div>
                {pencilled.map(t => (
                  <div key={t.id} style={{ fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>{t.title}</div>
                ))}
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
                  Not yet announced. Details may change or may never be listed.
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Main 3-section view */}
      {!loading && !selectedDate && (
        <div className={s.sections}>

          {/* ⚠ EVERY `s.sectionTitle` SPAN BELOW ALSO CARRIES
              `data-tour="whatson-section"` — the guided tour's What's On step
              scrolls the real page from waypoint to waypoint (heading →
              Featured Event → each section that has content right now), and
              finds those waypoints by querying this one shared attribute
              rather than hardcoding which sections exist. Each section here
              is already conditionally rendered on having events, so the
              query result IS "each sub heading that's available at the
              time" with no extra logic — add a new section the same way
              (conditional block, `sectionTitle` span, this attribute) and
              the tour picks it up with no code change on its side. */}
          {/* FEATURED EVENT */}
          {featuredPicks.length > 0 && (
            <div className={s.sectionBlock}>
              <div style={{ marginBottom: 12 }}>
                <span data-tour="whatson-section" className={s.sectionTitle}>
                  {featuredPicks.length > 1 ? 'FEATURED EVENTS' : 'FEATURED EVENT'}
                </span>
              </div>
              {/* The featured hero was the ONE event card in the app you could
                  not save from — every other card here and on My Scene carries
                  the heart, and this is the most prominent gig on the page. */}
              {/* ⛔ A PAID PLACEMENT IS NEVER DRESSED AS AN ORGANIC ONE. The
                  badge is this app's existing disclosure convention, so a
                  promoted pick says so in the same place every other card
                  states its reason. */}
              {/* ⚠ snap is PROXIMITY, not mandatory — useDragScroll writes
                  scrollLeft on every mousemove and mandatory snapping fights
                  that write for the whole drag. Same reasoning as Spotlight. */}
              <div style={{ position:'relative' }}
                onMouseEnter={() => setFeatPaused(true)}
                onMouseLeave={() => setFeatPaused(false)}
                onTouchStart={() => setFeatPaused(true)}>
                <div className={s.weekendScroll} style={{ scrollSnapType:'x proximity', gap: FEATURED_RAIL_GAP }}
                  ref={featuredDrag.ref} onScroll={onFeaturedScroll}
                  onMouseDown={featuredDrag.onMouseDown} onMouseMove={featuredDrag.onMouseMove}
                  onMouseUp={featuredDrag.onMouseUp} onMouseLeave={featuredDrag.onMouseLeave}>
                  {featuredPicks.map(pick => (
                    <FeaturedEventCard key={pick.event.id} event={pick.event}
                      onClick={() => openEvent(pick.event)}
                      label={pick.selectionType === 'promoted' ? 'PROMOTED' : 'FEATURED'}
                      rail solo={featuredPicks.length === 1}
                      cornerAction={<HeartBtn event={pick.event} style={HEART_OVERLAY_STYLE} />} />
                  ))}
                </div>
              </div>
              {/* Position dots — the rail says how much there is before you
                  touch it, and on a desktop mouse they are the only way to
                  move it other than dragging. */}
              {featuredPicks.length > 1 && (
                <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:7, marginTop:8 }}>
                  {featuredPicks.map((pick, i) => (
                    <button key={pick.event.id}
                      onClick={() => scrollFeaturedTo(i)}
                      aria-label={`Featured ${i + 1} of ${featuredPicks.length}`}
                      style={{
                        width: i === featIndex ? 20 : 7, height: 7, padding: 0,
                        borderRadius: 4, border: 'none', cursor: 'pointer',
                        background: i === featIndex ? 'var(--neon2)' : 'rgba(255,255,255,.22)',
                        transition: 'width .22s ease, background .22s ease',
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TONIGHT */}
          {tonightEvents.length > 0 && (
            <div ref={tonightRef} className={s.sectionBlock}>
              <div className={s.sectionRow}>
                <span data-tour="whatson-section" className={s.sectionTitle}>TONIGHT</span>
                <span className={s.sectionPill}>
                  {new Date(todayIso + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long' }).toUpperCase()}
                </span>
                <div className={s.gradientLine} />
                <button className={s.viewAll}>View all ›</button>
              </div>
              <div className={s.weekendScroll} ref={weekendDrag1.ref} onMouseDown={weekendDrag1.onMouseDown} onMouseMove={weekendDrag1.onMouseMove} onMouseUp={weekendDrag1.onMouseUp} onMouseLeave={weekendDrag1.onMouseLeave} style={{ cursor:'grab' }}>
                {tonightEvents.map(ev => (
                  <PortraitEventCard key={ev.id} event={ev} onClick={() => openEvent(ev)} />
                ))}
              </div>
            </div>
          )}

          {/* THIS WEEKEND */}
          {weekendEvents.length > 0 && (
            <div ref={weekendRef} className={s.sectionBlock}>
              <div className={s.sectionRow}>
                <span data-tour="whatson-section" className={s.sectionTitle}>{weekendHeading}</span>
                <span className={s.sectionPill}>{weekendLabel}</span>
                <div className={s.gradientLine} />
                <button className={s.viewAll}>View all ›</button>
              </div>
              <div className={s.weekendScroll} ref={weekendDrag2.ref} onMouseDown={weekendDrag2.onMouseDown} onMouseMove={weekendDrag2.onMouseMove} onMouseUp={weekendDrag2.onMouseUp} onMouseLeave={weekendDrag2.onMouseLeave} style={{ cursor:'grab' }}>
                {weekendEvents.map(ev => (
                  <PortraitEventCard key={ev.id} event={ev} onClick={() => openEvent(ev)} />
                ))}
              </div>
            </div>
          )}
          {/* JUST ANNOUNCED — moved out of My Scene. See the memo above for
              why it carries no radius. */}
          {justAnnounced.length > 0 && (
            <div className={s.sectionBlock}>
              <div className={s.sectionRow}>
                <span data-tour="whatson-section" className={s.sectionTitle}>JUST ANNOUNCED</span>
                <span className={s.sectionSub}>FRESHLY ADDED</span>
                <div className={s.gradientLine} />
              </div>
              <div className={s.weekendScroll} ref={announcedDrag.ref}
                onMouseDown={announcedDrag.onMouseDown} onMouseMove={announcedDrag.onMouseMove}
                onMouseUp={announcedDrag.onMouseUp} onMouseLeave={announcedDrag.onMouseLeave}>
                {justAnnounced.map(ev => (
                  <PortraitEventCard key={ev.id} event={ev} onClick={() => openEvent(ev)} />
                ))}
              </div>
            </div>
          )}


          {/* COMING UP */}
          {comingUpEvents.length > 0 && (
            <div ref={comingUpRef} className={s.sectionBlock}>
              <div className={s.sectionRow}>
                <span data-tour="whatson-section" className={s.sectionTitle}>COMING UP</span>
                <span className={s.sectionSub}>{comingUpSub}</span>
                <div className={s.gradientLine} />
                <button className={s.viewAll}>View all ›</button>
              </div>
              {/* ⛔ NO INNER SCROLL WINDOW. It capped the section at 5.5 rows,
                  so ADD MORE appended rows nobody could see and the button
                  read as broken (owner, 2026-08-22). The list grows in place;
                  the page scrolls, not a box inside it. */}
              <div>
                {comingUpEvents.map(ev => (
                  <ComingUpRow key={ev.id} event={ev} onClick={() => openEvent(ev)} />
                ))}
              </div>
              {/* ⛔ NO INERT / "Show less" STATE. A control that is present but
                  changes nothing reads as broken, which is exactly the report
                  this replaced. Once everything is shown there is nothing to
                  add, so the button goes. */}
              {comingUpHasMore && (
                <button
                  className={s.addMore}
                  onClick={() => setComingUpShown(n => n + COMING_UP_STEP)}
                >
                  <span className={s.addMoreLabel}>Add more</span>
                </button>
              )}
            </div>
          )}

          {/* ⛔ LOCALS IS GONE FROM THIS SCREEN (owner, 2026-08-21) — it lives on
              Discover now, under RECENTLY ADDED EVENTS, as components/LocalsRails.
              Third home; the component note carries the lineage. */}
          {/* ⛔ THIS USED TO READ `!featuredEvent && !loading`, WHICH IS A
              DIFFERENT QUESTION. "Is one event featured?" is not "are there
              any events?", and once the hand-set featured pick expired on
              15 Aug 2026 this line printed "No upcoming events." at the foot
              of a page listing nineteen of them. Ask what is actually being
              asserted: nothing rendered above. */}
          {!loading && featuredPicks.length === 0 && tonightEvents.length === 0
            && weekendEvents.length === 0 && comingUpAll.length === 0
            && justAnnounced.length === 0 && (
            <p className={s.empty}>No upcoming events.</p>
          )}
        </div>
      )}

    </div>
  );
}
