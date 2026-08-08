import { useEffect, useState } from 'react';
import { SectionCard, Button, EmptyState, Icon, Callout } from '../design-system';
import { TextInput, Toggle, Row } from '../design-system/Form';
import { CATEGORIES } from '../config/categories';
import { useRepositories } from '../data/dataContext';
import { useQuery } from '../data/useQuery';
import s from './ApplicationSetup.module.css';

/**
 * THE EVENT APPLICATION EDITOR.
 *
 * ⭐ This is the last piece of configuration that belongs to the ORGANISER
 * rather than to code. Departments and dates are data entered here; the public
 * apply page renders entirely from them. Deliverance's list is simply the first
 * real data through it, and no future festival needs a code change to open
 * applications.
 *
 * ⛔ Do not add a default department list "to get started". A helpful default
 * is how a hardcoded list gets back in: every festival keeps the seed, and six
 * months later the seed is the product.
 */
function Dates({ eventId }) {
  const { eventConfig } = useRepositories();
  const { data, reload } = useQuery(() => eventConfig.getSettings(eventId), [eventId]);
  const { data: event, reload: reloadEvent } = useQuery(() => eventConfig.getEvent(eventId), [eventId]);
  const [form, setForm] = useState(null);
  const [name, setName] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Seed the form once the values arrive, and never again — re-seeding on every
  // data change would discard what the organiser is halfway through typing.
  useEffect(() => { if (data && !form) setForm(data); }, [data, form]);
  useEffect(() => { if (event && name === null) setName(event.name ?? ''); }, [event, name]);
  if (!form || name === null) return null;

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setSaved(false); setError(''); };

  async function save() {
    setSaving(true);
    setError('');
    try {
      if (name.trim() && name.trim() !== event?.name) {
        await eventConfig.setEventName(eventId, name.trim());
        reloadEvent();
      }
      await eventConfig.saveSettings(eventId, form);
      setSaved(true);
      reload();
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }

  const field = (label, key) => (
    <TextInput label={label} type="date" value={form[key] ?? ''} onChange={e => set(key, e.target.value)} />
  );

  return (
    <SectionCard
      title="This event"
      subtitle="The round you are taking applications for. Its name is the heading applicants see, and the dates are what they pick their availability from — the day list writes itself, so nobody types thirteen dates by hand."
    >
      {/* ⚠ The event name is a separate thing from the festival's name and both
          appear on the apply page. Left uneditable, a festival renamed in
          Identity showed the old name one line below the new one. */}
      <TextInput
        label="Event name"
        value={name}
        placeholder="Echo Valley Festival 2026"
        onChange={e => { setName(e.target.value); setSaved(false); setError(''); }}
      />
      <Row>{field('Build starts', 'buildStartsOn')}{field('Build ends', 'buildEndsOn')}</Row>
      <Row>{field('Festival starts', 'startsOn')}{field('Festival ends', 'endsOn')}</Row>
      <Row>{field('Pack-down starts', 'packdownStartsOn')}{field('Pack-down ends', 'packdownEndsOn')}</Row>
      {error && <Callout tone="danger" title="Not saved">{error}</Callout>}
      <Button variant="primary" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save event'}
      </Button>
    </SectionCard>
  );
}

function Departments({ eventId }) {
  const { eventConfig } = useRepositories();
  const { data, reload } = useQuery(
    () => eventConfig.listDepartments(eventId, { includeArchived: true }), [eventId],
  );
  const [adding, setAdding] = useState('');

  async function add() {
    const name = adding.trim();
    if (!name) return;
    setAdding('');
    await eventConfig.createDepartment(eventId, name);
    reload();
  }

  const rows = data ?? [];

  return (
    <SectionCard
      title="Volunteer departments"
      count={rows.filter(d => !d.archived).length}
      subtitle="What applicants choose from. Yours alone — a beach festival's reads Boat Crew and Shuttle Drivers."
    >
      <Row>
        <TextInput
          label="Add a department"
          value={adding}
          placeholder="Front Gate"
          onChange={e => setAdding(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
      </Row>
      <Button variant="secondary" icon="plus" onClick={add} disabled={!adding.trim()}>Add</Button>

      {!rows.length && (
        <EmptyState
          icon="volunteer" compact title="No departments yet"
          body="Add the areas volunteers can work in. Until there is at least one, the application asks nobody where they want to work."
        />
      )}

      <ul className={s.list}>
        {rows.map((d, i) => (
          <li key={d.id} className={`${s.row} ${d.archived ? s.archived : ''}`}>
            <div className={s.rowFields}>
              <input
                className={s.inlineInput}
                defaultValue={d.name}
                aria-label="Department name"
                onBlur={e => {
                  const name = e.target.value.trim();
                  if (name && name !== d.name) eventConfig.updateDepartment(d.id, { name }).then(reload);
                }}
              />
              <input
                className={`${s.inlineInput} ${s.desc}`}
                defaultValue={d.description ?? ''}
                placeholder="Description (optional)"
                aria-label="Department description"
                onBlur={e => {
                  const description = e.target.value.trim() || null;
                  if (description !== (d.description ?? null)) {
                    eventConfig.updateDepartment(d.id, { description }).then(reload);
                  }
                }}
              />
            </div>
            <div className={s.rowActions}>
              <button type="button" className={s.iconBtn} aria-label="Move up" disabled={i === 0}
                onClick={() => eventConfig.moveDepartment(eventId, d.id, 'up').then(reload)}>
                <Icon name="chevron" size={14} className={s.up} />
              </button>
              <button type="button" className={s.iconBtn} aria-label="Move down" disabled={i === rows.length - 1}
                onClick={() => eventConfig.moveDepartment(eventId, d.id, 'down').then(reload)}>
                <Icon name="chevron" size={14} />
              </button>
              {/* ⛔ Archive, never delete: applications record a department by
                  name, and deleting would strand last year's volunteers in
                  something that no longer exists. */}
              <Button size="sm" variant="quiet"
                onClick={() => eventConfig.archiveDepartment(d.id, !d.archived).then(reload)}>
                {d.archived ? 'Restore' : 'Archive'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function OpenCategories({ eventId }) {
  const { eventConfig } = useRepositories();
  const { data, reload } = useQuery(() => eventConfig.listCategories(eventId), [eventId]);
  const byKey = new Map((data ?? []).map(r => [r.key, r]));

  return (
    <SectionCard
      title="What is open"
      subtitle="Only open categories appear on the application page. A category with nobody able to apply for it says so there rather than vanishing."
    >
      {CATEGORIES.map(c => {
        const row = byKey.get(c.key);
        if (!row) return null;
        return (
          <Toggle
            key={c.key}
            label={c.label}
            checked={row.state === 'open'}
            hint={(c.appliesAs ?? []).length ? undefined : 'No profile type can apply to this yet'}
            onChange={next => eventConfig.setCategoryState(row.id, next ? 'open' : 'closed').then(reload)}
          />
        );
      })}
    </SectionCard>
  );
}

export default function ApplicationSetup({ eventId }) {
  if (!eventId) return null;
  return (
    <>
      <Dates eventId={eventId} />
      <Departments eventId={eventId} />
      <OpenCategories eventId={eventId} />
    </>
  );
}
