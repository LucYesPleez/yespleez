import StubScreen from './StubScreen';

/**
 * The one destination the shell reaches but does not implement.
 *
 * Every other screen is real. Help is a placeholder so the sidebar's footer
 * item leads somewhere rather than dead-ending.
 */

export function HelpScreen() {
  return (
    <StubScreen
      title="Help & Support"
      subtitle="Placeholder route so the sidebar's footer item leads somewhere rather than dead-ending."
      blocks={[{ title: 'Guides', note: 'How the workspace is meant to be used.' }]}
    />
  );
}
