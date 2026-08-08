import { useState, useEffect, useRef } from "react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, horizontalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
/**
 * ⚠ Still the screen’s stylesheet, deliberately. Renaming it would change
 * every class name in the same commit as a 500-line move, and the point of this
 * extraction is that the markup is byte-identical. Rename it separately.
 */
import s from "./EventEditor.module.css";
import { requestableBySection, requirementLabel } from "@yespleez/requirements";
import { DEFAULT_CROP_Y, MAX_SLIDES } from "@yespleez/event-presentation";
import { makeId, generateSlots } from "./eventEditorModel.js";

/**
 * THE EVENT EDITOR — one implementation, however many applications.
 *
 * ⭐⭐ WHAT THIS BUYS: every application that edits an event renders THIS file.
 * Not a shared look, not a copied component. Every future improvement to event
 * editing lands everywhere at once, and no two can drift apart.
 *
 * ⛔ PURE. No routing, no session lookup, no database client, no navigation. It
 * takes form state (from useEventEditorState) plus callbacks, and renders. The
 * host owns loading and saving.
 *
 * ⛔ The page wrapper and heading belong to the HOST. One may want a full-page
 * layout with a heading; another may place this inside existing chrome. Either
 * living in here would make every host wear the first one's clothes.
 *
 * ⛔ The markup below was extracted unchanged. Its dependencies are injected —
 * see the prop contract on the component.
 */
const CAL_DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DUR_PRESETS = [{ label:'1 HR', mins:60 },{ label:'1.5 HRS', mins:90 },{ label:'2 HRS', mins:120 },{ label:'OTHER', mins:null }];

/**
 * ⭐ The slot shape and the config mapping live in eventEditorModel.js so every
 * host uses the identical ones. Re-exported here only as imports — nothing
 * about them changed.
 */

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

/* ── One carousel slide, draggable ───────────────────────────────────────
 *
 * The tile is the drag handle — there is no separate grip, because the whole
 * point is "pick the picture up and put it where you want it".
 *
 * ⚠ The ✕ deliberately does NOT carry the drag listeners. A pointer-down on a
 * child of a draggable starts a drag, and an 8px activation distance means a
 * tap that wobbles becomes a drag instead of a delete — so the button stops
 * the event before dnd-kit ever sees it.
 */
function SortableSlide({ url, index, total, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: url });
  const first = index === 0;
  return (
    <div ref={setNodeRef}
      // Must match the empty slot's width exactly, or the six-across strip
      // reflows as images are added and removed.
      style={{ width:104, transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.4 : 1, zIndex: isDragging ? 2 : 1, position:'relative' }}>
      <div {...attributes} {...listeners}
        style={{ position:'relative', width:'100%', aspectRatio:'3/2', borderRadius:9, overflow:'hidden',
          cursor:'grab', touchAction:'none',
          border: first ? '2px solid var(--neon2)' : '1px solid var(--border)' }}>
        <img src={url} alt={`Slide ${index+1}`} draggable={false}
          style={{ width:'100%', height:'100%', objectFit:'cover', display:'block', pointerEvents:'none' }} />
        <span style={{ position:'absolute', top:4, left:4, minWidth:17, height:17, borderRadius:9,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontFamily:"'Bebas Neue'", fontSize:10, letterSpacing:.5,
          background: first ? 'var(--neon2)' : 'rgba(10,10,20,.85)',
          color: first ? '#0a0a14' : '#fff',
          border: first ? 'none' : '1px solid rgba(255,255,255,.25)' }}>{index+1}</span>
        {first && (
          <span style={{ position:'absolute', left:4, bottom:4, fontFamily:"'Bebas Neue'", fontSize:9, letterSpacing:1,
            background:'var(--neon2)', color:'#0a0a14', borderRadius:3, padding:'1px 5px' }}>SHOWS FIRST</span>
        )}
      </div>
      <button type="button"
        onPointerDown={e => e.stopPropagation()}
        onClick={onRemove}
        aria-label={`Remove slide ${index+1} of ${total}`}
        style={{ position:'absolute', top:4, right:4, width:20, height:20, borderRadius:10, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1,
          background:'rgba(10,10,20,.85)', border:'1px solid rgba(255,255,255,.25)', color:'#fff', fontSize:11 }}>✕</button>
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
/**
 * ⭐ WHAT THIS COMPONENT IS GIVEN, AND WHY.
 *
 * Everything below is something the editor used to import and must not: a
 * vocabulary, a label, a component that performs I/O, or an adornment. The
 * editor knows how to edit an event. It does not know whose event it is, what
 * categories exist in that world, where images are stored, or what advice a
 * host should be offered — and it must not learn, or it stops being one editor
 * and becomes two behind a flag.
 *
 * @param categories       {choices, openMic?, classify(genreText, name), isSame(a,b)}
 *                         A classification SERVICE, not a list. `classify` is a
 *                         function because one caller infers a category from
 *                         free text while another has the organiser choose;
 *                         returning [] is normal and must render correctly.
 *                         `openMic` is optional — omit it and no such chip
 *                         appears.
 * @param labelProfileType (type) => string. Which short label a profile type
 *                         shows. The registries differ between callers and one
 *                         of them deliberately has no entry for the other's.
 * @param components       {ImageUploadButton?, CoHostPicker?} Anything that
 *                         touches storage or queries profiles. Editing an event
 *                         is platform; where the bytes go is the caller's
 *                         business. CoHostPicker is OPTIONAL — omit it and the
 *                         whole section disappears, because not every world
 *                         has co-hosts.
 * @param userId           string | null. The ONE datum this needs about the
 *                         person editing, and it is passed to the injected
 *                         upload component. ⛔ Deliberately not a session: the
 *                         editor authenticates nobody, and taking a session
 *                         object would bind it to one auth library's shape.
 * @param actions          ReactNode. The host's own buttons. ⛔ The editor
 *                         ships none — "go live", "save as draft" and "delete"
 *                         are workflow decisions in one world's vocabulary,
 *                         and another may Save · Review · Publish. Read
 *                         `ed.toConfig()` for the model and decide out there.
 * @param adornments       {categoryHint?} Presentation-only extension points.
 *                         ⛔ An adornment may render. It may NOT mutate editor
 *                         state, take part in validation, influence
 *                         serialisation, or change what is saved. The editor
 *                         remains the sole authority over event state.
 *                         (Named `adornments`, not `slots` — this domain
 *                         already uses "slot" for a performance slot.)
 */
export default function EventEditorForm({
  ed, editId, userId,
  categories, labelProfileType, components, adornments = {}, actions = null,
}) {
  const { ImageUploadButton, CoHostPicker } = components;
  const {
    name, setName, startDate, setStartDate, endDate, setEndDate,
    venue, setVenue, genreText, setGenreText,
    categoryBadge, setCategoryBadge, openMicBadge, setOpenMicBadge,
    ticketLink, setTicketLink, bio, setBio,
    slides, setSlides, poster, setPoster, setPosterThumb,
    setPosterFull, setPosterCropY,
    setPosterDims, setCropZoom, setCropX,
    cropMode, setCropMode, mediaTab, setMediaTab, cropBusy,
    cropError, fullView, setFullView,
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
    cropRef, dragSensors, cropGeom, bandMatchesHero,
    startCropDrag, keepCrop,
    addDay, removeDay, updateDayName,
    addSlot, insertSlot, updateSlot, removeSlot,
  } = ed;

  return (
    <>

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
                    {p.name || "(unnamed)"} · {labelProfileType(p.type)}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ⭐ CO-HOSTS. Billed equally in § 10, and that is ALL they get — the
            main host above stays the only profile that can edit this event,
            decide applications or receive its notifications. Enforced in
            `event_hosts`'s RLS rather than asserted here. */}
        {CoHostPicker && (
          <>
            <SectionHeader label="CO-HOSTS" />
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              Billed alongside you on the event page. They can’t edit the event.
            </div>
            <CoHostPicker
              eventId={editId || null}
              ownerId={ownerId}
              value={coHosts}
              onChange={setCoHosts}
            />
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
            // classify may legitimately return [] — a caller whose organiser
            // picks the category outright has nothing to infer from.
            const auto = categories.classify(genreText, name) || [];
            const openMicOpt = categories.openMic;
            return (
              <div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  {categories.choices.map(opt => {
                    // isSame, not ===, so an event saved before the labels
                    // were canonicalised ("Live Music") still highlights its chip.
                    const manualActive = categories.isSame(categoryBadge, opt.label);
                    const autoActive = !categoryBadge && categories.isSame(auto[0]?.label, opt.label);
                    const active = manualActive || autoActive;
                    return (
                      <button key={opt.label} type="button" onClick={() => setCategoryBadge(manualActive ? '' : opt.label)}
                        style={{ fontFamily: "'DM Sans'", fontSize: 11, fontWeight: 700, letterSpacing: .8, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${active ? 'transparent' : 'rgba(255,255,255,.15)'}`, background: active ? opt.bg : 'rgba(255,255,255,.05)', color: active ? opt.col : 'rgba(255,255,255,.5)', transition: 'all .15s' }}>
                        {opt.label}
                      </button>
                    );
                  })}
                  {openMicOpt && (
                    <button type="button" onClick={() => setOpenMicBadge(v => !v)}
                      style={{ fontFamily: "'DM Sans'", fontSize: 11, fontWeight: 700, letterSpacing: .8, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${openMicBadge ? 'transparent' : 'rgba(255,255,255,.15)'}`, background: openMicBadge ? openMicOpt.bg : 'rgba(255,255,255,.05)', color: openMicBadge ? openMicOpt.col : 'rgba(255,255,255,.5)', transition: 'all .15s' }}>
                      {openMicOpt.label}
                    </button>
                  )}
                </div>
                {!categoryBadge && auto.length > 0 && (
                  <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>Auto-detected from your genres: <strong style={{ color: 'var(--text)' }}>{auto[0].label}</strong> — select above to override</p>
                )}
                {/* ⛔ ADORNMENT, not logic. Whether "you chose Live Music but
                    your genres read as DJ" is worth saying is a judgement about
                    one world's taxonomy, and the editor has no business holding
                    an opinion about it. Render-only: it cannot change what is
                    selected or what is saved. */}
                {adornments.categoryHint?.({
                  selected:  categoryBadge,
                  suggested: auto[0] || null,
                  isSame:    categories.isSame,
                })}
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
        {/* ── EVENT MEDIA — three jobs, three panels ──
            Picking the lead image, building the swipe, and keeping the artwork
            are separate tasks, so they get separate panels rather than one
            long stack of image controls.

            ⚠ THE STRIP SITS OUTSIDE THE TABS, always visible. It is the
            answer to "what have I got and how much room is left", and that
            question does not stop mattering because you switched to the
            poster — cropping the poster feeds this strip, so hiding it there
            would hide the thing being filled. */}
        <div className={s.field}>
          <p className={s.fieldLabel}>EVENT MEDIA</p>

          {/* ⛔ THE TABS ARE UPLOAD SURFACES. Both panels below exist to add or
              replace an image, so with no upload capability there is nothing
              for them to switch between. The strip stays: existing media is
              part of the event model and is still shown, reordered and
              removed — those are edits to the event, not to storage. */}
          {ImageUploadButton && (
            <div className={s.posterTabs} style={{ marginTop:0, marginBottom:12 }}>
              {[['cover','COVER IMAGE'], ['poster','EVENT POSTER']].map(([key, label]) => (
                <button key={key} type="button"
                  className={mediaTab === key ? s.posterTabActive : s.posterTab}
                  onClick={() => setMediaTab(key)}>{label}</button>
              ))}
            </div>
          )}

          {/* ── COVER IMAGE ── slot 1, shown large because it is the one that
              carries the top of the page on its own. */}
          {ImageUploadButton && mediaTab === 'cover' && (
            <div>
              <p className={s.fieldSub} style={{ marginTop:0 }}>
                The big image at the top of your event page · 3:2 landscape.
                It shows on its own, and leads the carousel if you add more.
              </p>
              <ImageUploadButton type="cover" userId={userId}
                onUpload={({ cover:c }) => setSlides(s => (s.length ? [c, ...s.slice(1)] : [c]))}>
                {({ trigger, statusBadge }) => (
                  <div>
                    <div onClick={!slides[0] ? trigger : undefined}
                      style={{ width:'100%', maxWidth:420, aspectRatio:'3/2', borderRadius:10, overflow:'hidden', position:'relative',
                        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                        background: slides[0] ? 'transparent' : 'rgba(0,229,255,0.06)',
                        border: slides[0] ? 'none' : '2px dashed rgba(0,229,255,0.45)',
                        cursor: slides[0] ? 'default' : 'pointer',
                        color:'var(--neon2)' }}>
                      {slides[0]
                        ? <img src={slides[0]} alt="cover" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                        : <><div style={{ fontSize:26, lineHeight:1 }}>+</div><div style={{ fontSize:12, marginTop:4 }}>Add a cover image</div></>}
                      {statusBadge}
                    </div>
                    {slides[0] && (
                      <div style={{ display:'flex', gap:8, marginTop:8, maxWidth:420 }}>
                        <button type="button" onClick={trigger}
                          style={{ flex:1, padding:'8px', borderRadius:8, cursor:'pointer', background:'rgba(255,255,255,0.06)', border:'1px solid var(--border)', color:'var(--text)', fontFamily:"'Bebas Neue'", fontSize:12, letterSpacing:1.5 }}>
                          REPLACE
                        </button>
                        {/* Removing the cover promotes slide 2 — slot 1 IS the
                            cover, so the list simply loses its head rather
                            than developing a hole nothing can represent. */}
                        <button type="button" onClick={() => setSlides(s => s.slice(1))}
                          style={{ flex:1, padding:'8px', borderRadius:8, cursor:'pointer', background:'rgba(255,80,80,0.08)', border:'1px solid rgba(255,80,80,0.3)', color:'var(--muted)', fontFamily:"'Bebas Neue'", fontSize:12, letterSpacing:1.5 }}>
                          REMOVE
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </ImageUploadButton>
            </div>
          )}

          {/* ── THE STRIP — outside the tabs, always visible ──
              Six slots whether filled or not: an empty strip that only appears
              once you have images tells a first-time organiser neither that
              the feature exists nor how much room is left. Slot 1 is the
              cover; the rest follow in order. Drag to reorder. */}
          <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid rgba(255,255,255,.08)' }}>
            <p style={{ fontFamily:"'Bebas Neue'", fontSize:11, letterSpacing:2, color:'var(--muted)', margin:'0 0 8px' }}>
              YOUR IMAGES — SLOT 1 IS THE COVER
            </p>
          <DndContext sensors={dragSensors} collisionDetection={closestCenter}
            onDragEnd={({ active, over }) => {
              if (!over || active.id === over.id) return;
              setSlides(s => arrayMove(s, s.indexOf(active.id), s.indexOf(over.id)));
            }}>
            {/* Keyed by URL, unique per upload — a slide keeps its identity
                across a reorder, so React cannot reuse the wrong <img>. */}
            <SortableContext items={slides} strategy={horizontalListSortingStrategy}>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {Array.from({ length: MAX_SLIDES }, (_, i) => {
                  const url = slides[i];
                  if (url) {
                    return (
                      <SortableSlide key={url} url={url} index={i} total={slides.length}
                        onRemove={() => setSlides(s => s.filter(u => u !== url))} />
                    );
                  }
                  // The next free slot is where an upload actually lands, so
                  // it is the one drawn as an invitation; the rest are the
                  // same control shown quietly, as remaining room.
                  const isNext = i === slides.length;
                  // ⛔ An empty slot IS an upload affordance. With no upload
                  // capability there is nothing to invite, so the strip shows
                  // what exists and stops — rather than six dashed boxes that
                  // do nothing when tapped.
                  if (!ImageUploadButton) return null;
                  return (
                    <ImageUploadButton key={`slot-${i}`} type="cover" userId={userId}
                      onUpload={({ cover:c }) => setSlides(s => [...s, c].slice(0, MAX_SLIDES))}>
                      {({ trigger, statusBadge }) => (
                        <div onClick={trigger}
                          style={{ width:104, aspectRatio:'3/2', borderRadius:9, cursor:'pointer', position:'relative',
                            display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                            background: isNext ? 'rgba(0,229,255,0.06)' : 'rgba(255,255,255,0.03)',
                            border: isNext ? '2px dashed rgba(0,229,255,0.45)' : '1px dashed rgba(255,255,255,0.14)',
                            color: isNext ? 'var(--neon2)' : 'rgba(255,255,255,0.28)' }}>
                          <div style={{ fontSize:22, lineHeight:1 }}>+</div>
                          {isNext && <div style={{ fontSize:10, marginTop:3 }}>Add image</div>}
                          <span style={{ position:'absolute', top:4, left:4, minWidth:16, height:16, borderRadius:8,
                            display:'flex', alignItems:'center', justifyContent:'center',
                            fontFamily:"'Bebas Neue'", fontSize:9,
                            background:'rgba(255,255,255,.06)', color:'rgba(255,255,255,.35)' }}>{i+1}</span>
                          {statusBadge}
                        </div>
                      )}
                    </ImageUploadButton>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>

          <p style={{ fontSize:11, color:'var(--muted)', marginTop:8 }}>
            {slides.length}/{MAX_SLIDES} ·{' '}
            {slides.length === 0
              ? 'With none here, the top of the page falls back to a slice of the poster.'
              : slides.length === 1
                ? 'One image shows still; add another to make it a carousel.'
                : `Swipes through ${slides.length} images.`}
          </p>
          </div>
        </div>

        {/* ── EVENT POSTER — its own tab. The artwork you keep, and the
            source the carousel crops come from. */}
        {ImageUploadButton && mediaTab === 'poster' && (
        <div className={s.field}>
          <p className={s.fieldLabel}>EVENT POSTER</p>
          <p className={s.fieldSub}>Optional — the flyer as it was designed · any shape · shown whole at the bottom of the page</p>
          <ImageUploadButton type="poster" userId={userId} onUpload={({ poster:p, poster_thumb:t, poster_full:f }) => { setPoster(p); setPosterThumb(t); setPosterFull(f||''); setPosterCropY(DEFAULT_CROP_Y); setCropMode(false); }}>
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
                      : 'Zoom and drag to frame a slice, then keep it — it joins the carousel above.'}
                    {cropGeom && !bandMatchesHero && slides.length === 0 && (
                      <> <span style={{ color:'#FFD700' }}>Zoomed in, so this framing only applies once you keep it — until then the top of the page uses the full width of the poster.</span></>
                    )}
                  </p>
                )}

                {/* Keep the current rectangle. The kept images themselves live
                    in the CAROUSEL section above — one list, one place, rather
                    than a second strip down here that could disagree with it
                    about order. */}
                {poster && cropMode && cropGeom && (
                  <div style={{ marginTop:10 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <button type="button" onClick={keepCrop}
                        disabled={cropBusy || slides.length >= MAX_SLIDES}
                        style={{ padding:'9px 16px', borderRadius:8, cursor: (cropBusy || slides.length >= MAX_SLIDES) ? 'default':'pointer',
                          fontFamily:"'Bebas Neue'", fontSize:12, letterSpacing:1.5,
                          background:'rgba(0,229,160,0.12)', border:'1px solid rgba(0,229,160,0.45)', color:'#00E5A0',
                          opacity:(cropBusy || slides.length >= MAX_SLIDES) ? .5 : 1 }}>
                        {cropBusy ? 'SAVING…' : slides.length >= MAX_SLIDES ? 'CAROUSEL FULL' : '+ KEEP THIS CROP → CAROUSEL'}
                      </button>
                      <span style={{ fontSize:11, color:'var(--muted)' }}>
                        {slides.length}/{MAX_SLIDES} in carousel
                      </span>
                    </div>
                    {cropError && <p style={{ fontSize:12, color:'#ff5050', marginTop:6 }}>{cropError}</p>}
                  </div>
                )}


                {/* Action tabs */}
                {poster && (
                  <div className={s.posterTabs}>
                    <button type="button" className={s.posterTab} onClick={() => setFullView(true)}>Full view</button>
                    <button type="button" className={cropMode ? s.posterTabActive : s.posterTab} onClick={() => setCropMode(m => !m)}>Crop</button>
                    <button type="button" className={s.posterTab} onClick={trigger}>Replace</button>
                    <button type="button" className={s.posterTabRemove} onClick={() => { setPoster(''); setPosterThumb(''); setPosterFull(''); setCropMode(false); }}>Remove</button>
                  </div>
                )}
              </div>
            )}
          </ImageUploadButton>
        </div>
        )}

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

        {/* ⛔ NO ACTIONS HERE, DELIBERATELY. "Go live", "Save as draft" and
            "Delete" are workflow decisions, and the words are one world's
            vocabulary: another may Save · Review · Publish, or Save ·
            Synchronise, or need an approval step this editor has never heard
            of. An editor that ships buttons has an opinion about what happens
            next, and every host after the first has to argue with it.

            The host renders its own actions and reads `ed.toConfig()` for the
            model. Same rule as the page wrapper and heading above. */}
        {actions}

        <div style={{height:60}} />
    </>
  );
}
