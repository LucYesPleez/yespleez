import { SectionCard, ListRow, EmptyState, Button } from '../design-system';
import s from './Announcements.module.css';

/**
 * WHAT HAS ALREADY GONE OUT.
 *
 * ⭐ Immutable by design, and the UI has to look immutable. There is no edit
 * action and no delete action on any row — only "View". An announcement that
 * appears editable invites someone to try, and discovering it cannot be
 * recalled AFTER pressing something is the worst possible moment to learn it.
 *
 * Every row states its audience and its recipient count, because six months
 * later "who did we tell about the load-in change?" is the only question
 * anyone asks of this list.
 */
const SENT = [
  { id: 's1', subject: 'Load-in times and site access', audience: 'Accepted · Music', recipients: 18, when: '2 days ago' },
  { id: 's2', subject: 'Applications closing this Friday', audience: 'All categories', recipients: 384, when: '1 week ago' },
  { id: 's3', subject: 'Volunteer briefing — please read', audience: 'Accepted · Volunteers', recipients: 41, when: '2 weeks ago' },
];

export default function SentHistory({ items = SENT }) {
  return (
    <SectionCard
      title="Sent"
      count={items.length}
      subtitle="Announcements cannot be edited or recalled once sent."
    >
      {items.length === 0 ? (
        <EmptyState
          icon="announcements"
          title="Nothing sent yet"
          body="Announcements you send appear here with the audience they reached."
          compact
        />
      ) : (
        items.map(a => (
          <ListRow
            key={a.id}
            icon="announcements"
            title={a.subject}
            meta={
              <span className={s.sentMeta}>
                <span className={s.pill}>{a.audience}</span>
                <span>{a.recipients} recipients</span>
                <span>·</span>
                <span>{a.when}</span>
              </span>
            }
            trail={<Button variant="ghost" size="sm">View</Button>}
          />
        ))
      )}
    </SectionCard>
  );
}
