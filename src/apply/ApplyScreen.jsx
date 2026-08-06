import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Icon, Button, EmptyState } from '../design-system';
import { Select } from '../design-system/Form';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';
import { applicantFacingStatus } from '../data/types';
import { useSession } from '../auth/useSession';
import SignInScreen from '../auth/SignInScreen';
import { dayOptions } from './dayOptions';
import s from './ApplyScreen.module.css';

/**
 * THE PUBLIC APPLY PAGE.
 *
 * ⭐ THE PROFILE IS THE APPLICATION. For every category the visitor owns a
 * compatible profile for, there is ONE button. No application form, no
 * retyping what the profile already says — the organiser reviews the profile.
 *
 * ⭐ SIGN-IN HAPPENS IN PLACE. A visitor who is signed out sees the sign-in
 * card at this same URL; when the session arrives the page re-renders under
 * them. No redirect, no return-to parameter, nothing to lose — which is the
 * whole reason there is no "you were trying to apply to…" recovery path.
 */
function CategoryCard({ category, profiles, config, onApply, existing }) {
  const applied = Boolean(existing);
  const eligible = profiles.filter(p => category.appliesAs.includes(p.type));

  /**
   * ⚠ DERIVED, not initial state. `useState(eligible[0]?.id)` runs once on the
   * first render — before the profiles query resolves — so it captured '' and
   * kept it forever, leaving Apply permanently disabled no matter what was
   * ticked. Any default taken from async data has this bug; deriving it each
   * render is the fix, with the chosen value winning once there is one.
   */
  const [chosenId, setChosenId] = useState('');
  const profileId = chosenId || eligible[0]?.id || '';

  const [days, setDays] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [busy, setBusy] = useState(false);

  const availableDays = category.asksAvailability ? dayOptions(config?.settings) : [];
  const availableDepts = category.asksDepartments ? (config?.departments ?? []) : [];

  // ⭐ THE ONE-CLICK RULE: no event-specific questions means the Apply button
  // is live immediately. A festival that configured nothing asks nothing.
  const needsDays = availableDays.length > 0 && days.length === 0;
  const needsDepts = availableDepts.length > 0 && departments.length === 0;

  function toggle(setter, value) {
    setter(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  }

  async function submit() {
    setBusy(true);
    // Departments are stored by NAME, not id: an application is a record of
    // what was asked for at the time, and it must still read correctly after
    // the organiser renames or archives a department.
    const answers = {};
    if (days.length) answers.days = days;
    if (departments.length) answers.departments = departments;
    await onApply({ categoryKey: category.key, profileId, answers });
    setBusy(false);
  }

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <span className={s.cardIcon}><Icon name={category.icon} size={18} /></span>
        <span className={s.cardTitle}>{category.label}</span>
        {/* ⭐ THE APPLICANT'S VIEW OF THE OUTCOME. Never the raw workflow
            status: shortlisting is not exposed, and a decision reads "In
            review" until the organiser releases it. */}
        {applied && (
          <span className={`${s.applied} ${s[`st_${existing.status}`] ?? ''}`}>
            <Icon name={existing.status === 'declined' ? 'close' : 'check'} size={13} />
            {applicantFacingStatus(existing)}
          </span>
        )}
      </div>

      {/* Why a category can be open and still have no button. Stating it is the
          point — a card with nothing on it reads as something that failed to
          load rather than something not open to this person.

          ⚠ This used to say "Not open for applications this year", which was
          wrong: the organiser HAS opened the category, there is simply no
          profile type that can apply to it yet. Calling it closed contradicted
          the page it was sitting on. */}
      {!eligible.length && (
        <p className={s.note}>
          {category.appliesAs.length
            ? `Open to ${category.appliesAs.join(' and ')} profiles. You don't have one yet.`
            : 'Applications for this category are not open through YesPleez yet.'}
        </p>
      )}

      {!applied && eligible.length > 0 && (
        <>
          {eligible.length > 1 && (
            <Select
              label="Apply as"
              value={profileId}
              onChange={e => setChosenId(e.target.value)}
              options={eligible.map(p => ({ value: p.id, label: p.name || p.type }))}
            />
          )}
          {eligible.length === 1 && (
            <p className={s.note}>Applying as <strong>{eligible[0].name || eligible[0].type}</strong>.</p>
          )}

          {availableDays.length > 0 && (
            <fieldset className={s.group}>
              <legend className={s.legend}>Which days can you work?</legend>
              {availableDays.map(d => (
                <label key={d.value} className={s.check}>
                  <input
                    type="checkbox"
                    checked={days.includes(d.value)}
                    onChange={() => toggle(setDays, d.value)}
                  />
                  {d.label}
                </label>
              ))}
            </fieldset>
          )}

          {availableDepts.length > 0 && (
            <fieldset className={s.group}>
              <legend className={s.legend}>Where would you like to work?</legend>
              {availableDepts.map(dept => (
                <label key={dept.id} className={s.check}>
                  <input
                    type="checkbox"
                    checked={departments.includes(dept.name)}
                    onChange={() => toggle(setDepartments, dept.name)}
                  />
                  <span>
                    {dept.name}
                    {dept.description && <span className={s.deptNote}>{dept.description}</span>}
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {/* A disabled button that does not say why is the most frustrating
              control in any form — the reader assumes it is broken, because
              from where they are sitting it is indistinguishable from broken. */}
          {(needsDays || needsDepts) && (
            <p className={s.note}>
              {needsDays && needsDepts
                ? 'Choose at least one day and one area to apply.'
                : needsDays ? 'Choose at least one day to apply.'
                : 'Choose at least one area to apply.'}
            </p>
          )}

          <Button
            variant="primary" block
            disabled={busy || !profileId || needsDays || needsDepts}
            onClick={submit}
          >
            {busy ? 'Sending…' : 'Apply'}
          </Button>
        </>
      )}
    </div>
  );
}

export default function ApplyScreen() {
  const { eventId } = useParams();
  const { apply } = useRepositories();
  const { session, loading: sessionLoading } = useSession();

  const { data: event, loading: eventLoading } = useQuery(() => apply.getEvent(eventId), [eventId]);
  const { data: categories } = useQuery(() => apply.listOpenCategories(eventId), [eventId]);
  const { data: config } = useQuery(() => apply.getEventConfig(eventId), [eventId]);
  const { data: profiles } = useQuery(
    () => apply.listMyProfiles(),
    [session?.user?.id],
    { enabled: Boolean(session) },
  );

  // What this person has already applied for, masked server-side. Replaces the
  // local "applied" flag, which forgot everything on reload and could not know
  // an outcome had been released.
  const { data: mine, reload: reloadMine } = useQuery(
    () => apply.myApplications(eventId),
    [eventId, session?.user?.id],
    { enabled: Boolean(session) },
  );
  const byCategory = new Map((mine ?? []).map(a => [a.categoryKey, a]));

  const [error, setError] = useState('');

  async function onApply({ categoryKey, profileId, answers }) {
    setError('');
    const res = await apply.apply({ eventId, categoryKey, profileId, answers });
    // `already_applied` is not an error — the unique index is how a duplicate
    // is discovered. Either way, re-read rather than guessing the new state.
    if (res.ok || res.reason === 'already_applied') reloadMine();
    else setError('Something went wrong. Please try again.');
  }

  if (eventLoading || sessionLoading) return null;

  if (!event) {
    return (
      <div className={s.wrap}>
        <EmptyState icon="close" title="Link not found"
          body="This application link is not valid. Check it with whoever sent it to you." />
      </div>
    );
  }

  return (
    <div className={s.wrap}>
      <div className={s.inner}>
        <header className={s.header}>
          {event.festivalName && <span className={s.festival}>{event.festivalName}</span>}
          <h1 className={s.title}>{event.name}</h1>
          {event.tagline && <p className={s.tagline}>{event.tagline}</p>}
          <span className={s.sub}>
            {event.applicationsOpen ? 'Applications are open' : 'Applications are closed'}
          </span>
        </header>

        {event.description && <p className={s.description}>{event.description}</p>}

        {!event.applicationsOpen && (
          <EmptyState icon="clock" title="Applications are closed"
            body="This festival is not taking applications right now." />
        )}

        {event.applicationsOpen && !session && (
          <>
            <p className={s.signInNote}>Sign in to apply. You'll come straight back here.</p>
            <SignInScreen />
          </>
        )}

        {event.applicationsOpen && session && (
          <>
            {error && <p className={s.error} role="alert">{error}</p>}
            <div className={s.cards}>
              {(categories ?? []).map(c => (
                <CategoryCard
                  key={c.key}
                  category={c}
                  profiles={profiles ?? []}
                  config={config}
                  existing={byCategory.get(c.key)}
                  onApply={onApply}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
