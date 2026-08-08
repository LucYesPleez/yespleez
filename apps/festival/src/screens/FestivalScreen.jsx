import { SectionCard, Button, Skeleton, Row } from '../design-system';
import EventsList from '../festival/EventsList';
import FestivalIdentity from '../festival/FestivalIdentity';
import s from './screens.module.css';

/**
 * FESTIVAL — the ORGANISATION.
 *
 * ⭐ The profile owns identity, followers, messaging, announcements and its
 * gallery; it outlives any one year of the festival. Dates, applications,
 * departments and rosters belong to an EVENT, and live in the event editor.
 * Keeping that split visible here is what stops someone building a second
 * festival profile store inside this repo.
 *
 * ⚠ A hardcoded window list, fake per-category counts and a single event's
 * application setup all used to live on this screen. They were removed rather
 * than updated: this screen cannot show "what is open" without also deciding
 * WHICH event it means, and a festival has several.
 */

export default function FestivalScreen() {
  return (
    <div className={s.page}>
      <header className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Festival</h1>
          <p className={s.pageSubtitle}>
            The organisation and its years. Identity is shared with every YesPleez surface;
            each event owns its own dates, departments and applications.
          </p>
        </div>
      </header>

      {/* ⚠ Everything below lives in a non-shrinking stack. `.page` is a flex
          column that scrolls, and its children would otherwise shrink and
          overlap once the screen outgrew one viewport — see `.stack`. */}
      <div className={s.stack}>

      {/* ⭐ Events first. This screen is the ORGANISATION; the years are what
          an organiser comes here to manage, and identity changes rarely. */}
      <EventsList />

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

      </div>
    </div>
  );
}
