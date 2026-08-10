import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SectionCard, Button, EmptyState, Callout, Tag } from '../design-system';
import { TextInput, Row } from '../design-system/Form';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';
import s from './EventsList.module.css';

/**
 * EVENTS BELONG TO THE FESTIVAL PROFILE.
 *
 * The profile is the organisation and outlives any one year of it; an event is
 * one occurrence. This list is what makes a second year possible without SQL,
 * which is the difference between a demo for one festival and a platform.
 *
 * ⭐ Duplicate is the important action, not Create. Last year's departments and
 * category setup are the bulk of the configuration, and retyping thirty
 * departments is where an organiser gives up and goes back to a Google Form.
 */
function EventRow({ event, onOpen, onDuplicate, onArchive, onDelete }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className={`${s.row} ${event.archived ? s.archived : ''}`}>
      <div className={s.main}>
        <button type="button" className={s.name} onClick={onOpen}>{event.name}</button>
        <div className={s.meta}>
          {/* Three separate facts, each said plainly. "Public" and "taking
              applications" are not the same thing and an organiser needs to
              see which is which before a deadline, not after. */}
          <Tag tone={event.isPublic ? 'accept' : undefined}>
            {event.isPublic ? 'Public' : 'Draft'}
          </Tag>
          <Tag tone={event.applicationsOpen ? 'accept' : undefined}>
            {event.applicationsOpen ? 'Applications open' : 'Applications closed'}
          </Tag>
          {event.archived && <Tag>Archived</Tag>}
          {event.startsOn && <span className={s.dates}>{event.startsOn}</span>}
        </div>
      </div>

      {/* ⭐ ONE action here is the journey; the other three are housekeeping.
          Opening the event is what an organiser came to do, and Duplicate,
          Archive and Delete are all rarer — two of them destructive. Four
          same-weight buttons made the common one the hardest to find, so the
          hierarchy is now carried by BORDER, not by a 4-value difference in
          background lightness: exactly one bordered, filled control in the
          cluster, and it names where it goes rather than saying "Open". */}
      <div className={s.actions}>
        <Button size="sm" variant="secondary" iconRight="chevron" onClick={onOpen}>
          Open event
        </Button>
        <Button size="sm" variant="ghost" onClick={onDuplicate}>Duplicate</Button>
        <Button size="sm" variant="ghost" onClick={onArchive}>
          {event.archived ? 'Restore' : 'Archive'}
        </Button>
        <Button size="sm" variant="ghost" tone="decline" onClick={() => setConfirming(c => !c)}>
          Delete
        </Button>
      </div>

      {/* The consequence beside the control, not in a dialog after the click.
          Deleting an event takes every application with it — the people who
          applied have no copy, and there is no undo. */}
      {confirming && (
        <div className={s.confirm}>
          <Callout
            tone="danger"
            title={`Delete ${event.name}?`}
            actions={
              <>
                <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>Keep</Button>
                <Button size="sm" variant="intent" tone="decline" onClick={onDelete}>
                  Delete permanently
                </Button>
              </>
            }
          >
            This deletes the event and every application submitted to it. Applicants keep
            no copy, and this cannot be undone. Archive it instead if you only want it out
            of the way.
          </Callout>
        </div>
      )}
    </li>
  );
}

export default function EventsList() {
  const { eventConfig } = useRepositories();
  const { data, reload, error } = useQuery(() => eventConfig.listEvents(), []);
  const [name, setName] = useState('');
  // ⭐ Four dates, not six. Build END and pack-down START are derived from the
  // festival's own start and end, because "build runs up to the festival and
  // pack-down starts when it finishes" is true almost everywhere — and both
  // stay editable in the Event Editor for the festivals where it is not.
  const [dates, setDates] = useState({ buildStartsOn: '', startsOn: '', endsOn: '', packdownEndsOn: '' });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const navigate = useNavigate();

  const events = data ?? [];

  async function run(fn) {
    setBusy(true);
    setFailure('');
    try { await fn(); reload(); } catch (e) { setFailure(e.message); }
    setBusy(false);
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setFailure('');
    try {
      const id = await eventConfig.createEvent({
        name: trimmed,
        // ⛔ Created closed and draft, always. An event that opens itself can
        // take applications the organiser has not finished configuring, and
        // nothing is reversible for whoever already applied.
        isPublic: false,
        applicationsOpen: false,
        dates: {
          ...dates,
          buildEndsOn: dates.startsOn || dates.buildStartsOn || '',
          packdownStartsOn: dates.endsOn || dates.packdownEndsOn || '',
        },
      });
      setName('');
      setDates({ buildStartsOn: '', startsOn: '', endsOn: '', packdownEndsOn: '' });
      // Straight into the editor: a new event has no dates, no departments and
      // nothing open, so leaving the organiser on a list would be leaving them
      // one step from a festival that cannot take an application.
      navigate(`/festival/event/${id}`);
    } catch (e) {
      setFailure(e.message);
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Events"
      count={events.length}
      subtitle="One occurrence of this festival each. The profile is the organisation; events are the years."
    >
      <TextInput
        label="New event"
        placeholder="Echo Valley Festival 2027"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
      />
      <Row>
        <TextInput
          label="Build starts" type="date" value={dates.buildStartsOn}
          onChange={e => setDates(d => ({ ...d, buildStartsOn: e.target.value }))}
        />
        <TextInput
          label="Festival starts" type="date" value={dates.startsOn}
          onChange={e => setDates(d => ({ ...d, startsOn: e.target.value }))}
        />
      </Row>
      <Row>
        <TextInput
          label="Festival ends" type="date" value={dates.endsOn}
          onChange={e => setDates(d => ({ ...d, endsOn: e.target.value }))}
        />
        <TextInput
          label="Pack-down ends" type="date" value={dates.packdownEndsOn}
          onChange={e => setDates(d => ({ ...d, packdownEndsOn: e.target.value }))}
        />
      </Row>
      <Button variant="primary" icon="plus" onClick={create} disabled={busy || !name.trim()}>
        Create event
      </Button>
      <p className={s.hint}>
        Created as a draft with applications closed, no departments and nothing open —
        you configure all of that next.
      </p>

      {(failure || error) && (
        <Callout tone="danger" title="Something went wrong">{failure || error.message}</Callout>
      )}

      {!events.length && (
        <EmptyState
          icon="calendar" compact title="No events yet"
          body="Create one to set dates, departments and what applications are open."
        />
      )}

      <ul className={s.list}>
        {events.map(ev => (
          <EventRow
            key={ev.id}
            event={ev}
            onOpen={() => navigate(`/festival/event/${ev.id}`)}
            onDuplicate={() => run(async () => {
              const id = await eventConfig.duplicateEvent(ev.id, `${ev.name} (copy)`);
              navigate(`/festival/event/${id}`);
            })}
            onArchive={() => run(() => eventConfig.setArchived(ev.id, !ev.archived))}
            onDelete={() => run(() => eventConfig.deleteEvent(ev.id))}
          />
        ))}
      </ul>
    </SectionCard>
  );
}
