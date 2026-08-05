import StubScreen from './StubScreen';

/**
 * The four routes the shell reaches but does not implement.
 *
 * Each note says what the screen will be AND which existing YesPleez system
 * it will consume — the Festival Portal builds no messaging, no notification
 * pipeline and no profile system of its own. Writing that down here is
 * cheaper than discovering it during the build.
 */

export function MessagesScreen() {
  return (
    <StubScreen
      title="Messages"
      note="Application threads, opening in the shared conversation dock. Consumes the platform's existing messaging system — one inbox, one thread model, across every YesPleez portal. Nothing festival-specific is built here."
      blocks={['Thread list', 'Conversation', 'Composer']}
    />
  );
}

export function AnnouncementsScreen() {
  return (
    <StubScreen
      title="Announcements"
      note="Broadcast to an audience defined by category and status, delivered to the notification bell. Replies are disabled by design: an announcement that opens 400 threads is an inbox collapse, so recipients reply through their own thread instead."
      blocks={['Composer', 'Audience', 'Sent history']}
    />
  );
}

export function FestivalProfileScreen() {
  return (
    <StubScreen
      title="Festival Profile"
      note="The public face of the festival, and the categories it is accepting. Identity and dates live on the shared profile system; only the applications strip is portal-specific."
      blocks={['Identity', 'Dates & location', 'Media', 'Categories & windows']}
    />
  );
}

export function SettingsScreen() {
  return (
    <StubScreen
      title="Settings"
      note="Team, application preferences, notification defaults, data and the danger zone. Roles are festival-wide in this milestone; category-scoped review is a later addition the schema already allows for."
      blocks={['Team', 'Applications', 'Notifications', 'Data', 'Danger zone']}
    />
  );
}

export function HelpScreen() {
  return (
    <StubScreen
      title="Help & Support"
      note="Placeholder route so the sidebar's footer item leads somewhere rather than dead-ending."
      blocks={['Guides', 'Contact']}
    />
  );
}
