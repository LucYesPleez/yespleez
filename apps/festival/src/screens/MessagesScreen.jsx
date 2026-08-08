import { useState } from 'react';
import {
  SectionCard, ListRow, Callout, Button, EmptyState, Chip, StatusBadge,
} from '../design-system';
import { PLACEHOLDER_THREADS } from '../config/placeholderThreads';
import s from './screens.module.css';

/**
 * MESSAGES — the list is ours, the conversation is not.
 *
 * ⭐ THE BOUNDARY THIS SCREEN EXISTS TO HOLD. Which conversations relate to
 * this festival's applications is a portal question, so the list is built
 * here. What a message looks like, how a thread renders, how a draft is kept
 * — those belong to the platform's conversation system, which already exists
 * and is used by every other YesPleez surface.
 *
 * So there is deliberately NO conversation view in this repository. Opening a
 * thread hands off to the shared dock. Building a message bubble here would
 * be the exact duplication the portal model exists to prevent, and it would
 * be the hardest kind to unpick later because it would look finished.
 *
 * The Callout says so on screen rather than only in this comment — the next
 * person to open this file will more likely be looking at the app.
 */
const FILTERS = [
  { key: 'all',    label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'mine',   label: 'Assigned to me' },
];

export default function MessagesScreen() {
  const [filter, setFilter] = useState('all');
  const threads = PLACEHOLDER_THREADS;
  const unread = threads.reduce((n, t) => n + (t.unread > 0 ? 1 : 0), 0);

  return (
    <div className={s.page}>
      <header className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Messages</h1>
          <p className={s.pageSubtitle}>
            Conversations with applicants about this festival. The inbox itself is shared across
            every YesPleez portal — this is a view of it, not a second one.
          </p>
        </div>
      </header>

      <Callout tone="info" icon="messages" title="Conversations open in the shared dock">
        The Festival Portal builds no messaging of its own. Threads, drafts, attachments and read
        state all belong to the platform's conversation system, so a message looks and behaves the
        same here as it does anywhere else in YesPleez. Only this list — which conversations relate
        to this festival — is portal-specific.
      </Callout>

      <SectionCard
        title="Threads"
        count={threads.length}
        actions={
          <div className={s.filterRow}>
            {FILTERS.map(f => (
              <Chip
                key={f.key}
                label={f.label}
                count={f.key === 'unread' ? unread : undefined}
                selected={filter === f.key}
                onClick={() => setFilter(f.key)}
              />
            ))}
          </div>
        }
      >
        {threads.length === 0 ? (
          <EmptyState
            icon="messages"
            title="No conversations yet"
            body="Messages appear here once you or an applicant starts one."
            compact
          />
        ) : (
          threads.map(t => (
            <ListRow
              key={t.id}
              avatar
              title={t.name}
              meta={t.preview}
              badge={<StatusBadge status="in_review" />}
              trail={
                <>
                  <span className={s.threadTime}>{t.when}</span>
                  {/* Zero is not a badge — the absence of one is the signal. */}
                  {t.unread > 0 && <span className={s.threadUnread}>{t.unread}</span>}
                  <Button variant="ghost" size="sm" icon="external" aria-label={`Open conversation with ${t.name}`} />
                </>
              }
              onClick={() => {}}
            />
          ))
        )}
      </SectionCard>
    </div>
  );
}
