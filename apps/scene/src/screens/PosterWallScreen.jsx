/**
 * POSTER WALL — My Scene's archive tense (memory project_poster_wall).
 *
 * Membership is DERIVED (lib/posterWall): participation always, follows of an
 * event only once it is past. There is no "add to wall" action anywhere on
 * this screen — curation is hide, move and resize only, and none of it
 * touches the underlying relationship records.
 *
 * The look is a physical wall: seeded rotations, real paper sizes, tape and
 * pins, post-it notes for events with no art, logo stickers from followed
 * acts. Seeds are deterministic per item, so the wall is the SAME wall every
 * visit and new posters join it instead of reshuffling it.
 */
import { useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../App';
import { today } from '../lib/dates';
import {
  buildWallItems, buildStickers, applyWallState, layoutWall,
  wallYears, inPeriod, wallStats, nextSize,
} from '../lib/posterWall';
import { fetchPosterWallData, POSTER_WALL_QUERY_KEY, loadWallState, saveWallState } from '../lib/posterWallData';
import s from './PosterWallScreen.module.css';

const MONTH_LABELS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const DRAG_THRESHOLD = 7;      // px before a press becomes a move
const LONG_PRESS_MS = 550;     // press-and-hold enters edit mode

export default function PosterWallScreen() {
  const { session } = useSession();
  const navigate = useNavigate();
  const uid = session?.user?.id;

  const { data } = useQuery({
    queryKey: POSTER_WALL_QUERY_KEY(uid),
    queryFn: () => fetchPosterWallData(uid),
    staleTime: 5 * 60 * 1000,
    enabled: !!uid,
  });

  const [wallState, setWallState] = useState(() => loadWallState(uid));
  useEffect(() => { setWallState(loadWallState(uid)); }, [uid]);
  const updateState = (fn) => setWallState(prev => {
    const next = fn(prev);
    saveWallState(uid, next);
    return next;
  });

  const [period, setPeriod] = useState(null);   // null | {year} | {year, month}
  const [editing, setEditing] = useState(false);

  const todayStr = useMemo(() => today(), []);
  const allItems = useMemo(() => {
    if (!data) return [];
    return [
      ...buildWallItems({ ...data, todayStr }),
      ...buildStickers(data),
    ];
  }, [data, todayStr]);

  const visible = useMemo(
    () => applyWallState(allItems, wallState).filter(it => inPeriod(it, period)),
    [allItems, wallState, period],
  );

  const wallRef = useRef(null);
  const [wallWidth, setWallWidth] = useState(0);
  useEffect(() => {
    const el = wallRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWallWidth(el.clientWidth));
    ro.observe(el);
    setWallWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const { items: placed, height } = useMemo(
    () => layoutWall(visible, wallWidth || 360),
    [visible, wallWidth],
  );

  const stats = useMemo(() => wallStats(visible), [visible]);
  const years = useMemo(() => wallYears(allItems), [allItems]);
  const monthsInYear = useMemo(() => {
    if (!period?.year) return [];
    const ms = new Set(allItems.filter(it => it.date?.slice(0, 4) === period.year).map(it => it.date.slice(5, 7)));
    return [...ms].sort();
  }, [allItems, period?.year]);

  /* ── One pointer interaction handler per item ─────────────────────────
     tap (view mode)        open the event / profile
     long press (view mode) enter edit mode
     tap (edit, poster)     step the size A5 → A4 → A3
     drag (edit)            move; stored as a per-user override on release */
  const drag = useRef(null);
  const [dragging, setDragging] = useState(null); // {id, x, y} while moving

  function onItemPointerDown(e, item) {
    if (e.button != null && e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    let longPressFired = false;
    const timer = !editing ? setTimeout(() => {
      longPressFired = true;
      setEditing(true);
      if (navigator.vibrate) navigator.vibrate(20);
    }, LONG_PRESS_MS) : null;
    drag.current = { item, start, timer, moved: false, longPressFired: () => longPressFired };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onItemPointerMove(e, placedItem) {
    const d = drag.current;
    if (!d || d.item.id !== placedItem.id) return;
    const dx = e.clientX - d.start.x;
    const dy = e.clientY - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    if (d.timer) clearTimeout(d.timer);
    if (!editing) return;                 // in view mode a move is just a scroll
    e.preventDefault();
    const maxX = Math.max(0, (wallWidth || 360) - placedItem.w);
    setDragging({
      id: placedItem.id,
      x: Math.min(Math.max(0, placedItem.x + dx), maxX),
      y: Math.max(0, placedItem.y + dy),
    });
  }

  function onItemPointerUp(e, placedItem) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.item.id !== placedItem.id) { setDragging(null); return; }
    if (d.timer) clearTimeout(d.timer);

    if (editing && d.moved && dragging?.id === placedItem.id) {
      const { x, y } = dragging;
      updateState(prev => ({ ...prev, pos: { ...prev.pos, [placedItem.id]: { x, y } } }));
      setDragging(null);
      return;
    }
    setDragging(null);
    if (d.moved || d.longPressFired()) return;

    if (editing) {
      // Sizes step through real paper only, and only posters step — post-its
      // and stickers keep their one physical size.
      if (placedItem.kind === 'poster') {
        const cur = placedItem.sizeOverride || placedItem.seed.size;
        updateState(prev => ({ ...prev, size: { ...prev.size, [placedItem.id]: nextSize(cur) } }));
      }
      return;
    }
    if (placedItem.kind === 'sticker') navigate(`/profile/${placedItem.profileId}`);
    else navigate(`/event/${placedItem.id}`);
  }

  function hideItem(id) {
    updateState(prev => ({ ...prev, hidden: [...prev.hidden, id] }));
  }

  /* ── Year recap — the wall as a downloadable image ──────────────────── */
  async function downloadRecap() {
    if (!period?.year) return;
    const items = placed.filter(p => p.kind !== 'sticker');
    const SCALE = 2;
    const W = (wallWidth || 360) * SCALE;
    const H = Math.min(height, 1400) * SCALE + 220 * SCALE;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1c150f';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#efe7da';
    ctx.font = `${34 * SCALE}px 'Bebas Neue', sans-serif`;
    ctx.fillText(`POSTER WALL ${period.year}`, 16 * SCALE, 44 * SCALE);
    ctx.fillStyle = '#b09ecf';
    ctx.font = `${11 * SCALE}px 'DM Sans', sans-serif`;
    ctx.fillText('THE SCENE YOU WERE PART OF · YESPLEEZ', 16 * SCALE, 62 * SCALE);

    const top = 80 * SCALE;
    const loads = items.map(p => new Promise(resolve => {
      const draw = (img) => {
        ctx.save();
        ctx.translate((p.x + p.w / 2) * SCALE, top + (p.y + p.h / 2) * SCALE);
        ctx.rotate((p.seed.rot * Math.PI) / 180);
        if (img) {
          ctx.drawImage(img, (-p.w / 2) * SCALE, (-p.h / 2) * SCALE, p.w * SCALE, p.h * SCALE);
        } else {
          ctx.fillStyle = p.kind === 'note' ? '#e8d75c' : '#2e2620';
          ctx.fillRect((-p.w / 2) * SCALE, (-p.h / 2) * SCALE, p.w * SCALE, p.h * SCALE);
          ctx.fillStyle = p.kind === 'note' ? '#33290a' : '#cfc6b8';
          ctx.font = `${13 * SCALE}px 'Bebas Neue', sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(String(p.name).slice(0, 18), 0, 0);
          ctx.textAlign = 'start';
        }
        ctx.restore();
        resolve();
      };
      if (!p.img) return draw(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => draw(img);
      img.onerror = () => draw(null);
      img.src = p.img;
    }));
    await Promise.all(loads);

    const st = wallStats(placed);
    ctx.fillStyle = 'rgba(0,0,0,.7)';
    ctx.fillRect(0, H - 96 * SCALE, W, 96 * SCALE);
    ctx.fillStyle = '#efe7da';
    ctx.font = `${18 * SCALE}px 'Bebas Neue', sans-serif`;
    ctx.fillText(
      `${st.posters} POSTERS · ${st.venues} VENUES · ${st.festivals} FESTIVALS`,
      16 * SCALE, H - 40 * SCALE,
    );

    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `yespleez-poster-wall-${period.year}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  }

  return (
    <div className={s.screen}>
      <div className={s.header}>
        <div className={s.headerRow}>
          <div>
            <h1 className={s.title}>POSTER WALL</h1>
            <div className={s.subtitle}>The scene you&rsquo;ve been part of</div>
          </div>
          {stats.posters > 0 && (
            <div className={s.stats}>
              <div><b>{stats.posters}</b>POSTERS</div>
              <div><b>{stats.venues}</b>VENUES</div>
              <div><b>{stats.festivals}</b>FESTIVALS</div>
            </div>
          )}
        </div>
      </div>

      <div className={s.controls}>
        <button className={`yp-tap44 ${s.chip} ${!period ? s.chipActive : ''}`} onClick={() => setPeriod(null)}>ALL</button>
        {years.map(y => (
          <button key={y}
            className={`yp-tap44 ${s.chip} ${period?.year === y && !period?.month ? s.chipActive : ''}`}
            onClick={() => setPeriod(period?.year === y && !period?.month ? null : { year: y })}>
            {y}
          </button>
        ))}
        {period?.year && monthsInYear.length > 1 && monthsInYear.map(m => (
          <button key={m}
            className={`yp-tap44 ${s.chip} ${period?.month === m ? s.chipActive : ''}`}
            onClick={() => setPeriod(period.month === m ? { year: period.year } : { year: period.year, month: m })}>
            {MONTH_LABELS[Number(m) - 1]}
          </button>
        ))}
        {period?.year && !period.month && placed.some(p => p.kind !== 'sticker') && (
          <button className={`yp-tap44 ${s.chip}`} onClick={downloadRecap}>RECAP ↓</button>
        )}
        <button
          className={`yp-tap44 ${s.chip} ${s.chipEdit} ${editing ? s.chipEditActive : ''}`}
          onClick={() => setEditing(v => !v)}>
          {editing ? 'DONE' : 'EDIT WALL'}
        </button>
      </div>

      {editing && (
        <div className={s.editHint}>
          Drag to move. Tap a poster to change its size. The cross takes it off your wall.
        </div>
      )}

      <div ref={wallRef} className={s.wall} style={{ height: Math.max(height, 420) }}>
        {placed.length === 0 && (
          <div className={s.emptyOverlay}>
            <div className={s.emptyTitle}>YOUR WALL IS EMPTY, FOR NOW</div>
            <div className={s.emptyBody}>
              Every event you&rsquo;re part of leaves its poster here. Follow acts
              and their stickers turn up too. The wall builds itself as you go.
            </div>
          </div>
        )}
        {placed.map(p => {
          const isDrag = dragging?.id === p.id;
          const x = isDrag ? dragging.x : p.x;
          const y = isDrag ? dragging.y : p.y;
          return (
            <div key={p.id}
              className={`${s.item} ${isDrag ? s.itemDragging : ''}`}
              style={{
                left: x, top: y, width: p.w, height: p.h, zIndex: p.z,
                transform: `rotate(${p.seed.rot}deg)`,
                touchAction: editing ? 'none' : 'manipulation',
              }}
              onPointerDown={(e) => onItemPointerDown(e, p)}
              onPointerMove={(e) => onItemPointerMove(e, p)}
              onPointerUp={(e) => onItemPointerUp(e, p)}
              onPointerCancel={() => { if (drag.current?.timer) clearTimeout(drag.current.timer); drag.current = null; setDragging(null); }}
              role="button"
              aria-label={p.kind === 'sticker' ? `${p.name} sticker` : `${p.name} poster, open event`}
            >
              {p.kind === 'poster' && (
                <img className={s.poster} src={p.img} alt={`${p.name} poster`} draggable={false} />
              )}
              {p.kind === 'note' && (
                <div className={s.note}>
                  <div className={s.noteName}>{p.name}</div>
                  {p.date && <div className={s.noteMeta}>{p.date}</div>}
                  {p.venue && <div className={s.noteMeta}>{p.venue}</div>}
                </div>
              )}
              {p.kind === 'sticker' && (
                <img className={s.sticker} src={p.img} alt={`${p.name} logo sticker`} draggable={false} />
              )}
              {/* dressing: pin on odd seeds, tape strips on even */}
              {p.kind !== 'sticker' && (p.seed.tape % 2 === 1
                ? <div className={s.pin} />
                : <>
                    <div className={s.tape} style={{ top: -7, left: -14, transform: 'rotate(-38deg)' }} />
                    <div className={s.tape} style={{ top: -7, right: -14, transform: 'rotate(38deg)' }} />
                  </>
              )}
              {editing && (
                <button className={s.removeBtn}
                  aria-label={`Take ${p.name} off your wall`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); hideItem(p.id); }}>
                  ✕
                </button>
              )}
              {editing && p.kind === 'poster' && (
                <div className={s.sizeBadge}>{(p.sizeOverride || p.seed.size).toUpperCase()}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
