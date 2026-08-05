import { useNavigate } from 'react-router-dom';
import { SectionCard, Button, EmptyState } from '../design-system';
import s from './panels.module.css';

/**
 * "Recent Messages" — a window onto the shared inbox, not a second one.
 *
 * ⛔ The Festival Portal builds NO messaging. When this is wired it reads the
 * same conversations as every other YesPleez surface, through the same
 * platform system. A festival-flavoured message store would be the exact
 * duplication the portal model exists to prevent.
 */
const MESSAGES = [
  { id: 'm1', name: 'Solar Wave',      time: '10:24 AM', unread: 1, text: 'Hi! Just checking if there’s an update on our application?' },
  { id: 'm2', name: 'Forest Dwellers', time: 'Yesterday', unread: 0, text: 'Thanks for considering our application. Looking forward…' },
  { id: 'm3', name: 'Kai Flame',       time: 'Yesterday', unread: 0, text: 'Sending through the updated stage plot now.' },
];

export default function MessagesPanel({ messages = MESSAGES }) {
  const navigate = useNavigate();

  return (
    <SectionCard
      title="Recent Messages"
      actions={<Button variant="ghost" size="sm" onClick={() => navigate('/messages')}>View all</Button>}
    >
      {messages.length === 0 ? (
        <EmptyState
          icon="messages"
          title="No messages"
          body="Conversations with applicants appear here."
          compact
        />
      ) : (
        <div className={s.list}>
          {messages.map(m => (
            <button key={m.id} type="button" className={s.message} onClick={() => navigate('/messages')}>
              <span className={s.avatar} />
              <span className={s.msgBody}>
                <span className={s.msgTop}>
                  <span className={s.msgName}>{m.name}</span>
                  <span className={s.msgTime}>{m.time}</span>
                </span>
                <span className={s.msgText}>{m.text}</span>
              </span>
              {/* Zero is not a badge — see the badge law in SidebarItem. */}
              {m.unread > 0 && <span className={s.unread}>{m.unread}</span>}
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
