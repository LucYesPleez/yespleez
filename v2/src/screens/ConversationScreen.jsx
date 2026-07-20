import { useParams } from 'react-router-dom';
import ConversationView from '../components/ConversationView';

/**
 * FULL-PAGE conversation, at /messages/:id.
 *
 * The DRAWER is the primary experience — daily communication happens there,
 * without leaving whatever the user was doing. This route survives for direct
 * links, deep links from a notification, and anyone who navigated here on
 * purpose.
 *
 * It renders the SAME ConversationView the drawer renders, so the two cannot
 * drift. Two thread implementations would mean fixing one and rotting the
 * other, and the drawer is the one that matters day to day.
 */
export default function ConversationScreen() {
  const { id } = useParams();

  return (
    <div style={{ paddingTop: 72, paddingBottom: 90, height: '100dvh', background: 'var(--bg)', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', height: '100%', padding: '0 8px', boxSizing: 'border-box' }}>
        <ConversationView conversationId={id} />
      </div>
    </div>
  );
}
