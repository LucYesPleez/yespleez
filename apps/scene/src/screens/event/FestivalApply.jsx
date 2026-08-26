import { useState, useEffect } from 'react';
import { getPerformerProfiles } from '../../lib/actingProfile';
import { supabase } from '../../lib/supabase';
import {
  listOpenFestivalCategories, myFestivalApplications, festivalEventConfig,
  festivalDayOptions, applyToFestival, applicationOutcome,
} from '../../lib/festivalApplications';
import { StageIcon } from './eventIcons';
import ev from '../EventScreen.module.css';
// ⭐ THE UTILITY ROW'S OWN CLASS, imported rather than re-described. "Match the
// other buttons" (owner, 2026-08-26) is a promise that cannot be kept by a
// second set of rules that merely looks the same today.
import qa from './EventSections.module.css';
import s from './FestivalApply.module.css';

/**
 * APPLICATIONS OPEN — on a festival's event, inside Scene.
 *
 * ⭐ OWNER'S RULING, 2026-08-06: "The public doesn't need to know a Festival app
 * exists. They discover festivals through Scene exactly as they discover any
 * other event." So this is the WHOLE public apply experience; nothing links out.
 * The Festival app is the organiser's tool and reviews what lands here.
 *
 * ⚠ REPLACED A LINK OUT TO THE PORTAL, which the same ruling reversed. The
 * principle that survived is the one that matters: exactly ONE table. A
 * festival's application goes to `festival_applications` — the table the
 * organiser's dashboard reads — never Scene's own `applications`.
 *
 * ⭐ THE PROFILE IS THE APPLICATION. No form, no covering letter. For every
 * category you own a compatible profile for there is one button, and the
 * organiser reviews the profile. Event-specific questions (which days, which
 * department) are asked ONLY where the organiser configured them — a festival
 * that configured nothing asks nothing, and applying stays one click.
 *
 * ⭐⭐ COLLAPSED BY DEFAULT (owner, 2026-08-26). Every category used to render
 * its whole form inline, so a two-category festival put sixteen day chips and
 * six department chips on the event page before anyone had said they wanted to
 * volunteer — the event page read as a form rather than an event. Now: one
 * button says applications are open, opening it lists what you can apply for,
 * and only the category you choose asks you anything.
 *
 * ⛔ The disclosure is presentation ONLY. What is asked, which profile types
 * may apply and which table it lands in are all unchanged.
 *
 * ⭐ `inline` — the trigger becomes a PILL beside the event title (owner,
 * 2026-08-26) instead of a full-width block in the decisions column. Whether
 * this festival is taking applications is a headline fact about the event, so
 * it belongs with the headline. ⚠ In this mode the component renders a
 * FRAGMENT, not a wrapper: the pill and the panel are separate children of the
 * title row, which is what lets the panel take its own line beneath the title
 * while the pill stays on it. ⛔ Do not wrap them back up in a div.
 *
 * ⭐ `renderTrigger` — the caller draws the button, this component keeps the
 * state. The festival PROFILE page (owner, 2026-08-26) wants a control that
 * matches FOLLOW and MESSAGE, and those are styled from values that live on
 * that page (the profile's own gradient, its `followBtn` class). ⛔ Passing
 * that palette in as props would put profile-page styling knowledge in here;
 * a render prop keeps the look where the look is defined and the disclosure
 * where the disclosure is.
 */
export default function FestivalApply({
  eventId, userId, inline = false, renderTrigger = null,
}) {
  const [categories, setCategories] = useState([]);
  const [applied, setApplied]       = useState({});
  const [profiles, setProfiles]     = useState([]);
  const [config, setConfig]         = useState({ settings: null, departments: [] });
  const [loading, setLoading]       = useState(true);
  // The section's own disclosure, and which single category is expanded.
  const [open, setOpen]             = useState(false);
  const [openKey, setOpenKey]       = useState(null);

  useEffect(() => {
    if (!eventId) return undefined;
    let cancelled = false;
    (async () => {
      const [cats, mine, cfg, perf, punter] = await Promise.all([
        listOpenFestivalCategories(eventId),
        userId ? myFestivalApplications(eventId) : Promise.resolve([]),
        festivalEventConfig(eventId),
        userId ? getPerformerProfiles(userId).catch(() => []) : Promise.resolve([]),
        // The punter identity is not a performer profile, so it is fetched
        // separately — it is how anyone volunteers, and every account has one.
        userId
          ? supabase.from('profiles').select('id, type, name')
              .eq('user_id', userId).eq('type', 'punter').maybeSingle()
              .then(r => (r.data ? [r.data] : []))
          : Promise.resolve([]),
      ]);
      if (cancelled) return;
      setCategories(cats);
      setApplied(Object.fromEntries(mine.map(a => [a.categoryKey, a])));
      setConfig(cfg);
      setProfiles([...(perf || []), ...punter]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [eventId, userId]);

  // Nothing open is not an error and not a gap — it is the ordinary state of a
  // festival between rounds. The section simply is not there.
  if (loading || categories.length === 0) return null;

  const days = festivalDayOptions(config.settings);
  const panelId = `festival-apply-${eventId}`;
  const chevron = (
    <span className={`${s.chev} ${open ? s.chevOpen : ''}`} aria-hidden="true">
      <Chevron />
    </span>
  );

  const chosen = categories.find(c => c.key === openKey) || null;

  const categoryRows = (
    <>
      <div className={s.catGrid}>
        {categories.map(cat => (
          <CategoryTile
            key={cat.key}
            category={cat}
            applied={applied[cat.key]}
            selected={openKey === cat.key}
            /* Exclusive: choosing one deselects the other. Two open at once is
               the wall this disclosure replaced. */
            onSelect={() => setOpenKey(k => (k === cat.key ? null : cat.key))}
          />
        ))}
      </div>

      {/* ⚠ `key` FORCES A REMOUNT per category, and that is the point: the
          days and departments someone picked for Vollys must not still be
          sitting there when they switch to Music. */}
      {chosen && (
        <CategoryDetail
          key={chosen.key}
          category={chosen}
          profiles={profiles}
          days={chosen.asksAvailability ? days : []}
          departments={chosen.asksDepartments ? config.departments : []}
          applied={applied[chosen.key]}
          signedIn={!!userId}
          onApplied={a => setApplied(prev => ({ ...prev, [chosen.key]: a }))}
          eventId={eventId}
        />
      )}
    </>
  );

  if (renderTrigger) {
    return (
      <>
        {renderTrigger({ open, toggle: () => setOpen(o => !o), panelId })}
        {open && (
          <div className={s.panelBase} id={panelId}>
            {categoryRows}
          </div>
        )}
      </>
    );
  }

  if (inline) {
    return (
      <>
        {/* ⛔ The row's OWN class, plus a modifier that only ever adds colour
            while open. Size, font, spacing and the divider all come from
            `.quickAction`, so this button cannot drift from its neighbours. */}
        <button
          type="button"
          className={`${qa.quickAction} ${open ? s.quickActionOn : ''}`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(o => !o)}
        >
          <StageIcon size={15} /> APPLY
        </button>

        {open && (
          <div className={`${s.panelBase} ${s.panelInRow}`} id={panelId}>
            {categoryRows}
          </div>
        )}
      </>
    );
  }

  return (
    <section className={s.wrap}>
      <button
        type="button"
        className={`${s.trigger} ${open ? s.triggerOpen : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(o => !o)}
      >
        {/* ⛔ No "Be part of <festival>" line (owner, 2026-08-26). The tiles
            below already say what you can be part of, and the sentence was
            restating the heading it sat under. */}
        <span className={s.triggerText}>
          <span className={s.triggerTitle}>Applications open</span>
        </span>
        {chevron}
      </button>

      {open && (
        <div className={s.panel} id={panelId}>
          {categoryRows}
        </div>
      )}
    </section>
  );
}

const OUTCOME_COLOUR = { good: '#00e676', pending: '#00e676', closed: 'rgba(255,255,255,.45)' };

/**
 * A glyph per category, for the tiles.
 *
 * ⭐ Keyed by category key with a fallback, so the seven-tile future adds an
 * entry here and nothing else. ⛔ A missing glyph must never blank a tile —
 * `StageIcon` catches anything unmapped.
 *
 * ⚠ Drawn in the same language as `eventIcons`: 24 viewBox, `currentColor`,
 * 2px round strokes. A filled or differently-weighted glyph would stand out
 * as the one tile that came from somewhere else.
 */
const PeopleGlyph = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 20v-2a4 4 0 0 0-3-3.87" />
  </svg>
);

const CATEGORY_GLYPH = {
  music: StageIcon,
  volunteer: PeopleGlyph,
};

/**
 * ONE THING YOU CAN APPLY FOR, as a box.
 *
 * ⭐ Terse on purpose: a glyph and one word. There will be seven of these, and
 * a grid you can read at a glance is the whole reason it is not a list. What a
 * category actually asks for lives in the detail beneath the grid.
 */
function CategoryTile({ category, applied, selected, onSelect }) {
  const outcome = applicationOutcome(applied?.status);
  const Glyph = CATEGORY_GLYPH[category.key] || StageIcon;
  return (
    <button
      type="button"
      className={`${s.tile} ${selected ? s.tileOn : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className={s.tileIcon} aria-hidden="true"><Glyph size={20} /></span>
      <span className={s.tileText}>
        <span className={s.tileLabel}>{category.short || category.label}</span>
        {/* ⭐ Says what the category IS FOR, on the tile. With seven of these,
            "Market Stalls" and "Food Vendors" are not self-explanatory, and a
            visitor should not have to open one to find out which is theirs. */}
        {category.blurb && <span className={s.tileBlurb}>{category.blurb}</span>}
      </span>
      {/* ⚠ Safe to show: the database masks it, so `shortlisted` never arrives
          here and a decision reads `in_review` until the organiser releases
          it. */}
      {applied && (
        <span className={s.status} style={{ color: OUTCOME_COLOUR[outcome.tone] }}>
          {outcome.tone === 'good' ? '★ ' : outcome.tone === 'pending' ? '✓ ' : ''}{outcome.label}
        </span>
      )}
    </button>
  );
}

function CategoryDetail({
  category, profiles, days, departments, applied, signedIn, onApplied, eventId,
}) {
  const outcome = applicationOutcome(applied?.status);
  const eligible = profiles.filter(p => category.appliesAs.includes(p.type));
  const [profileId, setProfileId] = useState('');
  const [pickedDays, setPickedDays] = useState([]);
  const [pickedDepts, setPickedDepts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Pre-selected only when there is nothing to choose. With several acts a
  // default would be a guess wearing a confirmation — the same rule the host
  // apply flow follows.
  const activeId = profileId || (eligible.length === 1 ? eligible[0].id : '');

  const needsDays  = days.length > 0 && pickedDays.length === 0;
  const needsDepts = departments.length > 0 && pickedDepts.length === 0;
  const ready = !!activeId && !needsDays && !needsDepts && !busy;

  async function submit() {
    setBusy(true); setError('');
    // Departments are stored by NAME, not id: an application records what was
    // asked for at the time and must still read correctly after the organiser
    // renames or archives one.
    const answers = {};
    if (pickedDays.length)  answers.days = pickedDays;
    if (pickedDepts.length) answers.departments = pickedDepts;

    const res = await applyToFestival({ eventId, categoryKey: category.key, profileId: activeId, answers });
    setBusy(false);
    if (res.ok || res.reason === 'already_applied') {
      onApplied({ categoryKey: category.key, status: 'submitted' });
      return;
    }
    setError('That didn\'t send. Try again in a moment.');
  }

  return (
    <div className={s.detail}>
      {/* The full name, not the tile's one-word form: this is where somebody
          confirms what they are applying for. */}
      {/* ⛔ The blurb is NOT repeated here — it is on the tile now, and saying
          it twice a centimetre apart reads as a rendering fault. */}
      <div className={s.detailHead}>
        <span className={s.detailTitle}>{category.label}</span>
      </div>

      <div>
          {applied ? (
            /* ⚠ THIS USED TO RENDER NOTHING ONCE APPLIED, which meant an
               accepted applicant returning after release saw exactly what they
               saw the second they applied. Withholding it was not caution, it
               was the loop failing to close. */
            <p className={s.note}>{outcome.note}</p>
          ) : !signedIn ? (
            <p className={s.note}>Sign in to apply.</p>
          ) : eligible.length === 0 ? (
            /* Says WHY there is no button. A card with nothing on it reads as
               something that failed to load rather than something not open to
               this person. */
            <p className={s.note}>
              {category.appliesAs.includes('punter')
                ? 'Finish your personal profile to volunteer.'
                : `Open to ${category.appliesAs.join(' and ')} profiles. You don't have one yet.`}
            </p>
          ) : (
            <>
              {eligible.length > 1 && (
                <select
                  className={s.select}
                  value={activeId}
                  onChange={e => setProfileId(e.target.value)}
                  aria-label={`Apply to ${category.label} as`}
                >
                  <option value="">Apply as…</option>
                  {eligible.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}

              {days.length > 0 && (
                <Picker
                  legend="Which days can you do?"
                  options={days.map(d => ({ value: d.value, label: `${d.label}${d.phase !== 'festival' ? ` · ${d.phase}` : ''}` }))}
                  picked={pickedDays}
                  onToggle={v => setPickedDays(t => t.includes(v) ? t.filter(x => x !== v) : [...t, v])}
                />
              )}

              {departments.length > 0 && (
                <Picker
                  legend="Where would you like to help?"
                  options={departments.map(d => ({ value: d.name, label: d.name }))}
                  picked={pickedDepts}
                  onToggle={v => setPickedDepts(t => t.includes(v) ? t.filter(x => x !== v) : [...t, v])}
                />
              )}

              <button
                onClick={submit}
                disabled={!ready}
                className={ev.applyBtn}
                style={{ width: '100%', marginBottom: 0, opacity: ready ? 1 : .45, cursor: ready ? 'pointer' : 'default' }}
              >
                {busy ? 'SENDING…' : 'APPLY'}
              </button>

              {error && <p className={s.error}>{error}</p>}
            </>
          )}
      </div>
    </div>
  );
}

function Picker({ legend, options, picked, onToggle }) {
  return (
    <fieldset className={s.field}>
      <legend className={s.legend}>{legend}</legend>
      <div className={s.chips}>
        {options.map(o => {
          const on = picked.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(o.value)}
              className={`${s.chip} ${on ? s.chipOn : ''}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
