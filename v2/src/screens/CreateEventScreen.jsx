import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import s from './CreateEventScreen.module.css';
import ImageUploadButton from '../components/ImageUploadButton';
import { getEventBadges, CATEGORY_BADGES, CATEGORY_CHOICES, OPEN_MIC_BADGE, sameCategory } from '../lib/eventBadges';
import { getOwnerProfiles } from '../lib/actingProfile';
import { PROFILE_TYPES } from '../lib/profileTypes';
import { track, EVENTS } from '../lib/analytics';
import { requestableBySection, requirementLabel } from '../lib/requirements';
// The renderer's own constants — imported rather than restated, so the band
// the organiser drags here and the band the public Hero draws can never
// disagree about their shape or their default position.
// MIN_CROP_COVERAGE is deliberately NOT imported. It gates the LIVE CSS band
// (heroMedia rungs 4–6), which can only ever be a full-width slice — below the
// threshold a band stops representing the poster and falls through to the blur.
// The crop tool has no such limit: it zooms, and its output is a baked image
// rather than an object-position on the original. heroMedia still enforces it
// for the fallback path.
import { DEFAULT_CROP_Y, MAX_SLIDES } from './event/heroMedia';
import { uploadPosterCrop } from '../lib/uploadImage';

// One Cover plus five, per the spec's cap — derived from MAX_SLIDES rather
// than written as 5, so the two cannot disagree.
const MAX_GALLERY = MAX_SLIDES - 1;

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

/* ── Requirements checklist ──────────────────────────────────────────────
 *
 * Design §5.3: "A checklist. Tick what you need." No builder, no predicates,
 * no tiers, no engine terminology. The host never sees a requirement key, a
 * section is only a visual grouping, and the word on screen is Requirements —
 * `required_items` stays internal.
 *
 * The rows come from the engine's registry via requestableBySection(), so this
 * component cannot offer a key the engine is unable to resolve, and a new
 * asset type appears here the moment it is added to profileAssets.js.
 */
/**
 * The tick-boxes, in two columns instead of one long vertical list. Same row
 * (checkbox + label) as before — only the wrapping changed, from a full-width
 * `<div>` per section to a two-column grid so a 19-item, 5-section checklist
 * reads as one compact window rather than a page-length scroll.
 */
function RequirementChecklist({ selected, onToggle }) {
  const groups = requestableBySection();
  return (
    // .controlsCard itself carries no padding — HOST CONTROLS supplies its
    // own via .toggleRow. This checklist has no equivalent per-row padding
    // on its sides, so without this the ASSETS section's last row sat flush
    // against the gradient border. Padded here rather than on the shared
    // class, so HOST CONTROLS' rows don't get pushed in from the edge too.
    <div className={s.controlsCard} style={{ padding: '14px 16px' }}>
      <p style={{ fontSize:13, color:'rgba(255,255,255,0.55)', lineHeight:1.6, padding:'2px 2px 12px' }}>
        Tick what you need from applicants. Everything ticked is mandatory.
        An application can&rsquo;t send until it&rsquo;s met.
      </p>
      {groups.map((g, gi) => (
        <div key={g.section}>
          {gi > 0 && <div className={s.controlsGroupDivider} />}
          <p style={{ fontFamily:"'Bebas Neue'", fontSize:11, letterSpacing:2, color:'var(--muted)', margin:'14px 2px 6px' }}>
            {g.section.toUpperCase()}
          </p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', columnGap:8 }}>
            {g.keys.map(key => {
              const on = selected.includes(key);
              return (
                <button
                  type="button" key={key} onClick={() => onToggle(key)}
                  style={{
                    display:'flex', alignItems:'center', gap:10, width:'100%',
                    background:'none', border:'none', padding:'8px 2px',
                    cursor:'pointer', textAlign:'left', minWidth:0,
                  }}
                >
                  <span style={{
                    width:18, height:18, flexShrink:0, borderRadius:5,
                    border:`1.5px solid ${on ? '#00E5A0' : 'rgba(255,255,255,0.25)'}`,
                    background: on ? 'rgba(0,229,160,0.18)' : 'transparent',
                    color:'#00E5A0', fontSize:12, lineHeight:'15px', textAlign:'center',
                    transition:'all .15s',
                  }}>{on ? '✓' : ''}</span>
                  <span style={{
                    fontSize:14, color: on ? 'var(--text)' : 'rgba(255,255,255,0.6)',
                    overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis',
                  }}>
                    {requirementLabel(key)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
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

/* 11C.7 — beta surfaces only the `beta: true` controls. The rest stay defined
   (and fully wired below) so re-enabling them is a one-line flag flip. */
const HOST_CONTROL_INFO = [
  { label: 'Public Event', beta: true, body: 'When on, your event is listed in Discover and searchable by anyone on the app. Turn off to keep it invite-only or while you\'re still setting up.' },
  { label: 'Show Set Times to Artists', beta: true, body: 'Booked artists can see the running order before it is public. Turn it off to keep set times private — each artist only sees their own slot until you choose to reveal the full lineup.' },
  { label: 'Publish Set Times', beta: true, body: 'Show the running order on the public event page. Keep it off to build anticipation or if times are still being confirmed — your artists can still see it via the control above.' },
  { label: 'Artists can remove their own claim', body: 'When on, artists can withdraw from their slot at any time without contacting you. Turn this off if you want full control — no one leaves the lineup without your say.' },
  { label: 'Show ranked backup preferences', body: 'Artists can nominate up to 3 slots they\'d like as a backup if their first choice is taken. Gives the auto-generator better data to fill your lineup fairly.' },
  { label: 'Show genre / vibe pickers', body: 'Adds sound and genre selectors to the application form. Helps you match the right artists to the right slots — especially useful for multi-genre or themed events.' },
  { label: 'Applications open', body: 'Controls whether artists can submit an application to play your event. Turn off once you\'re booked out or want to close submissions without cancelling the event.' },
];

/* Flip to true to restore the full host-controls set (state, persistence and
   behaviour for these are untouched — they are hidden, not removed). */
const SHOW_ADVANCED_HOST_CONTROLS = false;

const VISIBLE_HOST_CONTROL_INFO = HOST_CONTROL_INFO.filter(
  item => SHOW_ADVANCED_HOST_CONTROLS || item.beta
);

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
  const [startTime, setStartTime] = useState('19:00');
  const [endTime,   setEndTime]   = useState('23:00');
  const [slotLen,   setSlotLen]   = useState(60);

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
  // Cover — the Hero image. A separate object from the poster (layout spec §0):
  // it sells the experience and may crop, where the poster preserves artwork
  // and may not. Uploading one supersedes the poster-derived Hero entirely.
  const [cover,       setCover]       = useState('');
  const [coverThumb,  setCoverThumb]  = useState('');
  const [poster,      setPoster]      = useState('');
  const [posterThumb, setPosterThumb] = useState('');
  const [posterFull,  setPosterFull]  = useState('');
  // Which horizontal slice of the poster becomes the Hero when there is no
  // Cover — spec §0.4. 0–100, the same scale `object-position` uses, so what
  // is stored here is literally what the public Hero renders with.
  const [posterCropY, setPosterCropY] = useState(DEFAULT_CROP_Y);
  const [posterDims,  setPosterDims]  = useState(null);   // natural w/h, for the crop geometry
  // How many times narrower than the poster the crop window is. 1 = full
  // width; larger = zoomed in. `cropX` only bites once it is narrower than
  // the poster — at full width there is nowhere horizontal to go.
  const [cropZoom,    setCropZoom]    = useState(1);
  const [cropX,       setCropX]       = useState(50);
  const [cropMode,    setCropMode]    = useState(false);
  // Bands kept off the poster — the carousel (rung 1). Array of plain URLs:
  // the config should stay the simplest thing that survives a hand-edit.
  const [gallery,     setGallery]     = useState([]);
  const [cropBusy,    setCropBusy]    = useState(false);
  const [cropError,   setCropError]   = useState('');
  const [fullView,    setFullView]    = useState(false);
  const cropRef   = useRef(null);
  const dragState = useRef(null);

  // Schedule
  const [setTimesNeeded, setSetTimesNeeded] = useState(true);
  const [days, setDays] = useState([{ id:makeId(), name:'', slots:[] }]);
  const [slotsCollapsed, setSlotsCollapsed] = useState(false);

  // M14b · owning profile (identity v1.3 O-R4). `?as=` is the dashboard the
  // user created from — a convenience that removes the picker in the common
  // case, never a permission: can_act_as re-checks whatever is written (R2).
  const [owners,  setOwners]  = useState([]);
  const [ownerId, setOwnerId] = useState(null);

  // Host controls
  const [isPublic,           setIsPublic]           = useState(true);
  const [appsOpen,           setAppsOpen]           = useState(true);
  const [artistsCanRemove,   setArtistsCanRemove]   = useState(true);
  const [showRankedBackup,   setShowRankedBackup]   = useState(true);
  const [showGenrePickers,   setShowGenrePickers]   = useState(true);
  const [privateSetTimes,    setPrivateSetTimes]    = useState(true);
  const [showTimesPublicly,  setShowTimesPublicly]  = useState(false);
  const [showHostInfo,       setShowHostInfo]       = useState(false);
  // P4 · requirement keys the host ticked. A real `events` column, NOT part of
  // `config` — config is the public event page's payload and requirements are
  // never rendered there.
  const [requiredItems,      setRequiredItems]      = useState([]);

  // Owner resolution. Skipped when editing — an event's owner is set once at
  // creation and changed only by exception (Phase 13 Q6 `T1`, erratum E2), so
  // the edit path must never restamp it.
  useEffect(() => {
    if (editId || !session?.user?.id) return;
    // Full profile objects, not just ids — `type` and `name` are needed by the
    // picker and by venue resolution below.
    getOwnerProfiles(session.user.id, searchParams.get('as')).then(list => {
      setOwners(list);
      setOwnerId(list.length === 1 ? list[0].id : null);
    });
  }, [editId, session?.user?.id, searchParams]);

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
      setCover(c.cover || '');
      setCoverThumb(c.cover_thumb || '');
      setPoster(c.poster || '');
      // Absent means no choice was made, and the Hero uses its top-weighted
      // default — it does NOT mean 0. Reading it as 0 would silently move
      // every existing event's cover band to the very top of its poster.
      setPosterCropY(typeof c.posterCropY === 'number' ? c.posterCropY : DEFAULT_CROP_Y);
      setGallery(Array.isArray(c.gallery) ? c.gallery.filter(u => typeof u === 'string' && u.trim()) : []);
      setPosterThumb(c.poster_thumb || '');
      setPosterFull(c.poster_full || '');
      setIsPublic(data.is_public !== false);
      setAppsOpen(data.applications_open !== false);
      // NULL and '{}' both mean "none declared" — see the P4 migration.
      setRequiredItems(data.required_items || []);
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

  /* ── The crop rectangle over the poster ─────────────────────────────
     A 3:2 window the organiser sizes and moves. `cropZoom` is how many times
     narrower it is than the poster, so 1 is full width and 2 is half — which
     makes "zoomed in" and "a bigger number" agree, and keeps the arithmetic
     below a division rather than a special case.

     Percentages of the POSTER's own displayed box, so nothing needs measuring
     and the overlay cannot drift from what the browser lays out:
       width  = 100 / zoom
       height = (2/3)·(w/h)·100 / zoom      ← a 3:2 slice of that width
     Position travels the LEFTOVER space, exactly like object-position. */
  const cropGeom = (() => {
    if (!poster || !posterDims?.w || !posterDims?.h) return null;
    const { w, h } = posterDims;
    // The rectangle must fit inside the poster. A wide poster cannot hold a
    // full-width 3:2 slice — it would be taller than the image — so its
    // minimum zoom is above 1 rather than the crop being refused.
    const minZoom = Math.max(1, (2 * w) / (3 * h));
    const maxZoom = 4;
    const zoom = Math.min(maxZoom, Math.max(minZoom, cropZoom));
    const wPct = 100 / zoom;
    const hPct = ((2 / 3) * (w / h) * 100) / zoom;
    if (hPct > 100.01) return null;            // unreachable after the clamp; guards a bad dim read
    return {
      minZoom, maxZoom, zoom, wPct, hPct,
      leftPct: (100 - wPct) * (cropX / 100),
      topPct:  (100 - hPct) * (posterCropY / 100),
      canMoveX: wPct < 99.9,
      canMoveY: hPct < 99.9,
    };
  })();

  // Whether the LIVE hero band (posterCropY driving object-position) still
  // describes what the organiser sees. It only can at full width — a zoomed
  // rectangle is not expressible as `object-position` on the original poster,
  // it has to be baked. Kept crops are baked, so they are unaffected.
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
      // Travel is the leftover space, not the whole poster — moving the
      // rectangle its own width is not a 100% change in position.
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
    if (!poster || !cropGeom || cropBusy || gallery.length >= MAX_GALLERY) return;
    setCropBusy(true);
    setCropError('');
    try {
      const { url } = await uploadPosterCrop(
        poster,
        { zoom: cropGeom.zoom, x: cropX, y: posterCropY },
        session?.user?.id,
        makeId(),
      );
      setGallery(g => [...g, url]);
      // The carousel only leads with a Cover (heroMedia rung 1 needs one, and
      // gallery images deliberately do not promote themselves). Without this,
      // an organiser could keep three crops and see none of them. First crop
      // fills an empty cover slot; it is visible in the Cover field above and
      // can be replaced or removed like any other.
      if (!cover) setCover(url);
    } catch (err) {
      console.error('Poster crop failed', err);
      setCropError('Could not save that crop. Try again.');
    } finally {
      setCropBusy(false);
    }
  }

  function addDay() { setDays(p => [...p, { id:makeId(), name:'', slots:[] }]); }
  function removeDay(id) { setDays(p => p.filter(d => d.id!==id)); }
  function updateDayName(id, name) { setDays(p => p.map(d => d.id===id ? {...d,name} : d)); }
  // 1 hr to match the Quick Generator's own default (19:00–23:00 @ 60 min) —
  // a manually added slot shouldn't default to a different length than the
  // generated ones sitting next to it.
  function addSlot(dayId) { setDays(p => p.map(d => d.id!==dayId ? d : {...d, slots:[...d.slots,{id:makeId(),hh:'8',mm:'00',ampm:'PM',dur:60,label:''}]})); }
  function insertSlot(dayId, at) {
    setDays(p => p.map(d => {
      if (d.id!==dayId) return d;
      const slots = [...d.slots];
      slots.splice(at, 0, {id:makeId(),hh:'8',mm:'00',ampm:'PM',dur:60,label:''});
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
      name, date:startDate, endDate, venue, genres:genreText, categoryBadge: categoryBadge || null, openMicBadge: openMicBadge || null, ticketLink, bio,
      cover, cover_thumb:coverThumb, gallery,
      poster, poster_thumb:posterThumb, poster_full:posterFull,
      // ⭐ THE WRITE THAT WAS MISSING. The editor has had a drag-to-reposition
      // control since it was built and never saved its result anywhere, so the
      // public Hero always used the default band no matter what was chosen.
      // Only meaningful when there is a poster and no cover; harmless
      // otherwise, and kept so removing a cover restores the chosen band.
      posterCropY: poster ? posterCropY : null,
      is_public:isPublic, applications_open:appsOpen,
      days: setTimesNeeded ? days.map(d => ({ name:d.name, slots:d.slots.map(slotToSave) })) : [],
      host_controls_config: { artistsCanRemove, showRankedBackup, showGenrePickers, privateSetTimes, showTimesPublicly },
    };

    if (editId) {
      const { error:err } = await supabase.from('events').update({ name, config:cfg, is_public:isPublic, applications_open:appsOpen, required_items:requiredItems }).eq('id', editId);
      setSaving(false);
      if (err) { setError(err.message); return; }
      navigate(`/event/${editId}`, { replace:true });
      return;
    }

    // M14b (identity v1.3 O-R4/O-R6): an event must name its owning profile
    // at creation. venue_profile_id answers WHERE; owner_profile_id answers
    // WHO IS ACCOUNTABLE; host_id records the human. Three columns, three
    // questions — they coincide for a venue running its own night, and that
    // is a coincidence of values rather than of meaning.
    if (!ownerId) {
      setSaving(false);
      setError(owners.length > 1
        ? 'Choose which profile is hosting this event.'
        : 'You need a host or venue profile before you can create an event.');
      return;
    }

    // M14c fix · venue_profile_id is LOCATION, not ownership (v1.3 O-R4).
    //
    // It previously read `resolveProfileId(session.user.id, 'venue')` — the
    // CREATOR's own venue profile — so every event created by an account that
    // owns a venue was stamped with that venue regardless of where the gig
    // actually was. The M14c dry run found all 24 existing events pointing at
    // one venue while their config.venue named four different places.
    //
    // Linked only when the evidence supports it: the owning profile IS the
    // venue, and the typed venue name is blank or matches it. A promoter's
    // event at someone else's room resolves to NULL, which is correct and
    // honest — the venue link is optional (v1.3 O-R4: warehouses, parks,
    // house shows). Resolving it properly for those needs a venue picker,
    // which is a feature rather than a defect fix.
    const ownerProfile = owners.find(o => o.id === ownerId) || null;
    const typed  = (venue || '').trim().toLowerCase();
    const ownNm  = (ownerProfile?.name || '').trim().toLowerCase();
    const venueProfileId =
      ownerProfile?.type === 'venue' && (!typed || typed === ownNm)
        ? ownerProfile.id
        : null;

    const { data, error:err } = await supabase.from('events').insert({
      name, config:cfg, host_id:session.user.id,
      owner_profile_id: ownerId,
      status: goLive ? 'live' : 'draft',
      is_public:isPublic, applications_open:appsOpen,
      venue_profile_id: venueProfileId,
      required_items: requiredItems,
    }).select('id').single();
    setSaving(false);
    if (err) { setError(err.message); return; }

    // A1 · two separate facts, not one. Creating is the effort; going live is
    // the outcome, and an event saved as a draft has not been published. They
    // coincide here only when the host used "go live" on the create form —
    // a draft published later fires PUBLISHED_EVENT from EventScreen instead.
    track(EVENTS.CREATED_EVENT, { go_live: !!goLive });
    if (goLive) track(EVENTS.PUBLISHED_EVENT, { from: 'create' });

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

        {/* ── HOSTING AS (M14b) ── moved above EVENT DETAILS: which of the
            account's owner-eligible profiles this event belongs to is
            decided before anything else about the event, not tucked in
            after slots and posters. Still only rendered when genuinely
            ambiguous — nothing is pre-selected, since a default here would
            be a guess wearing a confirmation, and ownership is the one
            field that must not be guessed (O-R6). Same chip pattern as the
            apply form. */}
        {!editId && owners.length > 1 && (
          <>
            <SectionHeader label="HOSTING AS" />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {owners.map(p => {
                const on = p.id === ownerId;
                return (
                  <button key={p.id} type="button" onClick={() => setOwnerId(p.id)}
                    style={{
                      padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                      fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: 1,
                      border: `1px solid ${on ? 'var(--neon2)' : 'var(--border)'}`,
                      background: on ? 'rgba(0,229,255,.12)' : 'none',
                      color: on ? 'var(--neon2)' : 'var(--muted)',
                    }}>
                    {p.name || '(unnamed)'} · {PROFILE_TYPES[p.type]?.shortLabel || p.type}
                  </button>
                );
              })}
            </div>
          </>
        )}

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
            const openMicOpt = OPEN_MIC_BADGE;
            return (
              <div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  {CATEGORY_CHOICES.map(opt => {
                    // sameCategory, not ===, so an event saved before the labels
                    // were canonicalised ("Live Music") still highlights its chip.
                    const manualActive = sameCategory(categoryBadge, opt.label);
                    const autoActive = !categoryBadge && sameCategory(auto[0]?.label, opt.label);
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
                {sameCategory(categoryBadge, CATEGORY_BADGES.LIVE_MUSIC.label) && sameCategory(auto[0]?.label, CATEGORY_BADGES.DJS.label) && (
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

        {/* ── EVENT COVER (layout spec §0) ──
            Above the poster deliberately: it is the top of the public page, so
            it is the first image decision, and its presence changes what the
            poster is FOR (artwork to keep, rather than the thing being
            cropped into a Hero). */}
        <div className={s.field}>
          <p className={s.fieldLabel}>EVENT COVER (optional)</p>
          <p className={s.fieldSub}>
            The big image at the top of your event page · 3:2 landscape.
            A crowd, the room, the act on stage — it sets the mood and may be cropped.
          </p>
          <ImageUploadButton
            type="cover"
            userId={session?.user?.id}
            onUpload={({ cover:c, cover_thumb:t }) => { setCover(c); setCoverThumb(t); }}
          >
            {({ trigger, statusBadge }) => (
              <div style={{ position:'relative' }}>
                <div
                  onClick={!cover ? trigger : undefined}
                  style={{
                    position:'relative', width:'100%', aspectRatio:'3 / 2',
                    borderRadius:12, overflow:'hidden',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    background: cover ? 'transparent' : 'rgba(255,255,255,0.05)',
                    border: cover ? 'none' : '2px dashed rgba(255,255,255,0.18)',
                    cursor: cover ? 'default' : 'pointer',
                  }}
                >
                  {cover
                    ? <img src={cover} alt="cover" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                    : <div style={{ textAlign:'center', color:'rgba(255,255,255,0.4)', fontSize:13 }}>
                        <div style={{ fontSize:28, marginBottom:6 }}>+</div>
                        <div>Tap to add a cover</div>
                      </div>}
                  {statusBadge}
                </div>
                {cover && (
                  <div style={{ display:'flex', gap:8, marginTop:8 }}>
                    <button type="button" onClick={trigger}
                      style={{ flex:1, padding:'8px', borderRadius:8, cursor:'pointer', background:'rgba(255,255,255,0.06)', border:'1px solid var(--border)', color:'var(--text)', fontFamily:"'Bebas Neue'", fontSize:12, letterSpacing:1.5 }}>
                      REPLACE
                    </button>
                    {/* Clearing drops the event back to the poster-derived Hero
                        (§0.3 rungs 4–6), which is where it was before — not to
                        no Hero at all. */}
                    <button type="button" onClick={() => { setCover(''); setCoverThumb(''); }}
                      style={{ flex:1, padding:'8px', borderRadius:8, cursor:'pointer', background:'rgba(255,80,80,0.08)', border:'1px solid rgba(255,80,80,0.3)', color:'var(--muted)', fontFamily:"'Bebas Neue'", fontSize:12, letterSpacing:1.5 }}>
                      REMOVE
                    </button>
                  </div>
                )}
              </div>
            )}
          </ImageUploadButton>
        </div>

        <div className={s.field}>
          <p className={s.fieldLabel}>EVENT POSTER</p>
          <p className={s.fieldSub}>Optional — the flyer as it was designed · any shape · shown whole at the bottom of the page</p>
          <ImageUploadButton type="poster" userId={session?.user?.id} onUpload={({ poster:p, poster_thumb:t, poster_full:f }) => { setPoster(p); setPosterThumb(t); setPosterFull(f||''); setPosterCropY(DEFAULT_CROP_Y); setCropMode(false); }}>
            {({ trigger, statusBadge }) => (
              <div>
                {/* ── The poster, WHOLE, with the cover band over it (spec §0.4) ──
                    The old control dragged the image around inside a fixed 4:5
                    window, which showed a crop of a poster that is not itself
                    cropped, and saved nothing. This shows the artwork at its own
                    shape and moves a BAND over it — the band being the thing that
                    is actually chosen. */}
                <div
                  ref={cropRef}
                  // ⚠ NO maxHeight. The crop overlay is positioned in
                  // percentages of THIS box, so the box must be exactly the
                  // poster's box — a height cap clipped the image and left the
                  // window computing against a container shorter than the
                  // picture, putting the crop rectangle somewhere the poster
                  // was not. Size is limited by WIDTH instead, which the image
                  // follows proportionally and the percentages survive.
                  style={{ width:'100%', maxWidth:400, margin:'0 auto', borderRadius:10, overflow:'hidden', position:'relative',
                    background: poster ? 'transparent' : 'rgba(255,255,255,0.05)',
                    border: poster ? 'none' : '2px dashed rgba(255,255,255,0.18)',
                    aspectRatio: poster ? undefined : '4/5',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    cursor: poster ? 'default' : 'pointer', userSelect:'none',
                  }}
                  onClick={!poster ? trigger : undefined}
                >
                  {poster
                    ? <img src={poster} alt="poster"
                        onLoad={e => setPosterDims({ w:e.target.naturalWidth, h:e.target.naturalHeight })}
                        style={{ width:'100%', display:'block', pointerEvents:'none' }} />
                    : <div style={{ textAlign:'center', color:'rgba(255,255,255,0.4)', fontSize:13 }}><div style={{ fontSize:28, marginBottom:6 }}>+</div><div>Tap to add poster</div></div>
                  }

                  {/* The crop window — a 3:2 rectangle the organiser sizes with
                      the zoom slider and moves by dragging. Everything outside
                      it dims, so what is being chosen is what stays lit. */}
                  {poster && cropMode && cropGeom && (
                    <>
                      <div style={{ position:'absolute', inset:0, background:'rgba(10,10,20,.72)', pointerEvents:'none' }} />
                      <div
                        onMouseDown={startCropDrag}
                        onTouchStart={startCropDrag}
                        style={{ position:'absolute',
                          left:`${cropGeom.leftPct}%`, top:`${cropGeom.topPct}%`,
                          width:`${cropGeom.wPct}%`, height:`${cropGeom.hPct}%`,
                          // OUTLINE, not border: a border sits inside the box
                          // and pushes the window's content in by its width,
                          // so the poster showing through was offset from the
                          // poster behind it by exactly 2px on every edge. An
                          // outline draws outside the box and costs no layout.
                          outline:'2px solid var(--neon2)',
                          cursor:(cropGeom.canMoveX || cropGeom.canMoveY) ? 'grab' : 'default',
                          boxShadow:'0 0 0 9999px rgba(0,0,0,0)', overflow:'hidden',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {/* The rectangle shows the poster UNDIMMED — it is a
                            window onto the image, not a box drawn over a
                            uniformly darkened one. Positioned by the same
                            percentages, at the poster's full size. */}
                        <img src={poster} alt="" aria-hidden="true"
                          style={{ position:'absolute',
                            width:`${100 / (cropGeom.wPct / 100)}%`, maxWidth:'none',
                            left:`${-cropGeom.leftPct / (cropGeom.wPct / 100)}%`,
                            top:`${-cropGeom.topPct / (cropGeom.hPct / 100)}%`,
                            height:`${100 / (cropGeom.hPct / 100)}%`,
                            pointerEvents:'none' }} />
                        {(cropGeom.canMoveX || cropGeom.canMoveY) && (
                          <div style={{ position:'relative', background:'rgba(0,229,255,0.15)', border:'1px dashed rgba(0,229,255,0.5)', borderRadius:6, padding:'6px 12px', fontSize:11, fontFamily:"'Bebas Neue'", letterSpacing:2, color:'var(--neon2)', pointerEvents:'none' }}>
                            DRAG TO MOVE
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  {statusBadge}
                </div>

                {/* Zoom, then what the rectangle is for. */}
                {poster && cropMode && cropGeom && (
                  <div style={{ marginTop:10 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <span style={{ fontFamily:"'Bebas Neue'", fontSize:11, letterSpacing:2, color:'var(--muted)' }}>ZOOM</span>
                      <input
                        type="range" min={cropGeom.minZoom} max={cropGeom.maxZoom} step={0.01}
                        value={cropGeom.zoom}
                        onChange={e => setCropZoom(Number(e.target.value))}
                        style={{ flex:1, accentColor:'var(--neon2)' }}
                      />
                      <span style={{ fontSize:11, color:'var(--muted)', minWidth:34, textAlign:'right' }}>
                        {cropGeom.zoom.toFixed(1)}×
                      </span>
                      {/* Back to the whole width in one tap — dragging a slider
                          back to exactly its minimum is a fiddle. */}
                      <button type="button" onClick={() => { setCropZoom(cropGeom.minZoom); setCropX(50); }}
                        style={{ padding:'5px 10px', borderRadius:7, cursor:'pointer', fontFamily:"'Bebas Neue'", fontSize:10, letterSpacing:1.2,
                          background:'rgba(255,255,255,0.06)', border:'1px solid var(--border)', color:'var(--muted)' }}>
                        FIT
                      </button>
                    </div>
                  </div>
                )}

                {poster && cropMode && (
                  <p style={{ fontSize:12, color:'rgba(255,255,255,0.5)', lineHeight:1.5, marginTop:8 }}>
                    {!cropGeom
                      ? 'Add a poster to start cropping.'
                      : cover
                        ? 'Zoom and drag to frame a slice, then keep it. The top of the page uses your Event Cover; kept slices join the carousel behind it.'
                        : 'Zoom and drag to frame a slice, then keep it. Your first kept slice becomes the cover at the top of the page.'}
                    {cropGeom && !bandMatchesHero && !cover && gallery.length === 0 && (
                      <> <span style={{ color:'#FFD700' }}>Zoomed in, so this framing only applies once you keep it — until then the top of the page uses the full width of the poster.</span></>
                    )}
                  </p>
                )}

                {/* Keep the current rectangle, and everything kept so far. */}
                {poster && cropMode && cropGeom && (
                  <div style={{ marginTop:10 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <button type="button" onClick={keepCrop}
                        disabled={cropBusy || gallery.length >= MAX_GALLERY}
                        style={{ padding:'9px 16px', borderRadius:8, cursor: (cropBusy || gallery.length >= MAX_GALLERY) ? 'default':'pointer',
                          fontFamily:"'Bebas Neue'", fontSize:12, letterSpacing:1.5,
                          background:'rgba(0,229,160,0.12)', border:'1px solid rgba(0,229,160,0.45)', color:'#00E5A0',
                          opacity:(cropBusy || gallery.length >= MAX_GALLERY) ? .5 : 1 }}>
                        {cropBusy ? 'SAVING…' : '+ KEEP THIS CROP'}
                      </button>
                      <span style={{ fontSize:11, color:'var(--muted)' }}>
                        {gallery.length}/{MAX_GALLERY} kept
                      </span>
                    </div>
                    {cropError && <p style={{ fontSize:12, color:'#ff5050', marginTop:6 }}>{cropError}</p>}
                  </div>
                )}

                {/* The strip. Shown whenever there is anything in it, not only
                    in crop mode — what you have made should not disappear the
                    moment you stop making more. */}
                {gallery.length > 0 && (
                  <div style={{ marginTop:12 }}>
                    <p style={{ fontFamily:"'Bebas Neue'", fontSize:11, letterSpacing:2, color:'var(--muted)', margin:'0 0 6px' }}>
                      CAROUSEL IMAGES
                    </p>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      {gallery.map((url, i) => (
                        <div key={url} style={{ position:'relative', width:104, aspectRatio:'3/2', borderRadius:8, overflow:'hidden', border:'1px solid var(--border)' }}>
                          <img src={url} alt={`Crop ${i+1}`} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
                          {/* Removing a crop that is also the cover clears the
                              cover too, rather than leaving the page pointing
                              at an image no longer in the list. */}
                          <button type="button"
                            onClick={() => { setGallery(g => g.filter(u => u !== url)); if (cover === url) { setCover(''); setCoverThumb(''); } }}
                            aria-label={`Remove crop ${i+1}`}
                            style={{ position:'absolute', top:4, right:4, width:20, height:20, borderRadius:10, cursor:'pointer',
                              display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1,
                              background:'rgba(10,10,20,.8)', border:'1px solid rgba(255,255,255,.25)', color:'#fff', fontSize:12 }}>
                            ✕
                          </button>
                          {cover === url && (
                            <span style={{ position:'absolute', left:4, bottom:4, fontFamily:"'Bebas Neue'", fontSize:9, letterSpacing:1,
                              background:'rgba(0,229,255,.9)', color:'#0a0a14', borderRadius:3, padding:'1px 5px' }}>COVER</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action tabs */}
                {poster && (
                  <div className={s.posterTabs}>
                    <button type="button" className={s.posterTab} onClick={() => setFullView(true)}>Full view</button>
                    <button type="button" className={cropMode ? s.posterTabActive : s.posterTab} onClick={() => setCropMode(m => !m)}>Adjust cover</button>
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

        {/* ── REQUIREMENTS ──
            Sits before HOST CONTROLS: what you ask of applicants is part of
            defining the opportunity, whereas host controls govern how the
            event runs once people are in it. */}
        <SectionHeader label="REQUIREMENTS" />
        <RequirementChecklist
          selected={requiredItems}
          onToggle={key => setRequiredItems(p => p.includes(key) ? p.filter(k => k !== key) : [...p, key])}
        />

        {/* ── HOST CONTROLS ── */}
        <SectionHeader label="HOST CONTROLS" onInfo={() => setShowHostInfo(true)} />
        <div className={s.controlsCard}>
          <Toggle label="Public Event"                         sub="Visible in Discover to anyone browsing"                                     value={isPublic}          onChange={setIsPublic} />
          <div className={s.controlsGroupDivider} />
          <Toggle label="Show Set Times to Artists"            sub="Booked artists can see the running order before it is public."              value={!privateSetTimes}  onChange={v => setPrivateSetTimes(!v)} />
          <Toggle label="Publish Set Times"                    sub="Show the running order on the public event page."                           value={showTimesPublicly} onChange={setShowTimesPublicly} />

          {SHOW_ADVANCED_HOST_CONTROLS && (<>
            <div className={s.controlsGroupDivider} />
            <Toggle label="Artists can remove their own claim" sub="When off, only the host can clear slots"                                     value={artistsCanRemove}  onChange={setArtistsCanRemove} />
            <Toggle label="Show ranked backup preferences"     sub="Artists rank up to 3 preferred slots for the generator"                      value={showRankedBackup}  onChange={setShowRankedBackup} />
            <Toggle label="Show genre / vibe pickers"          sub="Collect musical style info from artists"                                     value={showGenrePickers}  onChange={setShowGenrePickers} />
            <Toggle label="Applications open"                  sub="Allow artists to apply to this event"                                       value={appsOpen}          onChange={setAppsOpen} />
          </>)}
        </div>

        {/* Host controls info modal */}
        {showHostInfo && (
          <div style={{position:'fixed',inset:0,zIndex:9000,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'flex-end',justifyContent:'center',paddingBottom:'var(--yp-safe-bottom)'}} onClick={() => setShowHostInfo(false)}>
            <div onClick={e => e.stopPropagation()} className={s.hostInfoSheet}>
              <div style={{width:36,height:4,borderRadius:2,background:'rgba(255,255,255,0.2)',margin:'0 auto 20px'}} />
              <p style={{fontFamily:"'Bebas Neue'",fontSize:16,letterSpacing:3,background:'linear-gradient(135deg,#00E5FF,#BF5FFF)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',marginBottom:20}}>HOST CONTROLS EXPLAINED</p>
              {VISIBLE_HOST_CONTROL_INFO.map(item => (
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
