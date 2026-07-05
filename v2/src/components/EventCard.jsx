import { useNavigate } from 'react-router-dom';
import s from './EventCard.module.css';
import { formatDisplayDate } from '../lib/dates';
import { getEventBadges } from '../lib/eventBadges';

function fmtChip(dateStr) {
  if (!dateStr) return {};
  const d = new Date(dateStr + 'T12:00:00');
  return { dayName: d.toLocaleDateString('en-AU',{weekday:'short'}).toUpperCase(), dayNum: d.getDate(), mon: d.toLocaleDateString('en-AU',{month:'short'}).toUpperCase() };
}
function fmtTime(cfg) { return cfg?.time ? cfg.time + (cfg.ampm ? ' ' + cfg.ampm : '') : ''; }
function fmtListDate(dateStr, cfg) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'}) + (fmtTime(cfg) ? ` · ${fmtTime(cfg)}` : '');
}

const PinIcon = () => (
  <svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
    <path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'/><circle cx='12' cy='10' r='3'/>
  </svg>
);

const ClockIcon = () => (
  <svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
    <circle cx='12' cy='12' r='10'/><polyline points='12 6 12 12 16 14'/>
  </svg>
);

// Shared pill style matching WhatsOnScreen
function Pill({ label, bg, col }) {
  return (
    <span style={{
      fontFamily: "'DM Sans', sans-serif",
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: .8,
      padding: '3px 8px',
      borderRadius: 6,
      background: bg,
      color: col,
    }}>
      {label}
    </span>
  );
}

/**
 * Props:
 *   event      – { id, name, config: { date, venue, genres, poster, time, ampm } }
 *   badge      – override badge label (e.g. "ATTENDING", "PLAYING", "MY EVENT")
 *   badgeColor – override badge colour
 *   onClick    – click handler
 *   variant    – "card" (default) | "scroll" | "row"
 *   small      – legacy, treated as variant="scroll"
 */
export default function EventCard({ event, badge: badgeOverride, badgeColor, onClick, variant, small = false, noHover = false }) {
  const navigate = useNavigate();
  const cfg    = event?.config || {};
  const poster = event?.poster_url || cfg.poster_thumb || cfg.poster || null;
  const date   = cfg.date  || '';
  const venue  = cfg.venue || '';
  const genres = cfg.genres || '';

  const autoBadges = getEventBadges(genres, event?.name || '');
  // Override takes precedence as a single pill
  const pills = badgeOverride
    ? [{ label: badgeOverride, bg: badgeColor || '#fff', col: '#fff' }]
    : autoBadges;

  const handleClick = onClick || (() => navigate(`/event/${event.id}`));

  // ── variant="scroll" ──
  if (variant === 'scroll' || small) {
    const chip = fmtChip(date);
    const venueShort = venue.split(',')[0];
    return (
      <div onClick={handleClick} style={{ flexShrink:0, width:195, borderRadius:16, overflow:'hidden', background:'var(--card2)', border:'1px solid rgba(255,255,255,.08)', cursor:'pointer' }}>
        <div style={{ height:120, background: poster ? `url('${poster}') center/cover no-repeat` : 'linear-gradient(135deg,rgba(255,45,120,.25),rgba(157,78,221,.25))', position:'relative' }}>
          {pills.length > 0 && (
            <div style={{ position:'absolute', top:8, left:8, display:'flex', gap:4, flexWrap:'wrap' }}>
              {pills.map(p => <Pill key={p.label} {...p} />)}
            </div>
          )}
          {chip.dayNum && (
            <div style={{ position:'absolute', top:8, right:8, background:'rgba(0,0,0,.65)', backdropFilter:'blur(4px)', borderRadius:8, padding:'4px 8px', textAlign:'center', minWidth:36 }}>
              <div style={{ fontFamily:"'Bebas Neue'", fontSize:9, color:'rgba(255,255,255,.7)', letterSpacing:.5 }}>{chip.dayName}</div>
              <div style={{ fontFamily:"'Bebas Neue'", fontSize:16, color:'white', lineHeight:1 }}>{chip.dayNum}</div>
              <div style={{ fontFamily:"'Bebas Neue'", fontSize:9, color:'rgba(255,255,255,.7)', letterSpacing:.5 }}>{chip.mon}</div>
            </div>
          )}
        </div>
        <div style={{ padding:'10px 12px 12px' }}>
          <div style={{ fontFamily:"'Bebas Neue'", fontSize:16, letterSpacing:.5, marginBottom:5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {event.name || 'Event'}
          </div>
          {venueShort && (
            <div style={{ fontSize:11, color:'var(--muted)', display:'flex', alignItems:'center', gap:4, marginBottom:3 }}>
              <PinIcon /><span style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{venueShort}</span>
            </div>
          )}
          {fmtTime(cfg) && (
            <div style={{ fontSize:11, color:'var(--muted)', display:'flex', alignItems:'center', gap:4 }}>
              <ClockIcon />{fmtTime(cfg)}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── variant="row" ──
  if (variant === 'row') {
    const dateLabel = fmtListDate(date, cfg);
    const venueShort = venue.split(',')[0];
    return (
      <div onClick={handleClick} style={{ display:'flex', alignItems:'center', gap:12, padding:12, background:'var(--card2)', border:'1px solid rgba(255,255,255,.08)', borderRadius:14, marginBottom:8, cursor:'pointer' }}>
        <div style={{ width:64, height:64, borderRadius:10, background: poster ? `url('${poster}') center/cover no-repeat` : 'linear-gradient(135deg,rgba(0,229,160,.2),rgba(0,229,255,.2))', flexShrink:0, position:'relative' }}>
          {pills.length > 0 && (
            <div style={{ position:'absolute', bottom:4, left:4, display:'flex', gap:3, flexWrap:'wrap' }}>
              {pills.map(p => <Pill key={p.label} {...p} />)}
            </div>
          )}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:"'Bebas Neue'", fontSize:16, letterSpacing:.5, marginBottom:4, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {event.name || 'Event'}
          </div>
          {dateLabel && <div style={{ fontSize:12, color:'var(--muted)', marginBottom:3 }}>{dateLabel}</div>}
          {venueShort && (
            <div style={{ fontSize:11, color:'var(--muted)', display:'flex', alignItems:'center', gap:4 }}>
              <PinIcon />{venueShort}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── variant="card" (default) ──
  const isLive = event?.status === 'live';
  const chip = fmtChip(date);
  // Status badge (override) shown on the right; genre pills shown inline with venue
  const statusPills = badgeOverride ? [{ label: badgeOverride, bg: badgeColor || '#fff', col: '#fff' }] : [];
  const genrePills  = badgeOverride ? [] : autoBadges;

  return (
    <button className={`${s.card}${isLive ? ' ' + s.cardLive : ''}${noHover ? ' ' + s.cardNoHover : ''}`} onClick={handleClick}>
      {poster
        ? <img className={s.cardImg} src={poster} alt={event.name} />
        : <div className={s.cardImgPH} />
      }
      <div className={s.cardOverlay} />
      {chip.dayNum && (
        <div style={{ position:'absolute', top:'50%', left:12, transform:'translateY(-50%)', background:'rgba(0,0,0,.65)', backdropFilter:'blur(4px)', borderRadius:10, padding:'6px 10px', textAlign:'center', minWidth:44, zIndex:2 }}>
          <div style={{ fontFamily:"'Bebas Neue'", fontSize:11, color:'rgba(255,255,255,.7)', letterSpacing:.5 }}>{chip.dayName}</div>
          <div style={{ fontFamily:"'Bebas Neue'", fontSize:22, color:'white', lineHeight:1 }}>{chip.dayNum}</div>
          <div style={{ fontFamily:"'Bebas Neue'", fontSize:11, color:'rgba(255,255,255,.7)', letterSpacing:.5 }}>{chip.mon}</div>
        </div>
      )}
      <div className={s.cardRow}>
        <div className={s.cardInfo} style={{ paddingLeft: chip.dayNum ? 77 : 12 }}>
          <div className={s.cardName}>{event.name}</div>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
            {venue && <span className={s.cardMeta}>{venue}</span>}
          </div>
        </div>
        {statusPills.length > 0 && (
          <div className={s.cardRight} style={{ display:'flex', gap:4, flexWrap:'wrap', justifyContent:'flex-end' }}>
            {statusPills.map(p => <Pill key={p.label} {...p} />)}
          </div>
        )}
      </div>
    </button>
  );
}
