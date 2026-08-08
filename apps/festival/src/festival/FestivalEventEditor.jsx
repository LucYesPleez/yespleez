import { useEffect, useState, useContext } from 'react';
import { EventEditorForm, useEventEditorState } from '@yespleez/event-editor';
import { SessionContext } from '../auth/sessionContext';
import { useRepositories } from '../data/dataContext';
import { Button } from '../design-system';

/**
 * THIS APP'S EVENT EDITOR — the wrapper, and nothing else.
 *
 * ⭐⭐ THE POINT: `@yespleez/event-editor` contains none of what is below, and
 * nothing was added to it to make this work. The same component that the other
 * application renders, rendered here, with different answers to the same
 * questions.
 *
 * ⛔ THE DIRECTION. The wrapper adapts this application to the package. It
 * never adapts the package to this application. If something here seems to
 * need a flag inside the package, that is a finding about the boundary.
 *
 * What this host answers differently:
 *
 *   categories   no chip vocabulary at all. This app's categories describe
 *                what a festival RECRUITS — music, volunteers, vendors — which
 *                is a different question from what kind of event this is. An
 *                event here is a festival occurrence; there is nothing to
 *                choose, so nothing is offered, and `classify` has nothing to
 *                infer from.
 *   components   NEITHER an uploader NOR a co-host picker. There is no storage
 *                bucket or policy here yet, and co-hosting is not a concept in
 *                this world. Both are optional capabilities: absent, their
 *                controls simply do not render. Existing media stays in the
 *                event model and is untouched.
 *   adornments   none. No advice to offer about a taxonomy that does not exist.
 *   actions      this app's own save, in its own words.
 */

/** No vocabulary, and nothing to infer. Both are legitimate answers. */
const categories = {
  choices: [],
  classify: () => [],
  isSame: (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase(),
};

/** This app has one kind of applicant profile worth naming in the editor. */
const labelProfileType = type => (type ? String(type).toUpperCase() : '');

/** ⛔ No uploader, no co-host picker. Absent, not stubbed. */
const components = {};

export default function FestivalEventEditor({ eventId }) {
  const { session } = useContext(SessionContext);
  const { eventConfig } = useRepositories();
  const userId = session?.user?.id ?? null;

  // ⛔ No uploadPosterCrop — cropping writes to storage this app does not have.
  const ed = useEventEditorState({ userId });

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const row = await eventConfig.getEventForEditing(eventId);
        if (cancelled || !row) return;
        // ⭐ The row goes straight to the shared model. This app never parses
        // `config` — one interpreter, so two apps cannot disagree about what
        // an event says.
        ed.hydrate(row);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  async function save() {
    setSaving(true); setError(''); setSavedAt(null);
    try {
      await eventConfig.saveEventFromEditor(eventId, {
        name: ed.name,
        config: ed.toConfig(),
        isPublic: ed.isPublic,
        applicationsOpen: ed.appsOpen,
        requiredItems: ed.requiredItems,
      });
      setSavedAt(Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  return (
    <EventEditorForm
      ed={ed}
      editId={eventId}
      userId={userId}
      categories={categories}
      labelProfileType={labelProfileType}
      components={components}
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save event'}
          </Button>
          {error && <span style={{ color: 'var(--danger, #f66)', fontSize: 13 }}>{error}</span>}
          {savedAt && !error && <span style={{ opacity: 0.6, fontSize: 13 }}>Saved</span>}
        </div>
      }
    />
  );
}
