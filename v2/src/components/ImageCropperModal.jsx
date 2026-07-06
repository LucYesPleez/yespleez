import { useState, useEffect, useRef } from 'react';
import s from './ImageCropperModal.module.css';
import { canvasToBlob } from '../lib/imageUtils';

// aspect = width/height (e.g. 1 for square, 0.8 for 4:5)
// correctedCanvas = the EXIF-corrected source canvas
export default function ImageCropperModal({ correctedCanvas, aspect, onDone, onCancel }) {
  const pointers   = useRef(new Map());
  const wrapRef    = useRef(null);

  // Crop display size — fits the screen
  const CROP_W = Math.min(window.innerWidth - 32, 380);
  const CROP_H = Math.round(CROP_W / aspect);

  const natW = correctedCanvas.width;
  const natH = correctedCanvas.height;
  // base scale: minimum to cover the crop box
  const baseScale = Math.max(CROP_W / natW, CROP_H / natH);

  const [userScale, setUserScale] = useState(1);
  const [offset,    setOffset]    = useState({ x: 0, y: 0 });
  const [imgSrc,    setImgSrc]    = useState('');

  useEffect(() => {
    let objUrl = '';
    correctedCanvas.toBlob(blob => {
      objUrl = URL.createObjectURL(blob);
      setImgSrc(objUrl);
    }, 'image/jpeg', 0.9);
    return () => { if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [correctedCanvas]);

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function constrain(ox, oy, us) {
    const totalScale = baseScale * us;
    const imgW = natW * totalScale;
    const imgH = natH * totalScale;
    const maxX = Math.max(0, (imgW - CROP_W) / 2);
    const maxY = Math.max(0, (imgH - CROP_H) / 2);
    return { x: clamp(ox, -maxX, maxX), y: clamp(oy, -maxY, maxY) };
  }

  // --- pointer events ---
  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId);
    const curr = { x: e.clientX, y: e.clientY };

    if (pointers.current.size === 1) {
      setOffset(o => constrain(o.x + curr.x - prev.x, o.y + curr.y - prev.y, userScale));
    } else if (pointers.current.size === 2) {
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (other) {
        const prevDist = Math.hypot(prev.x - other.x, prev.y - other.y);
        const currDist = Math.hypot(curr.x - other.x, curr.y - other.y);
        if (prevDist > 1) {
          setUserScale(us => {
            const next = Math.max(1, Math.min(5, us * (currDist / prevDist)));
            setOffset(o => constrain(o.x, o.y, next));
            return next;
          });
        }
      }
    }
    pointers.current.set(e.pointerId, curr);
  }

  function onPointerUp(e) { pointers.current.delete(e.pointerId); }

  function onWheel(e) {
    e.preventDefault();
    setUserScale(us => {
      const next = Math.max(1, Math.min(5, us * (e.deltaY < 0 ? 1.08 : 0.93)));
      setOffset(o => constrain(o.x, o.y, next));
      return next;
    });
  }

  // --- extract crop ---
  function handleDone() {
    const totalScale = baseScale * userScale;
    const imgW = natW * totalScale;
    const imgH = natH * totalScale;
    const imgLeft = CROP_W / 2 + offset.x - imgW / 2;
    const imgTop  = CROP_H / 2 + offset.y - imgH / 2;

    // Source rectangle in corrected canvas coordinates
    const srcX = -imgLeft / totalScale;
    const srcY = -imgTop  / totalScale;
    const srcW =  CROP_W  / totalScale;
    const srcH =  CROP_H  / totalScale;

    // Output at 1200px on the long axis (poster) or 1600px (square avatar)
    const outW = aspect >= 1 ? 1600 : 1200;
    const outH = Math.round(outW / aspect);

    const out = document.createElement('canvas');
    out.width  = outW;
    out.height = outH;
    out.getContext('2d').drawImage(correctedCanvas, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

    canvasToBlob(out, 0.85).then(({ blob }) => onDone(out, blob));
  }

  const totalScale   = baseScale * userScale;
  const imgDisplayW  = natW * totalScale;
  const imgDisplayH  = natH * totalScale;
  const imgLeft      = CROP_W / 2 + offset.x - imgDisplayW / 2;
  const imgTop       = CROP_H / 2 + offset.y - imgDisplayH / 2;

  // Quality: how many source pixels are in the current crop area
  const srcPixels    = (CROP_W / totalScale) * (CROP_H / totalScale);
  const outW         = aspect >= 1 ? 400 : 1200;
  const outH         = Math.round(outW / aspect);
  const outPixels    = outW * outH;
  const ratio        = srcPixels / outPixels;
  const quality      = ratio >= 4 ? { label: 'Excellent', color: '#00E5A0', icon: '✓' }
                     : ratio >= 1 ? { label: 'Good',      color: '#7BC8F6', icon: '✓' }
                     :              { label: 'Fair — may look blurry', color: '#FFB830', icon: '⚠' };

  const aspectLabel  = aspect >= 1 ? '1 : 1' : '4 : 5';

  return (
    <div className={s.overlay}>
      {/* Aspect ratio badge */}
      <div className={s.aspectBadge}>
        <span className={s.aspectIcon}>⬚</span>
        <span>{aspectLabel}</span>
        <span className={s.aspectLock}>locked</span>
      </div>

      {/* Crop box */}
      <div
        ref={wrapRef}
        className={s.cropWrap}
        style={{ width: CROP_W, height: CROP_H }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {imgSrc && (
          <img
            className={s.cropImg}
            src={imgSrc}
            alt=""
            draggable={false}
            style={{ width: imgDisplayW, height: imgDisplayH, left: imgLeft, top: imgTop }}
          />
        )}

        {/* Rule-of-thirds grid */}
        <div className={s.grid}>
          <div className={s.gridH} style={{ top: '33.33%' }} />
          <div className={s.gridH} style={{ top: '66.66%' }} />
          <div className={s.gridV} style={{ left: '33.33%' }} />
          <div className={s.gridV} style={{ left: '66.66%' }} />
          <div className={s.cornerTL} /><div className={s.cornerTR} />
          <div className={s.cornerBL} /><div className={s.cornerBR} />
        </div>
      </div>

      {/* Quality score */}
      <div className={s.quality}>
        <span className={s.qualityIcon} style={{ color: quality.color }}>{quality.icon}</span>
        <span className={s.qualityLabel} style={{ color: quality.color }}>{quality.label}</span>
      </div>

      <p className={s.hint}>Drag to reposition · pinch or scroll to zoom</p>

      <div className={s.buttons}>
        <button className={s.btnCancel} onClick={onCancel}>CANCEL</button>
        <button className={s.btnDone}   onClick={handleDone}>USE PHOTO</button>
      </div>
    </div>
  );
}
