import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ImageUploadButton from './ImageUploadButton';
import s from './AvatarUpload.module.css';

/**
 * Avatar upload block with Full view / Adjust crop / Remove buttons.
 * Props:
 *   userId, bucket, pathPrefix  — passed to ImageUploadButton
 *   avatar       current avatar URL (hero)
 *   ringClass    extra CSS class for the ring (colour theming per profile type)
 *   onUpload     ({ avatar_hero, avatar_thumb }) => void
 *   onRemove     () => void
 */
export default function AvatarUpload({ userId, bucket, pathPrefix, avatar, ringClass, onUpload, onRemove }) {
  const [cropMode,  setCropMode]  = useState(false);
  const [fullView,  setFullView]  = useState(false);
  const [pos,       setPos]       = useState({ x: 50, y: 50 });
  const frameRef  = useRef(null);
  const dragState = useRef(null);

  function startDrag(clientX, clientY) {
    const rect = frameRef.current.getBoundingClientRect();
    dragState.current = { startX: clientX, startY: clientY, startPX: pos.x, startPY: pos.y, w: rect.width, h: rect.height };
  }

  function onDragMove(clientX, clientY) {
    if (!dragState.current) return;
    const dx = ((clientX - dragState.current.startX) / dragState.current.w) * -100;
    const dy = ((clientY - dragState.current.startY) / dragState.current.h) * -100;
    setPos({
      x: Math.min(100, Math.max(0, dragState.current.startPX + dx)),
      y: Math.min(100, Math.max(0, dragState.current.startPY + dy)),
    });
  }

  return (
    <>
      <ImageUploadButton type="avatar" userId={userId} bucket={bucket} pathPrefix={pathPrefix} onUpload={result => { setPos({ x: 50, y: 50 }); setCropMode(false); onUpload(result); }}>
        {({ trigger, statusBadge }) => (
          <div className={s.block}>
            {/* Image frame */}
            <div
              ref={frameRef}
              className={`${s.ring} ${ringClass || ''}`}
              onClick={!avatar ? trigger : undefined}
              style={{ cursor: cropMode ? 'grab' : (avatar ? 'default' : 'pointer') }}
              onMouseDown={cropMode && avatar ? e => {
                e.preventDefault();
                startDrag(e.clientX, e.clientY);
                const onMove = mv => onDragMove(mv.clientX, mv.clientY);
                const onUp   = () => { dragState.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              } : undefined}
              onTouchStart={cropMode && avatar ? e => {
                const t = e.touches[0];
                startDrag(t.clientX, t.clientY);
                const onMove = mv => { const tc = mv.touches[0]; onDragMove(tc.clientX, tc.clientY); };
                const onUp   = () => { dragState.current = null; window.removeEventListener('touchmove', onMove); window.removeEventListener('touchend', onUp); };
                window.addEventListener('touchmove', onMove, { passive: true });
                window.addEventListener('touchend', onUp);
              } : undefined}
            >
              {avatar
                ? <img src={avatar} alt="" className={s.img} style={{ objectPosition: `${pos.x}% ${pos.y}%` }} />
                : <div className={s.ph}><span className={s.plus}>+</span>PHOTO</div>
              }
              {cropMode && (
                <div className={s.dragHint}>DRAG TO REPOSITION</div>
              )}
              {statusBadge}
            </div>

            {/* Action tabs */}
            {avatar ? (
              <div className={s.tabs}>
                <button type="button" className={s.tab} onClick={() => setFullView(true)}>Full view</button>
                <button type="button" className={`${s.tab} ${cropMode ? s.tabActive : ''}`} onClick={() => setCropMode(m => !m)}>Adjust crop</button>
                <button type="button" className={s.tabRemove} onClick={() => { setCropMode(false); setPos({ x: 50, y: 50 }); onRemove(); }}>Remove</button>
                <button type="button" className={s.tab} onClick={trigger}>Replace</button>
              </div>
            ) : (
              <div className={s.hint}>Tap to upload photo</div>
            )}
          </div>
        )}
      </ImageUploadButton>

      {/* Full view modal */}
      {fullView && createPortal(
        <div className={s.fullViewOverlay} onClick={() => setFullView(false)}>
          <img src={avatar} alt="" className={s.fullViewImg} />
        </div>,
        document.body,
      )}
    </>
  );
}
