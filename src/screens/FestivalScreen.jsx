import { SectionCard, Button, Skeleton, Row } from '../design-system';
import ApplicationLink from '../festival/ApplicationLink';
import ApplicationSetup from '../festival/ApplicationSetup';
import FestivalIdentity from '../festival/FestivalIdentity';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';
import s from './screens.module.css';

/**
 * FESTIVAL — the public face, and what it is asking for.
 *
 * ⭐ Identity comes from the shared profile system; the application setup
 * below belongs to the EVENT. The card headers say which is which, because
 * the most expensive mistake here would be someone building a second festival
 * profile store inside this repo.
 *
 * ⚠ A hardcoded window list and per-category counts used to live here. They
 * were removed rather than updated: two displays of "what is open" that can
 * disagree is worse than one that is real.
 */

export default function FestivalScreen() {
  const { festivals } = useRepositories();
  const { data: festival } = useQuery(() => festivals.getCurrent(), []);

  return (
    <div className={s.page}>
      <header className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Festival</h1>
          <p className={s.pageSubtitle}>
            What applicants see, and what you are accepting. Identity and dates live on the shared
            profile system; the application windows below belong to this portal.
          </p>
        </div>
      </header>

      {/* First card on the screen, deliberately: sharing the link is the only
          thing here that has to happen before anyone can apply at all. */}
      <ApplicationLink />

      <div className={s.settingsGrid}>
        <div className={s.formStack}>
          <FestivalIdentity />
        </div>

        <SectionCard
          title="Media"
          subtitle="A poster is an opaque artefact — it is shown whole, never cropped to fit a layout."
        >
          <Skeleton shape="block" height={140} />
          <Row>
            <Skeleton shape="block" height={64} />
            <Skeleton shape="block" height={64} />
          </Row>
          <Button variant="secondary" size="sm" icon="plus" block>Add artwork</Button>
        </SectionCard>
      </div>

      {/* Replaced a hardcoded window list and fake per-category counts. Two
          displays of "what is open" that could disagree is worse than one that
          is real — this reads and writes the event. */}
      <ApplicationSetup eventId={festival?.eventId} />
    </div>
  );
}
