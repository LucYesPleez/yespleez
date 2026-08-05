import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Icon, Button, EmptyState } from '../design-system';
import { Select, Textarea } from '../design-system/Form';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';
import { useSession } from '../auth/useSession';
import SignInScreen from '../auth/SignInScreen';
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
function CategoryCard({ category, profiles, onApply, applied }) {
  const eligible = profiles.filter(p => category.appliesAs.includes(p.type));
  const [profileId, setProfileId] = useState(eligible[0]?.id ?? '');
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);

  const missingRequired = category.questions.some(q => !q.optional && !answers[q.key]);

  async function submit() {
    setBusy(true);
    await onApply({ categoryKey: category.key, profileId, answers });
    setBusy(false);
  }

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <span className={s.cardIcon}><Icon name={category.icon} size={18} /></span>
        <span className={s.cardTitle}>{category.label}</span>
        {applied && <span className={s.applied}><Icon name="check" size={13} /> Applied</span>}
      </div>

      {/* Why a category can be open and still have no button. Stating it is the
          point — a card with nothing on it reads as something that failed to
          load rather than something not open to this person. */}
      {!eligible.length && (
        <p className={s.note}>
          {category.appliesAs.length
            ? `Open to ${category.appliesAs.join(' and ')} profiles. You don't have one yet.`
            : 'Not open for applications this year.'}
        </p>
      )}

      {!applied && eligible.length > 0 && (
        <>
          {eligible.length > 1 && (
            <Select
              label="Apply as"
              value={profileId}
              onChange={e => setProfileId(e.target.value)}
              options={eligible.map(p => ({ value: p.id, label: p.name || p.type }))}
            />
          )}
          {eligible.length === 1 && (
            <p className={s.note}>Applying as <strong>{eligible[0].name || eligible[0].type}</strong>.</p>
          )}

          {category.questions.map(q => (
            q.type === 'textarea' ? (
              <Textarea
                key={q.key} label={q.label} optional={q.optional} rows={3}
                value={answers[q.key] ?? ''}
                onChange={e => setAnswers(a => ({ ...a, [q.key]: e.target.value }))}
              />
            ) : (
              <Select
                key={q.key} label={q.label} optional={q.optional}
                value={answers[q.key] ?? ''}
                onChange={e => setAnswers(a => ({ ...a, [q.key]: e.target.value }))}
                options={[{ value: '', label: 'Choose…' }, ...q.options]}
              />
            )
          ))}

          <Button variant="primary" block disabled={busy || !profileId || missingRequired} onClick={submit}>
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
  const { data: profiles } = useQuery(
    () => apply.listMyProfiles(),
    [session?.user?.id],
    { enabled: Boolean(session) },
  );

  const [applied, setApplied] = useState({});
  const [error, setError] = useState('');

  async function onApply({ categoryKey, profileId, answers }) {
    setError('');
    const res = await apply.apply({ eventId, categoryKey, profileId, answers });
    if (res.ok) setApplied(a => ({ ...a, [categoryKey]: true }));
    // Not an error state. Applicants have no read on their own applications, so
    // a duplicate is only discoverable by attempting it — see applyRepository.
    else if (res.reason === 'already_applied') setApplied(a => ({ ...a, [categoryKey]: true }));
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
          <span className={s.sub}>
            {event.applicationsOpen ? 'Applications are open' : 'Applications are closed'}
          </span>
        </header>

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
                  applied={Boolean(applied[c.key])}
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
