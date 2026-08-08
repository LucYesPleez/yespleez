import { useParams, useNavigate } from 'react-router-dom';
import { Button, SectionCard, Callout } from '../design-system';
import { Toggle } from '../design-system/Form';
import ApplicationLink from '../festival/ApplicationLink';
import ApplicationSetup from '../festival/ApplicationSetup';
import FestivalEventEditor from '../festival/FestivalEventEditor';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';
import s from './screens.module.css';

/**
 * THE EVENT EDITOR — everything that belongs to ONE occurrence.
 *
 * The festival profile owns identity, followers and messaging; an event owns
 * dates, applications, departments and what is open. This screen is the second
 * half of that split, and it is scoped by the id in the URL rather than by
 * "the current event" — a festival with three years running has three of these.
 *
 * ⭐ Not a seventh sidebar destination. It is a route INSIDE Festival, so the
 * navigation law holds: six destinations, and adding one is an architecture
 * decision rather than a tweak.
 */
export default function EventEditorScreen() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { eventConfig } = useRepositories();

  const { data: events, reload } = useQuery(() => eventConfig.listEvents(), []);
  const event = (events ?? []).find(e => e.id === eventId);

  async function setFlag(patch) {
    await eventConfig.setEventFlags(eventId, patch);
    reload();
  }

  return (
    <div className={s.page}>
      <header className={s.pageHead}>
        <div>
          <Button variant="ghost" size="sm" icon="chevron" onClick={() => navigate('/festival')}>
            All events
          </Button>
          <h1 className={s.pageTitle}>{event?.name ?? 'Event'}</h1>
          <p className={s.pageSubtitle}>
            Dates, departments and what this event is accepting. Identity, followers and
            messaging belong to the festival profile, not to any one year.
          </p>
        </div>
      </header>

      <div className={s.stack}>
        {event && (
          <SectionCard
            title="Visibility"
            subtitle="Two separate facts: whether people can find this event, and whether it is taking applications."
          >
            <Toggle
              label="Public"
              hint="Draft events are hidden from listings. The application link still works, so you can test with people you send it to."
              checked={event.isPublic}
              onChange={next => setFlag({ isPublic: next })}
            />
            <Toggle
              label="Applications open"
              hint="The master switch. Individual categories still control what can actually be applied for."
              checked={event.applicationsOpen}
              onChange={next => setFlag({ applicationsOpen: next })}
            />
            {event.isPublic && (
              <Callout tone="warn" title="This event is public">
                It appears in listings and anyone can find it. Turning it back to draft hides
                it again, but people who already have the link keep it.
              </Callout>
            )}
          </SectionCard>
        )}

        <ApplicationLink eventId={eventId} applicationsOpen={event?.applicationsOpen ?? true} />
        <ApplicationSetup eventId={eventId} />

        {/* ⭐⭐ THE SHARED EVENT EDITOR — the same component the other
            application renders, with nothing added to it to make this work.
            Everything this world answers differently is in the wrapper. */}
        <SectionCard
          title="Event details"
          subtitle="Dates, venue, description and schedule — the same editor used everywhere an event is edited."
        >
          <FestivalEventEditor eventId={eventId} />
        </SectionCard>
      </div>
    </div>
  );
}
