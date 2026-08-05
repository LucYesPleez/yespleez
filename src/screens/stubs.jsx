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

export function HelpScreen() {
  return (
    <StubScreen
      title="Help & Support"
      subtitle="Placeholder route so the sidebar's footer item leads somewhere rather than dead-ending."
      blocks={[{ title: 'Guides', note: 'How the workspace is meant to be used.' }]}
    />
  );
}
