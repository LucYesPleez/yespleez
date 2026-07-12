import s from './FeaturedEventCard.module.css';

function formatShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
}

export default function FeaturedEventCard({ event, onClick, label = 'FEATURED' }) {
  const cfg      = event.config || {};
  const poster   = cfg.poster || cfg.posterUrl || '';
  const genreList = (cfg.genres || '').split(',').map(g => g.trim()).filter(Boolean).slice(0, 4);
  const bg = cfg._bg || 'linear-gradient(135deg,#1a0533 0%,#2d1b69 45%,#0d3b2e 100%)';

  return (
    <div
      className={s.card}
      onClick={onClick}
      style={poster ? { backgroundImage: `url(${poster})` } : { background: bg }}
    >
      <div className={s.overlay} />
      <div className={s.badge}>{label}</div>
      <div className={s.content}>
        <div className={s.date}>{formatShortDate(cfg.date)}</div>
        <div className={s.name}>{event.name}</div>
        {cfg.venue && (
          <div className={s.venue}>
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 4, flexShrink: 0 }}>
              <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>
            </svg>
            {cfg.venue}
          </div>
        )}
        {genreList.length > 0 && (
          <div className={s.tags}>
            {genreList.map(g => <span key={g} className="glow-pill">{g}</span>)}
          </div>
        )}
      </div>
      <button className={s.arrow} onClick={e => { e.stopPropagation(); onClick(); }}>›</button>
    </div>
  );
}
