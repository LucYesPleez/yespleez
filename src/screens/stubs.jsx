import StubScreen from './StubScreen';

/**
 * The two destinations the shell reaches but does not implement.
 *
 * Messages is deliberately the LAST screen to be built. It consumes the
 * platform's existing conversation system, and building UI for it before that
 * contract is settled risks inventing a second one — which is the single
 * thing the portal model exists to prevent.
 *
 * Overview, Applications, Announcements, Festival and Settings are all real
 * screens now; these two are what remain.
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

export function HelpScreen() {
  return (
    <StubScreen
      title="Help & Support"
      subtitle="Placeholder route so the sidebar's footer item leads somewhere rather than dead-ending."
      blocks={[{ title: 'Guides', note: 'How the workspace is meant to be used.' }]}
    />
  );
}
