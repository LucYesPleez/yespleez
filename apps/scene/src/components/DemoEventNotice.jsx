import s from './DemoEventNotice.module.css';

// Explains that a tapped event is sample/demo content, not a real gig.
// Used two ways with the same props: as an overlay from WhatsOnScreen (card
// tap, page stays put behind it) and as EventScreen's entire render output
// when /event/:id resolves to a demo id (e.g. a bookmarked link) — in both
// cases `onClose` is just "how to leave this notice", the caller decides
// whether that means clearing local state or navigating home.
export default function DemoEventNotice({ event, onClose }) {
  if (!event) return null;
  const cfg = event.config || {};

  return (
    <div className={s.backdrop} onClick={onClose}>
      <div className={s.sheet} onClick={e => e.stopPropagation()}>
        <div className={s.handle} />

        <div className={s.header}>
          <span className={s.badge}>DEMO</span>
          <button className={s.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={s.title}>{event.name}</div>
        {cfg.venue && <div className={s.venue}>{cfg.venue}</div>}

        <p className={s.body}>
          This is a sample event, shown to give you a feel for YesPleez while the local scene grows.
          It isn't a real gig — real events from artists, hosts, and venues will start appearing here
          as the community joins.
        </p>

        <button className={s.cta} onClick={onClose}>GOT IT</button>
      </div>
    </div>
  );
}
