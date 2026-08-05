import { useState } from 'react';
import {
  SectionCard, Button, Callout, TextInput, Textarea, Toggle,
} from '../design-system';
import AudiencePicker from '../announcements/AudiencePicker';
import { recipientCount } from '../announcements/recipientCount';
import SentHistory from '../announcements/SentHistory';
import a from '../announcements/Announcements.module.css';
import s from './screens.module.css';

/**
 * ANNOUNCEMENTS — broadcast, not conversation.
 *
 * ⭐ THE DESIGN RULE: an announcement is a one-way broadcast object, and
 * replies are disabled on it deliberately. An announcement that opens four
 * hundred threads is an inbox collapse; recipients reply through their own
 * application thread instead, where the context already is. The screen SAYS
 * this rather than leaving people to discover it.
 *
 * ⭐ THE SECOND RULE: irreversibility is stated beside the button, not in a
 * dialog after the click. A confirmation dialog asks "are you sure?" of
 * someone who has already decided.
 *
 * ⛔ No sending, no audience resolution, no persistence. The composer holds
 * its own field values — that is UI state — and nothing leaves this screen.
 */
export default function AnnouncementsScreen() {
  const [categories, setCategories] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [publicAlso, setPublicAlso] = useState(false);

  const narrowed = statuses.length > 0;
  const count = recipientCount(categories);

  return (
    <div className={s.page}>
      <header className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Announcements</h1>
          <p className={s.pageSubtitle}>
            One message to many applicants, delivered to their notifications. Replies are disabled —
            recipients answer in their own application thread, where the context already is.
          </p>
        </div>
      </header>

      <div className={a.layout}>
        <SectionCard title="Compose" subtitle="Written once, sent to everyone in the audience you choose.">
          <div className={a.composer}>
            <TextInput
              label="Subject"
              placeholder="Load-in times and site access"
              maxLength={90}
            />
            <Textarea
              label="Message"
              rows={9}
              placeholder="Write the announcement. Applicants see it in their notifications and on their application."
            />

            <Toggle
              label="Also publish on the festival's public page"
              hint="Anyone can read it, including people who never applied."
              checked={publicAlso}
              onChange={setPublicAlso}
            />

            <Callout tone="danger" title="Sending cannot be undone">
              An announcement cannot be edited or recalled. Check the recipient count before you
              send — {narrowed ? 'the audience is narrowed and the exact figure is not available yet' : `this one reaches ${count} people`}.
            </Callout>

            <div className={a.sendRow}>
              <span className={a.sendNote}>Up to 5 announcements a day.</span>
              <Button variant="primary" icon="announcements" disabled={narrowed}>
                {narrowed ? 'Send' : `Send to ${count}`}
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Audience" subtitle="Who receives this. The count updates as you choose.">
          <AudiencePicker
            categories={categories}
            statuses={statuses}
            onCategories={setCategories}
            onStatuses={setStatuses}
          />
        </SectionCard>
      </div>

      <SentHistory />
    </div>
  );
}
