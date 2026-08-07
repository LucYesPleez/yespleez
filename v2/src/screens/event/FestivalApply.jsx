import { useState, useEffect } from 'react';
import { getPerformerProfiles } from '../../lib/actingProfile';
import { supabase } from '../../lib/supabase';
import {
  listOpenFestivalCategories, myFestivalApplications, festivalEventConfig,
  festivalDayOptions, applyToFestival, applicationOutcome,
} from '../../lib/festivalApplications';
import s from '../EventScreen.module.css';

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
 */
export default function FestivalApply({ eventId, userId, festivalName }) {
  const [categories, setCategories] = useState([]);
  const [applied, setApplied]       = useState({});
  const [profiles, setProfiles]     = useState([]);
  const [config, setConfig]         = useState({ settings: null, departments: [] });
  const [loading, setLoading]       = useState(true);

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

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 2.5, background: 'linear-gradient(135deg, #BF5FFF, #00E5FF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', marginBottom: 4 }}>
        APPLICATIONS OPEN
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        {festivalName ? `Be part of ${festivalName}.` : 'Be part of it.'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {categories.map(cat => (
          <CategoryRow
            key={cat.key}
            category={cat}
            profiles={profiles}
            days={cat.asksAvailability ? days : []}
            departments={cat.asksDepartments ? config.departments : []}
            applied={applied[cat.key]}
            signedIn={!!userId}
            onApplied={a => setApplied(prev => ({ ...prev, [cat.key]: a }))}
            eventId={eventId}
          />
        ))}
      </div>
    </div>
  );
}

const OUTCOME_COLOUR = { good: '#00e676', pending: '#00e676', closed: 'rgba(255,255,255,.45)' };

function CategoryRow({ category, profiles, days, departments, applied, signedIn, onApplied, eventId }) {
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
    <div style={{ background: 'rgba(191,95,255,.05)', border: '1px solid rgba(191,95,255,.22)', borderRadius: 14, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 1.5, color: '#fff' }}>
            {category.label}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{category.blurb}</div>
        </div>
        {applied && (
          <span style={{ flexShrink: 0, fontSize: 11, letterSpacing: 1, fontFamily: "'Bebas Neue', sans-serif", color: OUTCOME_COLOUR[outcome.tone] }}>
            {outcome.tone === 'good' ? '★ ' : outcome.tone === 'pending' ? '✓ ' : ''}{outcome.label}
          </span>
        )}
      </div>

      {/* ⚠ THIS USED TO RENDER NOTHING ONCE APPLIED, which meant an accepted
          applicant returning after release saw exactly what they saw the second
          they applied. The status is safe to show: the database masks it, so
          `shortlisted` never arrives here and a decision reads `in_review`
          until the organiser releases it. Withholding it was not caution, it
          was the loop failing to close. */}
      {applied ? (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>
          {outcome.note}
        </p>
      ) : !signedIn ? (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--muted)' }}>
          Sign in to apply.
        </p>
      ) : eligible.length === 0 ? (
        /* Says WHY there is no button. A card with nothing on it reads as
           something that failed to load rather than something not open to
           this person. */
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--muted)' }}>
          {category.appliesAs.includes('punter')
            ? 'Finish your personal profile to volunteer.'
            : `Open to ${category.appliesAs.join(' and ')} profiles — you don't have one yet.`}
        </p>
      ) : (
        <div style={{ marginTop: 12 }}>
          {eligible.length > 1 && (
            <select
              value={activeId}
              onChange={e => setProfileId(e.target.value)}
              style={selectStyle}
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
            className={s.applyBtn}
            style={{ width: '100%', marginTop: 10, opacity: ready ? 1 : .45, cursor: ready ? 'pointer' : 'default' }}
          >
            {busy ? 'SENDING…' : 'APPLY'}
          </button>

          {error && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#ff6b6b' }}>{error}</p>}
        </div>
      )}
    </div>
  );
}

function Picker({ legend, options, picked, onToggle }) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: '0 0 10px' }}>
      <legend style={{ fontSize: 12, color: 'var(--muted)', padding: 0, marginBottom: 6 }}>{legend}</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {options.map(o => {
          const on = picked.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(o.value)}
              style={{
                // 44px minimum touch target — a chip you cannot reliably hit is
                // a chip that costs someone their application.
                minHeight: 36, padding: '8px 12px', borderRadius: 999, cursor: 'pointer',
                fontSize: 12,
                background: on ? 'rgba(191,95,255,.22)' : 'transparent',
                border: `1px solid ${on ? '#BF5FFF' : 'var(--border)'}`,
                color: on ? '#fff' : 'var(--muted)',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const selectStyle = {
  width: '100%', marginBottom: 10, padding: '10px 12px', borderRadius: 8,
  background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)',
  fontSize: 13, outline: 'none',
};
