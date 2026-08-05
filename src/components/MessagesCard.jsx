import s from './WidgetCard.module.css';

/**
 * "Recent Messages" — a bottom widget.
 *
 * Placeholder rows only. When this is wired it reads from the same messaging
 * system as every other YesPleez portal — one inbox, one thread model. There
 * is no festival-flavoured messaging to build.
 */
const MESSAGES = [
  { id: 'm1', name: 'Solar Wave',     time: '10:24 AM', unread: 1, text: 'Hi! Just checking if there’s an update on our application?' },
  { id: 'm2', name: 'Forest Dwellers', time: 'Yesterday', unread: 0, text: 'Thanks for considering our application. Looking forward…' },
  { id: 'm3', name: 'Kai Flame',       time: 'Yesterday', unread: 0, text: 'Sending through the updated stage plot now.' },
];

export default function MessagesCard({ title = 'Recent Messages' }) {
  return (
    <section className={`fp-panel ${s.card}`}>
      <div className={s.header}>
        <span className={s.title}>{title}</span>
        <button className={s.action} type="button">View All</button>
      </div>
      <div className={s.body}>
        {MESSAGES.map(m => (
          <div key={m.id} className={s.message}>
            <span className={s.avatar} />
            <div className={s.msgBody}>
              <div className={s.msgTop}>
                <span className={s.msgName}>{m.name}</span>
                <span className={s.msgTime}>{m.time}</span>
              </div>
              <div className={s.msgText}>{m.text}</div>
            </div>
            {/* Zero is not a badge. An absent count and a count of zero are
                different facts, and only one of them is worth a red dot. */}
            {m.unread > 0 && <span className={s.unread}>{m.unread}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
