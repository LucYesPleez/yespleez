import { Icon, Skeleton } from '../design-system';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';
import { useShell } from '../shell/shellContext';
import { CATEGORIES } from '../config/categories';
import { buildPriorities, derivePhase } from './priorities';
import PriorityCard from './PriorityCard';
import s from './HomeScreen.module.css';

/**
 * COMPANION HOME — "what needs me right now?"
 *
 * ⭐ The organiser does not think in phases; they think about what needs them.
 * Phase is an INPUT to the engine, never a thing displayed as a status.
 *
 * ⭐ The engine is a pure function (`priorities.js`). This screen's whole job is
 * to gather facts, hand them over, and render what comes back — so the ordering
 * rules live in one testable place rather than smeared through JSX.
 *
 * ⛔ "Priorities" is what the user sees. The rung order is an implementation
 * detail and the word "ladder" never appears on screen.
 */

/** Only numbers that could change a decision TODAY. Everything else belongs on
 *  the surface that owns it — rates and averages on Applications, followers on
 *  the public profile. ⛔ No trends: there is no audit log, so a delta would be
 *  invented. */
function Glance({ awaiting, pending, daysToEvent }) {
  const stats = [
    { key: 'awaiting', value: awaiting, label: 'to review' },
    { key: 'pending', value: pending, label: 'to release' },
  ];
  if (daysToEvent !== null && daysToEvent >= 0) {
    stats.push({ key: 'days', value: daysToEvent, label: daysToEvent === 1 ? 'day to go' : 'days to go' });
  }

  return (
    <div className={s.glance}>
      {stats.map(({ key, value, label }) => (
        <div key={key} className={s.stat}>
          {/* A zero here is a FACT about today and is shown. That is the
              opposite of the badge law, which governs unknown counts. */}
          <span className={s.statValue}>{value}</span>
          <span className={s.statLabel}>{label}</span>
        </div>
      ))}
    </div>
  );
}

export default function HomeScreen() {
  const { festivals, applications, eventConfig } = useRepositories();
  const { dataVersion } = useShell();

  const { data, loading, error } = useQuery(async () => {
    const festival = await festivals.getCurrent();
    const event = festival?.event ?? null;

    if (!event) {
      return { festival, event: null, categories: [], stats: null, pendingRelease: 0, oldest: null };
    }

    // Gathered in parallel: this is the first screen of the day and four
    // sequential round trips is the difference between instant and sluggish.
    const [rawCategories, stats, pendingIds, oldestPage] = await Promise.all([
      eventConfig.listCategories(event.id),
      applications.stats(),
      applications.pendingRelease(),
      applications.list({
        filters: { status: ['submitted', 'in_review'] },
        sort: 'oldest',
        pageSize: 1,
      }),
    ]);

    // The registry supplies label and eligibility; the row supplies state.
    // ⚠ `listCategories` returns id/key/state only, so `closesAt` is absent and
    // the closing-soon priority cannot fire yet. The engine treats a null date
    // as "no deadline known" rather than "no deadline" — absent, not zero.
    const categories = rawCategories.map(row => {
      const meta = CATEGORIES.find(c => c.key === row.key);
      return {
        key: row.key,
        label: meta?.label ?? row.key,
        appliesAs: meta?.appliesAs ?? [],
        state: row.state,
        closesAt: row.closes_at ?? null,
      };
    });

    return {
      festival,
      event,
      categories,
      stats,
      pendingRelease: pendingIds.length,
      oldest: oldestPage.items[0]?.submittedAt ?? null,
    };
  }, [dataVersion]);

  if (loading) {
    return (
      <div className={s.page}>
        <Skeleton shape="block" height={78} />
        <Skeleton shape="block" height={104} />
        <Skeleton shape="block" height={104} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={s.page}>
        <div className={s.calm}>
          <p className={s.calmTitle}>Could not load</p>
          <p className={s.calmBody}>{error.message}</p>
        </div>
      </div>
    );
  }

  const now = new Date();
  const items = buildPriorities({
    event: data.event,
    categories: data.categories,
    awaitingReview: data.stats?.awaitingReview ?? 0,
    oldestSubmittedAt: data.oldest,
    pendingRelease: data.pendingRelease,
    now,
  });

  const phase = derivePhase({ event: data.event, now });
  const daysToEvent = data.event?.startsOn
    ? Math.round((new Date(`${data.event.startsOn}T00:00:00`) - new Date(now.toDateString())) / 86400000)
    : null;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>
          {items.length ? 'Needs you' : 'Nothing needs you'}
        </h1>
        <p className={s.sub}>
          {data.event ? data.event.name : data.festival?.name}
        </p>
      </header>

      {data.event && (
        <Glance
          awaiting={data.stats?.awaitingReview ?? 0}
          pending={data.pendingRelease}
          daysToEvent={daysToEvent}
        />
      )}

      {items.length > 0 ? (
        <div className={s.list}>
          {items.map(item => <PriorityCard key={item.id} item={item} />)}
        </div>
      ) : (
        /**
         * ⭐ THE CALM STATE IS A REQUIREMENT, not an edge case. A dashboard that
         * cannot report calm will manufacture urgency to justify itself, and
         * that is how vanity widgets breed. Saying "nothing" plainly is the
         * feature.
         */
        <div className={s.calm}>
          <span className={s.calmMark}><Icon name="check" size={22} /></span>
          <p className={s.calmTitle}>You&rsquo;re on top of it</p>
          <p className={s.calmBody}>
            {phase === 'draft'
              ? 'Nothing is waiting. Open the event when you’re ready to take applications.'
              : 'No decisions, deadlines or configuration problems need you right now.'}
          </p>
        </div>
      )}
    </div>
  );
}
