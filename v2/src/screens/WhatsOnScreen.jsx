import { useState, useMemo, useRef, useEffect } from 'react';
import { SkeletonRow, SkeletonEventCard } from '../components/Skeleton';
import { useNavigate } from 'react-router-dom';
import { useEvents } from '../lib/useEvents';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import { today, dateStr, weekendRange, formatDisplayDate } from '../lib/dates';
import { getDemoEvents } from '../lib/demoEvents';
import FeaturedEventCard from '../components/FeaturedEventCard';
import s from './WhatsOnScreen.module.css';
import { likedEvents } from '../lib/likedEvents';
import { getEventBadges } from '../lib/eventBadges';
import { useDragScroll } from '../hooks/useDragScroll';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES   = ['S','M','T','W','T','F','S'];

const DATE_TABS = [
  { id: 'TONIGHT',   label: 'TONIGHT',    sub: "What's on now" },
  { id: 'WEEKEND',   label: 'WEEKEND',    sub: 'Fri – Sun' },
  { id: 'COMING UP', label: 'COMING UP',  sub: 'Next 2 weeks' },
  { id: 'ALL',       label: 'THIS MONTH', sub: MONTH_NAMES[new Date().getMonth()].toUpperCase() },
];

const CATEGORIES = ['ALL', 'DJ', 'BAND / LIVE', 'COMEDY', 'SPOKEN WORD', 'FESTIVAL'];


function matchesCategory(event, category) {
  if (category === 'ALL') return true;
  const cfg = event.config || {};
  const text = ((cfg.genres || '') + ' ' + (event.name || '')).toLowerCase();
  if (category === 'DJ')          return /dj|electronic|house|techno|drum.n.bass|dnb/.test(text);
  if (category === 'BAND / LIVE') return /band|live.music|folk|roots|rock|acoustic|singer|muso/.test(text);
  if (category === 'COMEDY')      return /comedy|standup|stand.up|open.mic/.test(text);
  if (category === 'SPOKEN WORD') return /spoken.word|poetry|slam/.test(text);
  if (category === 'FESTIVAL')    return /festival/.test(text);
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function HeartBtn({ event, className }) {
  const { session } = useSession();
  const [liked, setLiked] = useState(() => likedEvents.has(event.id));
  const [busy,  setBusy]  = useState(false);
  const isReal = UUID_RE.test(event.id);

  useEffect(() => {
    if (!session?.user?.id || !isReal) return;
    if (likedEvents.has(event.id)) return; // already confirmed this session
    supabase.from('follows').select('id').eq('user_id', session.user.id).eq('entity_id', event.id).maybeSingle()
      .then(({ data }) => {
        if (data) { likedEvents.add(event.id); setLiked(true); }
      });
  }, [event.id, session?.user?.id, isReal]);

  async function toggle(e) {
    e.stopPropagation();
    if (!session?.user?.id || busy || !isReal) return;
    setBusy(true);
    if (liked) {
      await supabase.from('follows').delete().eq('user_id', session.user.id).eq('entity_id', event.id);
      likedEvents.delete(event.id); setLiked(false);
    } else {
      await supabase.from('follows').insert({ user_id: session.user.id, entity_id: event.id, entity_type: 'event', entity_name: event.name });
      likedEvents.add(event.id); setLiked(true);
    }
    setBusy(false);
  }

  return (
    <button className={className} onClick={toggle} style={liked ? { color: 'var(--neon)', borderColor: 'rgba(255,45,120,.5)' } : {}}>
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill={liked ? 'var(--neon)' : 'none'} stroke={liked ? 'var(--neon)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    </button>
  );
}

function WeekendCard({ event, onClick }) {
  const cfg    = event.config || {};
  const poster = cfg.poster || cfg.posterUrl || '';
  const badges = getEventBadges(cfg.genres || '', event.name || '');
  const genreList = (cfg.genres || '').split(',').map(g => g.trim()).filter(Boolean).slice(0, 2);

  return (
    <div className={s.weekendCard} onClick={onClick} style={poster ? { backgroundImage: `url(${poster})` } : {}}>
      <div className={s.weekendOverlay} />
      <div className={s.weekendBadges}>
        {badges.map(b => <span key={b.label} className={s.weekendBadge} style={{ background: b.bg, color: b.col }}>{b.label}</span>)}
      </div>
      <HeartBtn event={event} className={s.weekendHeart} />
      <div className={s.weekendContent}>
        <div className={s.weekendName}>{event.name}</div>
        {cfg.venue && <div className={s.weekendVenue}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 3, flexShrink: 0 }}><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
        {cfg.venue}
      </div>}
        {cfg.date  && <div className={s.weekendDate}>{new Date(cfg.date + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}</div>}
        {genreList.length > 0 && (
          <div className={s.weekendTags}>
            {genreList.map(g => <span key={g} className={s.weekendTag}>{g}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

function ComingUpRow({ event, onClick }) {
  const cfg    = event.config || {};
  const poster = cfg.poster || cfg.posterUrl || '';
  const badges = getEventBadges(cfg.genres || '', event.name || '');
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

  // Always load upcoming 14 days for the 3-section layout
  const { events: realEvents, loading } = useEvents(todayIso, dateStr(14));
  const events = useMemo(() => [...realEvents, ...getDemoEvents(realEvents)], [realEvents]);

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
      dates.add(d.toISOString().slice(0, 10));
    }
    return dates;
  }, [wr]);

  const featuredEvent  = useMemo(() => events.find(ev => ev.config?.featured) || null, [events]);
  const tonightEvents  = useMemo(() => events.filter(ev => ev.config?.date === todayIso && matchesCategory(ev, category)), [events, todayIso, category]);
  const weekendEvents  = useMemo(() => events.filter(ev => weekendDates.has(ev.config?.date) && ev.config?.date !== todayIso && matchesCategory(ev, category)), [events, weekendDates, todayIso, category]);
  const comingUpEvents = useMemo(() => events.filter(ev => {
    const d = ev.config?.date;
    return d && d !== todayIso && !weekendDates.has(d) && matchesCategory(ev, category);
  }).sort((a, b) => (a.config?.date || '').localeCompare(b.config?.date || '')), [events, weekendDates, todayIso, category]);

  // Weekend date range label
  const weekendLabel = useMemo(() => {
    const fri = new Date(wr.from + 'T12:00:00');
    const sun = new Date(fri); sun.setDate(sun.getDate() + 2);
    const fmt = d => `${d.toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase()} ${d.getDate()} ${d.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase()}`;
    return `${fmt(fri)} – ${fmt(sun)}`;
  }, [wr]);

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
        {DATE_TABS.map(({ id, label, sub }) => (
          <button key={id} className={dateTab === id ? s.dateTabActive : s.dateTab}
            onClick={() => { setDateTab(id); setSelectedDate(null); if (id === 'ALL') setMonthPickerOpen(true); else scrollToSection(id); }}>
            <div className={s.dateTabLabel}>{label}</div>
            {sub && <div className={s.dateTabSub}>{sub}</div>}
          </button>
        ))}
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
              placeholder="📍 Postcode" value={postcode} onChange={e => setPostcode(e.target.value)} autoComplete="off" />
          </div>
          {postcode.length === 4 && (
            <select className={s.radiusSelect} value={radius} onChange={e => setRadius(e.target.value)}>
              {['0','5','25','50','100','200'].map(r => <option key={r} value={r}>{r} km</option>)}
            </select>
          )}
          {CATEGORIES.map(cat => (
            <button key={cat} className={(category === cat || category === 'ALL') ? s.chipActive : s.chip} onClick={() => setCategory(cat)}>{cat}</button>
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
            : dateFiltered.map(ev => <ComingUpRow key={ev.id} event={ev} onClick={() => navigate(`/event/${ev.id}`)} />)
          }
        </div>
      )}

      {/* Main 3-section view */}
      {!loading && !selectedDate && (
        <div className={s.sections}>

          {/* FEATURED EVENT */}
          {featuredEvent && (
            <div className={s.sectionBlock}>
              <div style={{ marginBottom: 12 }}><span className={s.sectionTitle}>FEATURED EVENT</span></div>
              <FeaturedEventCard event={featuredEvent} onClick={() => navigate(`/event/${featuredEvent.id}`)} />
            </div>
          )}

          {/* TONIGHT */}
          {tonightEvents.length > 0 && (
            <div ref={tonightRef} className={s.sectionBlock}>
              <div className={s.sectionRow}>
                <span className={s.sectionTitle}>TONIGHT</span>
                <span className={s.sectionPill}>
                  {new Date(todayIso + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long' }).toUpperCase()}
                </span>
                <div className={s.gradientLine} />
                <button className={s.viewAll}>View all ›</button>
              </div>
              <div className={s.weekendScroll} ref={weekendDrag1.ref} onMouseDown={weekendDrag1.onMouseDown} onMouseMove={weekendDrag1.onMouseMove} onMouseUp={weekendDrag1.onMouseUp} onMouseLeave={weekendDrag1.onMouseLeave} style={{ cursor:'grab' }}>
                {tonightEvents.map(ev => (
                  <WeekendCard key={ev.id} event={ev} onClick={() => navigate(`/event/${ev.id}`)} />
                ))}
              </div>
            </div>
          )}

          {/* THIS WEEKEND */}
          {weekendEvents.length > 0 && (
            <div ref={weekendRef} className={s.sectionBlock}>
              <div className={s.sectionRow}>
                <span className={s.sectionTitle}>THIS WEEKEND</span>
                <span className={s.sectionPill}>{weekendLabel}</span>
                <div className={s.gradientLine} />
                <button className={s.viewAll}>View all ›</button>
              </div>
              <div className={s.weekendScroll} ref={weekendDrag2.ref} onMouseDown={weekendDrag2.onMouseDown} onMouseMove={weekendDrag2.onMouseMove} onMouseUp={weekendDrag2.onMouseUp} onMouseLeave={weekendDrag2.onMouseLeave} style={{ cursor:'grab' }}>
                {weekendEvents.map(ev => (
                  <WeekendCard key={ev.id} event={ev} onClick={() => navigate(`/event/${ev.id}`)} />
                ))}
              </div>
            </div>
          )}

          {/* COMING UP */}
          {comingUpEvents.length > 0 && (
            <div ref={comingUpRef} className={s.sectionBlock}>
              <div className={s.sectionRow}>
                <span className={s.sectionTitle}>COMING UP</span>
                <span className={s.sectionSub}>NEXT TWO WEEKS</span>
                <div className={s.gradientLine} />
                <button className={s.viewAll}>View all ›</button>
              </div>
              {comingUpEvents.slice(0, 200).map(ev => (
                <ComingUpRow key={ev.id} event={ev} onClick={() => navigate(`/event/${ev.id}`)} />
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
