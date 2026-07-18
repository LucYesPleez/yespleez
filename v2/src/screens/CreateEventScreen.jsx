import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import s from './CreateEventScreen.module.css';
import ImageUploadButton from '../components/ImageUploadButton';
import { getEventBadges } from '../lib/eventBadges';
import { resolveProfileId } from '../lib/resolveProfileId';

const CAL_DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DUR_PRESETS = [{ label:'1 HR', mins:60 },{ label:'1.5 HRS', mins:90 },{ label:'2 HRS', mins:120 },{ label:'OTHER', mins:null }];

function makeId() { return Math.random().toString(36).slice(2,8); }

function slotToSave(sl) {
  return { id: sl.id, time: `${parseInt(sl.hh||8)}:${String(sl.mm||'00').padStart(2,'0')}`, ampm: sl.ampm||'PM', dur: sl.dur||60, label: sl.label||'' };
}
function slotToEdit(sl) {
  const [hh, mm] = (sl.time||'8:00').split(':');
  return { id: sl.id||makeId(), hh: hh||'8', mm: (mm||'00').padStart(2,'0'), ampm: sl.ampm||'PM', dur: sl.dur||sl.duration||60, label: sl.label||'' };
}
function generateSlots(startTime, endTime, slotLenMins) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let cur = sh*60+(sm||0), end = eh*60+(em||0);
  if (end <= cur) end += 24*60;
  const slots = [];
  while (cur + slotLenMins <= end) {
    const h24 = Math.floor(cur/60)%24, m = cur%60;
    slots.push({ id:makeId(), hh:String(h24%12||12), mm:String(m).padStart(2,'0'), ampm:h24>=12?'PM':'AM', dur:slotLenMins, label:'' });
    cur += slotLenMins;
  }
  return slots;
}

/* ── Calendar Picker ─────────────────────────────────────────────────────── */
function CalendarPicker({ value, onChange, placeholder='Select a date' }) {
  const [open, setOpen] = useState(false);
  const today = new Date(); today.setHours(0,0,0,0);
  const initDate = value ? new Date(value+'T12:00:00') : today;
  const [view, setView] = useState({ year:initDate.getFullYear(), month:initDate.getMonth() });
  const ref = useRef(null);
  useEffect(() => {
    function h(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  function prevMonth() { setView(v => v.month===0?{year:v.year-1,month:11}:{...v,month:v.month-1}); }
  function nextMonth() { setView(v => v.month===11?{year:v.year+1,month:0}:{...v,month:v.month+1}); }
  function buildDays() {
    const first = new Date(view.year,view.month,1).getDay();
    const total = new Date(view.year,view.month+1,0).getDate();
    const cells = [];
    for (let i=0;i<first;i++) cells.push(null);
    for (let d=1;d<=total;d++) cells.push(d);
    return cells;
  }
  const display = value ? new Date(value+'T12:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}) : '';
  return (
    <div ref={ref} style={{position:'relative'}}>
      <div onClick={() => setOpen(o=>!o)} className={s.datePickerBtn}>
        <span style={{color:value?'var(--text)':'var(--muted)'}}>{display||placeholder}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{opacity:.5,flexShrink:0}}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      </div>
      {open && (
        <div className={s.calDrop}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
            <button type="button" onClick={prevMonth} className={s.calNav}>‹</button>
            <span style={{fontFamily:"'Bebas Neue'",fontSize:14,letterSpacing:1.5,color:'var(--text)'}}>{CAL_MONTHS[view.month]} {view.year}</span>
            <button type="button" onClick={nextMonth} className={s.calNav}>›</button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,marginBottom:4}}>
            {CAL_DAYS.map(d => <div key={d} style={{textAlign:'center',fontSize:10,color:'var(--muted)',fontFamily:"'Bebas Neue'",letterSpacing:1}}>{d}</div>)}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2}}>
            {buildDays().map((day,i) => {
              if (!day) return <div key={i}/>;
              const iso = `${view.year}-${String(view.month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
              const isSel = value===iso, isToday = iso===today.toISOString().split('T')[0];
              return <button key={i} type="button" onClick={() => { onChange(iso); setOpen(false); }} style={{padding:'6px 0',border:isToday?'1px solid var(--neon2)':'1px solid transparent',borderRadius:6,background:isSel?'var(--neon2)':'transparent',color:isSel?'#000':'var(--text)',fontFamily:"'DM Sans'",fontSize:13,cursor:'pointer',textAlign:'center'}}>{day}</button>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Toggle ──────────────────────────────────────────────────────────────── */
function Toggle({ label, sub, value, onChange, locked, info }) {
  return (
    <button className={s.toggleRow} onClick={() => onChange(!value)} type="button">
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <p className={s.toggleLabel}>{label}</p>
          {locked && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0,opacity:.5}}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
          {info && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0,opacity:.5}}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>}
        </div>
        {sub && <p className={s.toggleSub}>{sub}</p>}
      </div>
      <div className={value ? s.toggleOnTrack : s.toggleOffTrack} style={{flexShrink:0}}>
        <div className={value ? s.toggleOnThumb : s.toggleOffThumb} />
      </div>
    </button>
  );
}

/* ── Section Header ──────────────────────────────────────────────────────── */
function SectionHeader({ label, onInfo }) {
  return (
    <div className={s.sectionHeader}>
      <span className={s.sectionHeaderText}>{label}</span>
      <div className={s.sectionHeaderLine} />
      {onInfo && (
        <button type="button" onClick={onInfo} className={s.sectionInfoBtn}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        </button>
      )}
    </div>
  );
}

const HOST_CONTROL_INFO = [
  { label: 'Artists can remove their own claim', body: 'When on, artists can withdraw from their slot at any time without contacting you. Turn this off if you want full control — no one leaves the lineup without your say.' },
  { label: 'Show ranked backup preferences', body: 'Artists can nominate up to 3 slots they\'d like as a backup if their first choice is taken. Gives the auto-generator better data to fill your lineup fairly.' },
  { label: 'Show genre / vibe pickers', body: 'Adds sound and genre selectors to the application form. Helps you match the right artists to the right slots — especially useful for multi-genre or themed events.' },
  { label: 'Public set times', body: 'When on, the full running order is visible to every artist on the bill. Turn it off to keep set times private — each artist only sees their own slot until you choose to reveal the full lineup.' },
  { label: 'Show set times publicly', body: 'When on, a set times tab appears on the public event page so anyone can see the running order. Keep it off to build anticipation or if times are still being confirmed.' },
  { label: 'Applications open', body: 'Controls whether artists can submit an application to play your event. Turn off once you\'re booked out or want to close submissions without cancelling the event.' },
  { label: 'Public event', body: 'When on, your event is listed in Discover and searchable by anyone on the app. Turn off to keep it invite-only or while you\'re still setting up.' },
];

/* ── Field ───────────────────────────────────────────────────────────────── */
function Field({ label, children, flex }) {
  return (
    <div className={s.field} style={flex ? {flex:1,minWidth:0} : {}}>
      <p className={s.fieldLabel}>{label}</p>
      {children}
    </div>
  );
}

/* ── Quick Generator ─────────────────────────────────────────────────────── */
function QuickGenerator({ onGenerate }) {
  const [numDays,   setNumDays]   = useState(1);
  const [startTime, setStartTime] = useState('16:00');
  const [endTime,   setEndTime]   = useState('23:30');
  const [slotLen,   setSlotLen]   = useState(90);

  function handle() {
    const generated = [];
    for (let d=0; d<numDays; d++) {
      generated.push({ id:makeId(), name:'', slots:generateSlots(startTime, endTime, slotLen) });
    }
    onGenerate(generated);
  }

  return (
    <div className={s.quickGen}>
      <p className={s.quickGenTitle}>QUICK GENERATOR</p>
      <p className={s.quickGenSub}>Auto-build your slot schedule then customise as needed.</p>
      <div className={s.quickGenGrid}>
        <div className={s.quickGenField}>
          <p className={s.quickGenLabel}>DAYS</p>
          <input className={s.quickGenInput} type="number" min={1} max={7} value={numDays} onChange={e => setNumDays(Math.max(1,Number(e.target.value)))} />
        </div>
        <div className={s.quickGenField}>
          <p className={s.quickGenLabel}>START TIME</p>
          <input className={s.quickGenInput} type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
        </div>
        <div className={s.quickGenField}>
          <p className={s.quickGenLabel}>END TIME</p>
          <input className={s.quickGenInput} type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
        </div>
        <div className={s.quickGenField}>
          <p className={s.quickGenLabel}>SLOT LENGTH</p>
          <select className={s.quickGenInput} value={slotLen} onChange={e => setSlotLen(Number(e.target.value))}>
            <option value={30}>30 mins</option>
            <option value={45}>45 mins</option>
            <option value={60}>1 hr</option>
            <option value={90}>1.5 hrs</option>
            <option value={120}>2 hrs</option>
          </select>
        </div>
      </div>
      <button className={s.quickGenBtn} onClick={handle}>GENERATE</button>
    </div>
  );
}

/* ── Slot Row ─────────────────────────────────────────────────────────────── */
function SlotRow({ slot, onUpdate, onRemove }) {
  const isOther = ![60,90,120].includes(Number(slot.dur));
  return (
    <div className={s.slotEditRow}>
      <div className={s.slotTimeFields}>
        <div className={s.slotTimeGroup}>
          <p className={s.slotFieldLabel}>HH</p>
          <input className={s.slotTimeInput} value={slot.hh} maxLength={2} placeholder="8" onChange={e => onUpdate('hh', e.target.value.replace(/\D/,''))} />
        </div>
        <div className={s.slotTimeGroup}>
          <p className={s.slotFieldLabel}>MIN</p>
          <input className={s.slotTimeInput} value={slot.mm} maxLength={2} placeholder="00" onChange={e => onUpdate('mm', e.target.value.replace(/\D/,''))} />
        </div>
        <div className={s.slotTimeGroup}>
          <p className={s.slotFieldLabel}>AM/PM</p>
          <select className={s.slotAmPm} value={slot.ampm} onChange={e => onUpdate('ampm', e.target.value)}>
            <option>AM</option>
            <option>PM</option>
          </select>
        </div>
        <button className={s.slotRemoveBtn} onClick={onRemove}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div className={s.durPills}>
        {DUR_PRESETS.map(p => {
          const active = p.mins===null ? isOther : Number(slot.dur)===p.mins;
          return (
            <button key={p.label} className={active ? s.durPillActive : s.durPill}
              onClick={() => onUpdate('dur', p.mins!==null ? p.mins : 45)}>
              {p.label}
            </button>
          );
        })}
      </div>
      {isOther && (
        <input className={s.otherDurInput} type="number" min={15} step={5} value={slot.dur}
          onChange={e => onUpdate('dur', Number(e.target.value))} placeholder="mins" />
      )}
      <input className={s.slotLabelInput} value={slot.label} onChange={e => onUpdate('label', e.target.value)}
        placeholder='Special label e.g. "Sunset Set" (optional)' />
    </div>
  );
}

/* ── Day Card ─────────────────────────────────────────────────────────────── */
function DayCard({ day, dayIndex, totalDays, onUpdateName, onRemoveDay, onUpdateSlot, onRemoveSlot, onAddSlot, onInsertSlot }) {
  return (
    <div className={s.dayCard}>
      <div className={s.dayCardHeader}>
        <span className={s.dayBadge}>DAY {dayIndex+1}</span>
        <input className={s.dayNameInput} value={day.name} onChange={e => onUpdateName(day.id, e.target.value)} placeholder="e.g. Saturday" />
        {totalDays > 1 && (
          <button className={s.removeDayBtn} onClick={() => onRemoveDay(day.id)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
      </div>
      {day.slots.map((slot, si) => (
        <div key={slot.id}>
          <SlotRow slot={slot} onUpdate={(f,v) => onUpdateSlot(day.id,slot.id,f,v)} onRemove={() => onRemoveSlot(day.id,slot.id)} />
          <button className={s.insertSlotBtn} onClick={() => onInsertSlot(day.id, si+1)}>+ insert slot here</button>
        </div>
      ))}
      <button className={s.addSlotInDayBtn} onClick={() => onAddSlot(day.id)}>+ Add Slot</button>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────────────────── */
export default function CreateEventScreen() {
  const navigate = useNavigate();
  const { session } = useSession();
  const [searchParams] = useSearchParams();
  const editId  = searchParams.get('edit');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  // Event details
  const [name,        setName]        = useState('');
  const [startDate,   setStartDate]   = useState('');
  const [endDate,     setEndDate]     = useState('');
  const [venue,       setVenue]       = useState('');
  const [genreText,   setGenreText]   = useState('');
  const [categoryBadge, setCategoryBadge] = useState('');
  const [openMicBadge, setOpenMicBadge] = useState(false);
  const [ticketLink,  setTicketLink]  = useState('');
  const [bio,         setBio]         = useState('');
  const [poster,      setPoster]      = useState('');
  const [posterThumb, setPosterThumb] = useState('');
  const [posterFull,  setPosterFull]  = useState('');
  const [posterPos,   setPosterPos]   = useState({ x: 50, y: 50 });
  const [cropMode,    setCropMode]    = useState(false);
  const [fullView,    setFullView]    = useState(false);
  const cropRef   = useRef(null);
  const dragState = useRef(null);

  // Schedule
  const [setTimesNeeded, setSetTimesNeeded] = useState(true);
  const [days, setDays] = useState([{ id:makeId(), name:'', slots:[] }]);
  const [slotsCollapsed, setSlotsCollapsed] = useState(false);

  // Host controls
  const [isPublic,           setIsPublic]           = useState(true);
  const [appsOpen,           setAppsOpen]           = useState(true);
  const [artistsCanRemove,   setArtistsCanRemove]   = useState(true);
  const [showRankedBackup,   setShowRankedBackup]   = useState(true);
  const [showGenrePickers,   setShowGenrePickers]   = useState(true);
  const [privateSetTimes,    setPrivateSetTimes]    = useState(true);
  const [showTimesPublicly,  setShowTimesPublicly]  = useState(false);
  const [showHostInfo,       setShowHostInfo]       = useState(false);

  useEffect(() => {
    if (!editId) return;
    supabase.from('events').select('*').eq('id', editId).single().then(({ data }) => {
      if (!data) return;
      const c = data.config || {};
      setName(data.name || '');
      setStartDate(c.date || '');
      setEndDate(c.endDate || '');
      setVenue(c.venue || '');
      setGenreText(c.genres || '');
      setCategoryBadge(c.categoryBadge || '');
      setOpenMicBadge(c.openMicBadge || false);
      setTicketLink(c.ticketLink || '');
      setBio(c.bio || '');
      setPoster(c.poster || '');
      setPosterThumb(c.poster_thumb || '');
      setPosterFull(c.poster_full || '');
      setIsPublic(data.is_public !== false);
      setAppsOpen(data.applications_open !== false);
      const loadedDays = (c.days || []).map(d => ({ id:makeId(), name:d.name||'', slots:(d.slots||[]).map(slotToEdit) }));
      if (loadedDays.length > 0) setDays(loadedDays);
      const hc = c.host_controls_config || {};
      setArtistsCanRemove(hc.artistsCanRemove !== false);
      setShowRankedBackup(hc.showRankedBackup !== false);
      setShowGenrePickers(hc.showGenrePickers !== false);
      setPrivateSetTimes(hc.privateSetTimes !== false);
      setShowTimesPublicly(hc.showTimesPublicly === true);
    });
  }, [editId]);

  function addDay() { setDays(p => [...p, { id:makeId(), name:'', slots:[] }]); }
  function removeDay(id) { setDays(p => p.filter(d => d.id!==id)); }
  function updateDayName(id, name) { setDays(p => p.map(d => d.id===id ? {...d,name} : d)); }
  function addSlot(dayId) { setDays(p => p.map(d => d.id!==dayId ? d : {...d, slots:[...d.slots,{id:makeId(),hh:'8',mm:'00',ampm:'PM',dur:90,label:''}]})); }
  function insertSlot(dayId, at) {
    setDays(p => p.map(d => {
      if (d.id!==dayId) return d;
      const slots = [...d.slots];
      slots.splice(at, 0, {id:makeId(),hh:'8',mm:'00',ampm:'PM',dur:90,label:''});
      return {...d, slots};
    }));
  }
  function updateSlot(dayId, slotId, field, value) {
    setDays(p => p.map(d => d.id!==dayId ? d : {...d, slots:d.slots.map(sl => sl.id===slotId ? {...sl,[field]:value} : sl)}));
  }
  function removeSlot(dayId, slotId) {
    setDays(p => p.map(d => d.id!==dayId ? d : {...d, slots:d.slots.filter(sl => sl.id!==slotId)}));
  }

  async function handleSave(goLive) {
    if (!name.trim()) { setError('Event name is required.'); return; }
    if (!session)     { setError('You must be signed in.'); return; }
    setSaving(true); setError('');

    const cfg = {
      name, date:startDate, endDate, venue, genres:genreText, categoryBadge: categoryBadge || null, openMicBadge: openMicBadge || null, ticketLink, bio, poster, poster_thumb:posterThumb, poster_full:posterFull,
      is_public:isPublic, applications_open:appsOpen,
      days: setTimesNeeded ? days.map(d => ({ name:d.name, slots:d.slots.map(slotToSave) })) : [],
      host_controls_config: { artistsCanRemove, showRankedBackup, showGenrePickers, privateSetTimes, showTimesPublicly },
    };

    if (editId) {
      const { error:err } = await supabase.from('events').update({ name, config:cfg, is_public:isPublic, applications_open:appsOpen }).eq('id', editId);
      setSaving(false);
      if (err) { setError(err.message); return; }
      navigate(`/event/${editId}`, { replace:true });
      return;
    }

    const venueProfileId = await resolveProfileId(session.user.id, 'venue');
    const { data, error:err } = await supabase.from('events').insert({
      name, config:cfg, host_id:session.user.id,
      status: goLive ? 'live' : 'draft',
      is_public:isPublic, applications_open:appsOpen,
      venue_profile_id: venueProfileId,
    }).select('id').single();
    setSaving(false);
    if (err) { setError(err.message); return; }
    navigate(`/event/${data.id}`, { replace:true });
  }

  async function handleDelete() {
    if (!editId || !window.confirm('Delete this event? This cannot be undone.')) return;
    await supabase.from('events').delete().eq('id', editId);
    navigate(-1);
  }

  return (
    <div className={s.screen}>
      <div className={s.content}>
        <h1 className={s.pageTitle}>{editId ? 'EDIT EVENT' : 'SET UP YOUR EVENT'}</h1>
        {!editId && <p className={s.pageSubtitle}>Fill in the details, generate or build slots manually, then go live</p>}

        {/* ── EVENT DETAILS ── */}
        <SectionHeader label="EVENT DETAILS" />

        <Field label="EVENT NAME">
          <input className={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sunday Sessions" />
        </Field>

        <div className={s.dateRow}>
          <Field label="START DATE" flex>
            <CalendarPicker value={startDate} onChange={setStartDate} placeholder="Start date" />
          </Field>
          <Field label="END DATE (MULTI-DAY)" flex>
            <CalendarPicker value={endDate} onChange={setEndDate} placeholder="End date (opt)" />
          </Field>
        </div>

        <Field label="VENUE">
          <input className={s.input} value={venue} onChange={e => setVenue(e.target.value)} placeholder="e.g. The Newsagency, Bellingen" />
        </Field>

        <Field label="SOUND / VIBE (optional)">
          <input className={s.input} value={genreText} onChange={e => setGenreText(e.target.value)} placeholder="e.g. Deep house into techno, heavy bass, late night energy" />
        </Field>

        <Field label="CATEGORY CHIP (optional)">
          {(() => {
            const auto = getEventBadges(genreText, name);
            const primary = [
              { label: 'Live Music', bg: '#ff2d78', col: '#fff' },
              { label: 'DJs',        bg: 'var(--neon2)', col: '#000' },
              { label: 'Comedy',     bg: '#FF8C42', col: '#fff' },
              { label: 'Spoken Word',bg: '#FF8C42', col: '#fff' },
              { label: 'Festival',   bg: '#BF5FFF', col: '#fff' },
            ];
            const openMicOpt = { label: 'Open Mic', bg: '#FFD700', col: '#000' };
            return (
              <div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  {primary.map(opt => {
                    const manualActive = categoryBadge === opt.label;
                    const autoActive = !categoryBadge && auto[0]?.label?.toUpperCase() === opt.label.toUpperCase();
                    const active = manualActive || autoActive;
                    return (
                      <button key={opt.label} type="button" onClick={() => setCategoryBadge(manualActive ? '' : opt.label)}
                        style={{ fontFamily: "'DM Sans'", fontSize: 11, fontWeight: 700, letterSpacing: .8, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${active ? 'transparent' : 'rgba(255,255,255,.15)'}`, background: active ? opt.bg : 'rgba(255,255,255,.05)', color: active ? opt.col : 'rgba(255,255,255,.5)', transition: 'all .15s' }}>
                        {opt.label}
                      </button>
                    );
                  })}
                  <button type="button" onClick={() => setOpenMicBadge(v => !v)}
                    style={{ fontFamily: "'DM Sans'", fontSize: 11, fontWeight: 700, letterSpacing: .8, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${openMicBadge ? 'transparent' : 'rgba(255,255,255,.15)'}`, background: openMicBadge ? openMicOpt.bg : 'rgba(255,255,255,.05)', color: openMicBadge ? openMicOpt.col : 'rgba(255,255,255,.5)', transition: 'all .15s' }}>
                    {openMicOpt.label}
                  </button>
                </div>
                {!categoryBadge && auto.length > 0 && (
                  <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>Auto-detected from your genres: <strong style={{ color: 'var(--text)' }}>{auto[0].label}</strong> — select above to override</p>
                )}
                {categoryBadge === 'Live Music' && auto[0]?.label === 'DJs' && (
                  <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>We've auto-detected you as a DJ — Live Music is for bands, acoustic and live instruments.</p>
                )}
              </div>
            );
          })()}
        </Field>

        <Field label="TICKET LINK (optional)">
          <input className={s.input} type="url" value={ticketLink} onChange={e => setTicketLink(e.target.value)} placeholder="https://humanitix.com/your-event" />
        </Field>

        <Field label="ABOUT THIS EVENT (optional)">
          <textarea className={s.textarea} value={bio} onChange={e => setBio(e.target.value)} rows={4} placeholder="Tell people what to expect — vibe, artists, anything worth knowing…" />
        </Field>

        <div className={s.field}>
          <p className={s.fieldLabel}>EVENT POSTER</p>
          <p className={s.fieldSub}>Optional — screenshot or photo · 4:5 ratio</p>
          <ImageUploadButton type="poster" userId={session?.user?.id} onUpload={({ poster:p, poster_thumb:t, poster_full:f }) => { setPoster(p); setPosterThumb(t); setPosterFull(f||''); setPosterPos({ x:50, y:50 }); setCropMode(false); }}>
            {({ trigger, statusBadge }) => (
              <div>
                {/* Poster frame */}
                <div
                  ref={cropRef}
                  style={{ width:'100%', aspectRatio:'4/5', maxHeight:280, borderRadius:10, overflow:'hidden', position:'relative',
                    background: poster ? 'transparent' : 'rgba(255,255,255,0.05)',
                    border: poster ? (cropMode ? '2px solid var(--neon2)' : 'none') : '2px dashed rgba(255,255,255,0.18)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    cursor: cropMode ? 'grab' : (poster ? 'default' : 'pointer'),
                    userSelect:'none',
                  }}
                  onClick={!poster ? trigger : undefined}
                  onMouseDown={cropMode ? e => {
                    e.preventDefault();
                    const rect = cropRef.current.getBoundingClientRect();
                    dragState.current = { startX: e.clientX, startY: e.clientY, startPX: posterPos.x, startPY: posterPos.y, w: rect.width, h: rect.height };
                    const onMove = mv => {
                      const dx = ((mv.clientX - dragState.current.startX) / dragState.current.w) * -100;
                      const dy = ((mv.clientY - dragState.current.startY) / dragState.current.h) * -100;
                      setPosterPos({ x: Math.min(100,Math.max(0, dragState.current.startPX + dx)), y: Math.min(100,Math.max(0, dragState.current.startPY + dy)) });
                    };
                    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                  } : undefined}
                  onTouchStart={cropMode ? e => {
                    const t = e.touches[0];
                    const rect = cropRef.current.getBoundingClientRect();
                    dragState.current = { startX: t.clientX, startY: t.clientY, startPX: posterPos.x, startPY: posterPos.y, w: rect.width, h: rect.height };
                    const onMove = mv => {
                      const tc = mv.touches[0];
                      const dx = ((tc.clientX - dragState.current.startX) / dragState.current.w) * -100;
                      const dy = ((tc.clientY - dragState.current.startY) / dragState.current.h) * -100;
                      setPosterPos({ x: Math.min(100,Math.max(0, dragState.current.startPX + dx)), y: Math.min(100,Math.max(0, dragState.current.startPY + dy)) });
                    };
                    const onUp = () => { window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onUp); };
                    window.addEventListener('touchmove', onMove, { passive:true });
                    window.addEventListener('touchend', onUp);
                  } : undefined}
                >
                  {poster
                    ? <img src={poster} alt="poster" style={{ width:'100%', height:'100%', objectFit:'cover', objectPosition:`${posterPos.x}% ${posterPos.y}%`, pointerEvents:'none' }} />
                    : <div style={{ textAlign:'center', color:'rgba(255,255,255,0.4)', fontSize:13 }}><div style={{ fontSize:28, marginBottom:6 }}>+</div><div>Tap to add poster</div></div>
                  }
                  {cropMode && <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}><div style={{ background:'rgba(0,229,255,0.15)', border:'1px dashed rgba(0,229,255,0.5)', borderRadius:6, padding:'6px 12px', fontSize:11, fontFamily:"'Bebas Neue'", letterSpacing:2, color:'var(--neon2)' }}>DRAG TO REPOSITION</div></div>}
                  {statusBadge}
                </div>

                {/* Action tabs */}
                {poster && (
                  <div className={s.posterTabs}>
                    <button type="button" className={s.posterTab} onClick={() => setFullView(true)}>Full view</button>
                    <button type="button" className={cropMode ? s.posterTabActive : s.posterTab} onClick={() => setCropMode(m => !m)}>Adjust crop</button>
                    <button type="button" className={s.posterTab} onClick={trigger}>Replace</button>
                    <button type="button" className={s.posterTabRemove} onClick={() => { setPoster(''); setPosterThumb(''); setPosterFull(''); setCropMode(false); }}>Remove</button>
                  </div>
                )}
              </div>
            )}
          </ImageUploadButton>
        </div>

        {/* Full view modal */}
        {fullView && (
          <div style={{ position:'fixed', inset:0, zIndex:9000, background:'rgba(0,0,0,0.92)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }} onClick={() => setFullView(false)}>
            <img src={poster} alt="poster" style={{ maxWidth:'100%', maxHeight:'100%', borderRadius:12, boxShadow:'0 8px 48px rgba(0,0,0,.8)' }} />
          </div>
        )}

        {/* ── DAYS & TIME SLOTS ── */}
        <SectionHeader label="DAYS & TIME SLOTS" />

        <div className={s.controlsCard}>
          <Toggle label="Set times needed" sub="Turn off for community events, gigs without a running order" value={setTimesNeeded} onChange={setSetTimesNeeded} />
        </div>

        {setTimesNeeded && (
          <>
            <QuickGenerator onGenerate={(d) => { setDays(d); setSlotsCollapsed(false); }} />
            <button
              type="button"
              onClick={() => setSlotsCollapsed(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                padding: '6px 0 10px', marginTop: 2,
              }}
            >
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', fontFamily: "'Bebas Neue'", letterSpacing: 1.5 }}>
                {slotsCollapsed
                  ? `${days.reduce((n, d) => n + d.slots.length, 0)} SLOTS ACROSS ${days.length} DAY${days.length !== 1 ? 'S' : ''} — TAP TO EDIT`
                  : 'Or build manually below. Remove slots you don\'t need.'}
              </span>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: slotsCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform .2s', flexShrink: 0 }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {!slotsCollapsed && <>
              {days.map((day, di) => (
                <DayCard key={day.id} day={day} dayIndex={di} totalDays={days.length}
                  onUpdateName={updateDayName} onRemoveDay={removeDay}
                  onUpdateSlot={updateSlot} onRemoveSlot={removeSlot}
                  onAddSlot={addSlot} onInsertSlot={insertSlot} />
              ))}
              <button className={s.addAnotherDayBtn} onClick={addDay}>+ ADD ANOTHER DAY</button>
            </>}
          </>
        )}

        {/* ── HOST CONTROLS ── */}
        <SectionHeader label="HOST CONTROLS" onInfo={() => setShowHostInfo(true)} />
        <div className={s.controlsCard}>
          <Toggle label="Artists can remove their own claim"    sub="When off, only the host can clear slots"                                    value={artistsCanRemove}  onChange={setArtistsCanRemove} />
          <Toggle label="Show ranked backup preferences"        sub="Artists rank up to 3 preferred slots for the generator"                    value={showRankedBackup}  onChange={setShowRankedBackup} />
          <Toggle label="Show genre / vibe pickers"            sub="Collect musical style info from artists"                                    value={showGenrePickers}  onChange={setShowGenrePickers} />
          <Toggle label="Public set times"                     sub="Full running order is visible to every artist on the bill — turn off to keep it under wraps until you're ready"   value={!privateSetTimes}   onChange={v => setPrivateSetTimes(!v)} />
          <Toggle label="Show set times publicly"              sub="When on, the set times tab is visible on the public event page"             value={showTimesPublicly} onChange={setShowTimesPublicly} />
          <Toggle label="Applications open"                    sub="Allow artists to apply to this event"                                       value={appsOpen}          onChange={setAppsOpen} />
          <Toggle label="Public event"                         sub="Visible in Discover to anyone browsing"                                     value={isPublic}          onChange={setIsPublic} />
        </div>

        {/* Host controls info modal */}
        {showHostInfo && (
          <div style={{position:'fixed',inset:0,zIndex:9000,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'flex-end',justifyContent:'center',paddingBottom:'var(--yp-safe-bottom)'}} onClick={() => setShowHostInfo(false)}>
            <div onClick={e => e.stopPropagation()} className={s.hostInfoSheet}>
              <div style={{width:36,height:4,borderRadius:2,background:'rgba(255,255,255,0.2)',margin:'0 auto 20px'}} />
              <p style={{fontFamily:"'Bebas Neue'",fontSize:16,letterSpacing:3,background:'linear-gradient(135deg,#00E5FF,#BF5FFF)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',marginBottom:20}}>HOST CONTROLS EXPLAINED</p>
              {HOST_CONTROL_INFO.map(item => (
                <div key={item.label} style={{marginBottom:18,paddingBottom:18,borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
                  <p style={{fontFamily:"'Bebas Neue'",fontSize:13,letterSpacing:1.5,color:'var(--text)',marginBottom:5}}>{item.label}</p>
                  <p style={{fontSize:13,color:'rgba(255,255,255,0.55)',lineHeight:1.6}}>{item.body}</p>
                </div>
              ))}
              <button type="button" onClick={() => setShowHostInfo(false)} style={{width:'100%',marginTop:4,padding:'12px',background:'none',border:'1px solid var(--border)',borderRadius:10,color:'var(--muted)',fontFamily:"'Bebas Neue'",fontSize:14,letterSpacing:2,cursor:'pointer'}}>CLOSE</button>
            </div>
          </div>
        )}

        {error && <p className={s.error}>{error}</p>}

        <button className={s.goLiveBtn} onClick={() => handleSave(true)} disabled={saving}>
          {saving ? 'SAVING…' : 'GO LIVE →'}
        </button>

        {!editId && (
          <button className={s.saveDraftBtn} onClick={() => handleSave(false)} disabled={saving}>
            SAVE AS DRAFT
          </button>
        )}

        {editId && (
          <button className={s.deleteBtn} onClick={handleDelete}>
            🗑 Delete Event
          </button>
        )}

        <div style={{height:60}} />
      </div>
    </div>
  );
}
