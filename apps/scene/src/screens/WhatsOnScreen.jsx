import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { SkeletonRow, SkeletonEventCard } from '../components/Skeleton';
import { useNavigate } from 'react-router-dom';
import { useEvents } from '../lib/useEvents';
import { trackFiltered } from '../lib/analytics';
import { eventCoords, postcodeCoords, withinRadius } from '../lib/geo';
import { resolveLocationToPostcodes } from '../lib/auLocations';
import { today, dateStr, weekendRange, formatDisplayDate, localDateStr } from '../lib/dates';
import FeaturedEventCard from '../components/FeaturedEventCard';
import HeartBtn from '../components/HeartBtn';
import { HEART_OVERLAY_STYLE, HEART_BARE_STYLE } from '../components/heartStyles';
import EventCard from '../components/EventCard';
import s from './WhatsOnScreen.module.css';
import { eventCategoryBadges } from '../lib/eventBadges';
import { eventCardImage } from '../lib/eventImage';
import { useDragScroll } from '../hooks/useDragScroll';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES   = ['S','M','T','W','T','F','S'];

/* COMING UP shows 20 rows at a time and grows by 20 on ADD MORE (owner, 2026-08-02). The
   underlying list is NOT date-capped — the page size is a reading limit, not a scope limit. */
const COMING_UP_PAGE = 20;

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
  /* How many COMING UP rows are on screen. Grows by a page on ADD MORE, and resets whenever the
     filters change — a fresh filter is a fresh list, so it starts at the top again. */
  const [comingUpShown,   setComingUpShown]   = useState(COMING_UP_PAGE);
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

  const eventDaySet = useMemo(() => {
    const set = new Set();
    events.forEach(ev => { if (ev.config?.date) set.add(ev.config.date); });
    return set;
  }, [events]);

  // When a specific date is selected, filter to just that date
  const dateFiltered = useMemo(() => {
    if (!selectedDate) return events;
    return events.filter(ev => ev.config?.date === selectedDate);
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
   * ⚠ THREE OUTCOMES, NOT TWO: near / far / UNKNOWN.
   *
   * An event whose venue has no postcode is not far away — its distance is
   * simply unknown, and treating unknown as "exclude" would have hidden 21 of
   * 30 live events on the day this shipped. They are collected separately and
   * rendered under their own heading, so the screen never implies a location
   * it does not have.
   */
  const inRange = useCallback((ev) => {
    if (!radiusKm || !originCoords) return 'near';        // no radius = everything is "near"
    const c = eventCoords(ev, ev.venue);
    if (!c) return 'unknown';
    const pc = ev.venue_profile_id ? ev.venue?.postcode : ev.postcode;
    return withinRadius(originCoords, c, radiusKm, originPostcode, pc) ? 'near' : 'far';
  }, [radiusKm, originCoords, originPostcode]);

  const passes = useCallback(
    (ev) => matchesCategory(ev, category) && inRange(ev) === 'near',
    [category, inRange],
  );

  const featuredEvent  = useMemo(() => events.find(ev => ev.config?.featured) || null, [events]);
  const tonightEvents  = useMemo(() => events.filter(ev => ev.config?.date === todayIso && passes(ev)), [events, todayIso, passes]);
  // `> todayIso` not `!== todayIso`: mid-weekend the range opens on a Friday that has already
  // been, so this drops the nights gone as well as tonight (TONIGHT owns tonight).
  const weekendEvents  = useMemo(() => events.filter(ev => weekendDates.has(ev.config?.date) && ev.config?.date > todayIso && passes(ev)), [events, weekendDates, todayIso, passes]);
  /* ⚠ NOT DATE-CAPPED (owner, 2026-08-02). This used to cut at `d <= dateStr(14)` so the list
     could run dry while events existed just past the fortnight. The full upcoming list is kept
     here; only how much of it is ON SCREEN is limited, and ADD MORE lifts that limit. */
  const comingUpAll = useMemo(() => events.filter(ev => {
    const d = ev.config?.date;
    return d && d !== todayIso && !weekendDates.has(d) && passes(ev);
  }).sort((a, b) => (a.config?.date || '').localeCompare(b.config?.date || '')),
    [events, weekendDates, todayIso, passes]);

  useEffect(() => { setComingUpShown(COMING_UP_PAGE); }, [category, postcode, radius, selectedDate]);

  const comingUpEvents = useMemo(() => comingUpAll.slice(0, comingUpShown), [comingUpAll, comingUpShown]);
  const comingUpHasMore = comingUpAll.length > comingUpEvents.length;

  /* Back to the fortnight wording the section shipped with (owner, 2026-08-02). */
  const comingUpSub    = 'NEXT TWO WEEKS';
  const comingUpTabSub = 'Next 2 weeks';

  /** Upcoming events that match the category but cannot be placed. */
  const unplaceableEvents = useMemo(() => {
    if (!radiusKm || !originCoords) return [];
    return events.filter(ev => {
      const d = ev.config?.date;
      return d && d >= todayIso && matchesCategory(ev, category) && inRange(ev) === 'unknown';
    }).sort((a, b) => (a.config?.date || '').localeCompare(b.config?.date || ''));
  }, [events, todayIso, category, radiusKm, originCoords, inRange]);

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
            return (
              <button key={iso} data-today={isToday}
                className={isSelected ? s.stripDayActive : isToday ? s.stripDayToday : s.stripDay}
                onClick={() => { if (!dragRef.current.moved) setSelectedDate(prev => prev === iso ? null : iso); }}>
                <span className={s.stripDayName}>{day}</span>
                <span className={s.stripDayNum}>{d}</span>
                {hasEvent && <span className={s.stripDot} />}
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
          {featuredEvent && (
            <div className={s.sectionBlock}>
              <div style={{ marginBottom: 12 }}><span data-tour="whatson-section" className={s.sectionTitle}>FEATURED EVENT</span></div>
              {/* The featured hero was the ONE event card in the app you could
                  not save from — every other card here and on My Scene carries
                  the heart, and this is the most prominent gig on the page. */}
              <FeaturedEventCard event={featuredEvent} onClick={() => openEvent(featuredEvent)}
                cornerAction={<HeartBtn event={featuredEvent} style={HEART_OVERLAY_STYLE} />} />
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

          {/* COMING UP */}
          {comingUpEvents.length > 0 && (
            <div ref={comingUpRef} className={s.sectionBlock}>
              <div className={s.sectionRow}>
                <span data-tour="whatson-section" className={s.sectionTitle}>COMING UP</span>
                <span className={s.sectionSub}>{comingUpSub}</span>
                <div className={s.gradientLine} />
                <button className={s.viewAll}>View all ›</button>
              </div>
              {comingUpEvents.map(ev => (
                <ComingUpRow key={ev.id} event={ev} onClick={() => openEvent(ev)} />
              ))}
              {/* Only rendered when there is genuinely more to reveal — a button that does
                  nothing reads as a broken list. */}
              {comingUpHasMore && (
                <button
                  className={s.addMore}
                  onClick={() => setComingUpShown(n => n + COMING_UP_PAGE)}
                >
                  Add more
                </button>
              )}
            </div>
          )}

          {/* ⚠ LOCATION UNAVAILABLE — shown, never silently dropped.
              These match the category and are upcoming, but their venue has no
              postcode, so the distance filter has nothing to test. Excluding
              them would be the app asserting they are far away, which it does
              not know. On the day this shipped that would have hidden 21 of 30
              live events and read as an empty scene. */}
          {unplaceableEvents.length > 0 && (
            <div className={s.sectionBlock}>
              <div className={s.sectionRow}>
                <span data-tour="whatson-section" className={s.sectionTitle}>LOCATION UNAVAILABLE</span>
                <span className={s.sectionSub}>DISTANCE UNKNOWN</span>
                <div className={s.gradientLine} />
              </div>
              <p className={s.empty} style={{ textAlign: 'left', margin: '0 0 8px' }}>
                {unplaceableEvents.length === 1
                  ? 'This event has no venue location set, so we can’t tell how far away it is.'
                  : `${unplaceableEvents.length} events have no venue location set, so we can’t tell how far away they are.`}
              </p>
              {unplaceableEvents.slice(0, 50).map(ev => (
                <ComingUpRow key={ev.id} event={ev} onClick={() => openEvent(ev)} />
              ))}
            </div>
          )}

          {!featuredEvent && !loading && (
            <p className={s.empty}>No upcoming events.</p>
          )}
        </div>
      )}

    </div>
  );
}
