import { useNavigate } from 'react-router-dom';
import s from './EventCard.module.css';
import { formatDisplayDate } from '../lib/dates';
import { getEventBadges, resolveCategoryBadge, OPEN_MIC_BADGE } from '../lib/eventBadges';
import DateBox from './DateBox';

/* The landscape date box's width. Referenced twice — by the box itself and by the text padding
   that must clear it — so it is a constant, not two numbers that have to agree.
   ⚠ 44, BECAUSE THAT IS THE BOX'S OWN DESIGN WIDTH (DateBox md: minWidth 44, border-box). This
   was briefly 64, picked to satisfy the padding maths without checking the shape it produced:
   at 64×62 the box rendered SQUARE, while every other date pill in the app is a tall rectangle
   — 44×62 here and 36×48 on the sm/Spotlight cards. Pinning must match the design, not set it. */
const DATE_BOX_W = 44;

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

/* Shared pill style matching WhatsOnScreen.
 *
 * ⚠ HALF-OPACITY FILL (owner, 2026-08-01: "make the pill border and background
 * about 50% opacity"). Done with color-mix, NOT a hex→rgba helper, because the
 * incoming `bg` is not one format: eventBadges.js mixes hex ('#BF5FFF') with
 * CSS custom properties ('var(--neon2)'), and a hex parser would silently drop
 * the latter to transparent.
 * The border is the same 50% colour. It still reads as an edge rather than
 * vanishing, because background-clip defaults to border-box — the border sits
 * OVER the fill, so the two 50% layers composite to ~75% right at the rim. */
function Pill({ label, bg, col }) {
  const half = `color-mix(in srgb, ${bg} 50%, transparent)`;
  return (
    <span style={{
      fontFamily: "'DM Sans', sans-serif",
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: .8,
      padding: '3px 8px',
      borderRadius: 6,
      background: half,
      border: `1px solid ${half}`,
      backdropFilter: 'blur(3px)',
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
 *   cornerAction – JSX pinned to the card's BOTTOM-RIGHT CORNER — the floor's
 *                  HeartBtn. Supported by the scroll variant AND the default
 *                  card variant (owner, 2026-08-01: the heart belongs in the
 *                  same corner in both views). Clicks inside must not open the
 *                  event, so the wrapper stops propagation.
 *                  ⚠ The default variant is a <button>, so there the heart is
 *                  rendered as a SIBLING in a relative wrapper, never nested.
 */
export default function EventCard({ event, badge: badgeOverride, badgeColor, onClick, variant, small = false, noHover = false, cornerAction = null }) {
  const navigate = useNavigate();
  const cfg    = event?.config || {};
  const poster = event?.poster_url || cfg.poster_thumb || cfg.poster || null;
  const date   = cfg.date  || '';
  const venue  = cfg.venue || '';
  const genres = cfg.genres || '';

  const manualBadge = cfg.categoryBadge ? [resolveCategoryBadge(cfg.categoryBadge)] : null;
  const autoBadges = getEventBadges(genres, event?.name || '');
  let pills = badgeOverride
    ? [{ label: badgeOverride, bg: badgeColor || '#fff', col: '#fff' }]
    : (manualBadge || autoBadges);
  if (!badgeOverride && cfg.openMicBadge && !pills.find(p => p.label === OPEN_MIC_BADGE.label)) {
    pills = [...pills, OPEN_MIC_BADGE];
  }

  const handleClick = onClick || (() => navigate(`/event/${event.id}`));

  // ── variant="scroll" ──
  if (variant === 'scroll' || small) {
    const chip = fmtChip(date);
    const venueShort = venue.split(',')[0];
    return (
      <div onClick={handleClick} style={{ flexShrink:0, width:195, borderRadius:16, overflow:'hidden', background:'var(--card2)', border:'1px solid rgba(255,255,255,.08)', cursor:'pointer', position:'relative' }}>
        <div style={{ height:120, background: poster ? `url('${poster}') center/cover no-repeat` : 'linear-gradient(135deg,rgba(255,45,120,.25),rgba(157,78,221,.25))', position:'relative' }}>
          {/* ⚠ THE RIGHT BOUND IS LOAD-BEARING. This row had `left:8` and no right edge, so on a
              195px card two pills ("LIVE MUSIC" + "OPEN MIC") grew straight under the date box
              at `right:8` and the two touched. Bounding it makes the row wrap instead of
              colliding; 52px clears the sm DateBox (~40px) with 8px to spare. */}
          {pills.length > 0 && (
            <div style={{ position:'absolute', top:8, left:8, right: chip.dayNum ? 52 : 8, display:'flex', gap:4, flexWrap:'wrap' }}>
              {pills.map(p => <Pill key={p.label} {...p} />)}
            </div>
          )}
          {chip.dayNum && (
            <div style={{ position:'absolute', top:8, right:8 }}>
              <DateBox date={date} size="sm" />
            </div>
          )}
        </div>
        {/* ⚠ The heart is a child of the CARD, not of the poster band — owner,
            2026-08-01: "put the heart down the bottom right corner". It used to
            sit at the poster's bottom-right, which is the card's MIDDLE once
            the text panel is counted, so it read as floating in the artwork
            rather than belonging to the card. The card gained position:relative
            for this; the text panel below reserves room so nothing runs under
            it. */}
        {cornerAction && (
          <div style={{ position:'absolute', bottom:8, right:8, zIndex:2 }} onClick={e => e.stopPropagation()}>
            {cornerAction}
          </div>
        )}
        <div style={{ padding: cornerAction ? '10px 46px 12px 12px' : '10px 12px 12px' }}>
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

  const cardEl = (
    <button className={`${s.card}${isLive ? ' ' + s.cardLive : ''}${noHover ? ' ' + s.cardNoHover : ''}`} onClick={handleClick}>
      {poster
        ? <img className={s.cardImg} src={poster} alt={event.name} />
        : <div className={s.cardImgPH} />
      }
      <div className={s.cardOverlay} />
      {genrePills.length > 0 && (
        <div style={{ position:'absolute', top:8, ...(statusPills.length > 0 ? { left:12 } : { right:12 }), display:'flex', gap:4, zIndex:2 }}>
          {genrePills.slice(0,1).map(p => <Pill key={p.label} {...p} />)}
        </div>
      )}
      {/* ⚠ THE BOX IS PINNED TO A FIXED WIDTH ON PURPOSE. `paddingLeft` below has to clear it,
          and the two numbers were independent: the box was free to grow with its content (a
          wider month, a fallback font when Bebas Neue has not loaded — which is exactly what a
          phone does on a cold start) while the padding stayed at 77, so the text ran into the
          pill. `display:grid` makes the box fill this 64px column instead of sizing to text, so
          the 12px gap below is now guaranteed rather than coincidental. */}
      {chip.dayNum && (
        <div style={{ position:'absolute', top:'50%', left:12, transform:'translateY(-50%)', zIndex:2, width:DATE_BOX_W, display:'grid', overflow:'hidden' }}>
          <DateBox date={date} size="md" />
        </div>
      )}
      <div className={s.cardRow}>
        <div className={s.cardInfo} style={{
          paddingLeft: chip.dayNum ? 12 + DATE_BOX_W + 12 : 12,
          // `.cardRight` is a flex sibling and already holds its own width, so reserving for it
          // here would count it twice. Only the corner heart needs room, because it is absolute
          // and therefore invisible to the flex row.
          paddingRight: statusPills.length > 0 ? 12 : (cornerAction ? 52 : 12),
        }}>
          {(() => {
            const sep = (event.name || '').match(/ [–\-] /);
            if (sep) {
              const idx = event.name.indexOf(sep[0]);
              return <>
                <div className={s.cardName}>{event.name.slice(0, idx)}</div>
                <div style={{ fontFamily:"'Bebas Neue'", fontSize:12, letterSpacing:.5, color:'rgba(255,255,255,.5)', marginBottom:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{event.name.slice(idx + sep[0].length)}</div>
              </>;
            }
            return <div className={s.cardName}>{event.name}</div>;
          })()}
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
            {venue && <span className={s.cardMeta}>{venue}</span>}
          </div>
        </div>
        {/* ⚠ With a heart present the pill moves to the TOP of the right
            column instead of staying vertically centred, so the two STACK
            (pill above, heart below) rather than fighting for the same corner
            — owner, 2026-08-01: "a heart in the bottom right UNDER the
            category pill". Centred + a bottom-right heart overlap on a 90px
            card; shifting the pill sideways instead would pull it off the
            right edge where it belongs. */}
        {statusPills.length > 0 && (
          <div className={s.cardRight} style={{ display:'flex', gap:4, flexWrap:'wrap', justifyContent:'flex-end', ...(cornerAction ? { alignSelf:'flex-start' } : null) }}>
            {statusPills.map(p => <Pill key={p.label} {...p} />)}
          </div>
        )}
      </div>
    </button>
  );

  if (!cornerAction) return cardEl;

  /* ⚠ THE HEART IS A SIBLING OF THE CARD, NOT A CHILD — and it has to be.
     This variant renders a <button>, so a HeartBtn inside it would be a button
     nested in a button: invalid HTML, and the inner one never reliably gets
     its own clicks. That is why cornerAction used to be scroll-variant-only.
     Wrapping in a relative div puts the heart on top without breaking the
     card's own button semantics. The wrapper is only introduced WHEN there is
     a cornerAction, so every other caller's DOM is byte-identical.
     statusPills above shift left by the heart's width so a SAVED pill and the
     heart never stack — they share the same corner otherwise. */
  return (
    <div style={{ position:'relative' }}>
      {cardEl}
      <div style={{ position:'absolute', bottom:10, right:10, zIndex:3 }} onClick={e => e.stopPropagation()}>
        {cornerAction}
      </div>
    </div>
  );
}
