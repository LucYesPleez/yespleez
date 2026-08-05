import StubScreen from './StubScreen';
import AnnouncementButton from '../shell/AnnouncementButton';

/**
 * The four destinations the shell reaches but does not implement.
 *
 * Every subtitle records which shared system the screen will consume. The
 * portal builds no messaging, no notification pipeline and no profile store —
 * writing that here is cheaper than rediscovering it mid-build.
 */

export function MessagesScreen() {
  return (
    <StubScreen
      title="Messages"
      subtitle="Conversations with applicants, opening in the shared conversation dock. Reads the platform's existing messaging system — one inbox and one thread model across every YesPleez portal. Nothing festival-specific is built here."
      blocks={[
        { title: 'Threads',      note: 'Filtered to this festival; the inbox itself is global.' },
        { title: 'Conversation', note: 'The same view used everywhere else in YesPleez.' },
        { title: 'Composer',     note: 'Sends as the festival, never as the person operating it.' },
      ]}
    />
  );
}

export function AnnouncementsScreen() {
  return (
    <StubScreen
      title="Announcements"
      subtitle="Broadcast to an audience defined by category and status, delivered to the notification bell. Replies are disabled by design — an announcement that opens four hundred threads is an inbox collapse, so recipients reply through their own thread instead."
      actions={<AnnouncementButton />}
      blocks={[
        { title: 'Compose',  note: 'Subject, body, and the exact recipient count before sending.' },
        { title: 'Audience', note: 'Category and status filters resolve to a number you can check.' },
        { title: 'Sent',     note: 'Immutable history. An announcement cannot be recalled.' },
      ]}
    />
  );
}

export function FestivalScreen() {
  return (
    <StubScreen
      title="Festival"
      subtitle="The public face of the festival and the categories it accepts. Identity, dates and media live on the shared profile system; only the application windows are portal-specific."
      blocks={[
        { title: 'Identity',        note: 'Name, logo, banner — the shared profile record.' },
        { title: 'Dates & location', note: 'Drives the public page and every deadline shown here.' },
        { title: 'Categories',      note: 'Which categories are open, and when each closes.' },
        { title: 'Public page',     note: 'Preview exactly what an applicant sees.' },
      ]}
    />
  );
}

export function SettingsScreen() {
  return (
    <StubScreen
      title="Settings"
      subtitle="Team, application preferences, notification defaults and data. Roles are festival-wide in this milestone; category-scoped review is a later addition the architecture already allows for."
      blocks={[
        { title: 'Team',          note: 'Owner, Admin and Reviewer. Exactly one Owner.' },
        { title: 'Applications',  note: 'Default decline message and acknowledgement copy.' },
        { title: 'Notifications', note: 'What the team is emailed or pushed.' },
        { title: 'Data',          note: 'Export, and the platform retention policy.' },
      ]}
    />
  );
}

export function HelpScreen() {
  return (
    <StubScreen
      title="Help & Support"
      subtitle="Placeholder route so the sidebar's footer item leads somewhere rather than dead-ending."
      blocks={[{ title: 'Guides', note: 'How the workspace is meant to be used.' }]}
    />
  );
}
