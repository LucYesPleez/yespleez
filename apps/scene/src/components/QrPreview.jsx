import { useEffect, useMemo, useRef, useState } from 'react';
import { encodeQR } from '../lib/qr/qrEncode';
import { toPathData, symbolSpan, PAPER, INK } from '../lib/qr/qrRender';
import { renderPoster } from '../lib/qr/qrPosterCanvas';
import { PAGE_SIZES, DEFAULT_PAGE } from '../lib/qr/qrPdf';

/**
 * THE POSTER, AS IT WILL PRINT.
 *
 * ⭐⭐ NOT A LOOKALIKE — THE SAME LAYOUT. This draws `qrPosterLayout`'s output
 * through the canvas backend, which is the identical list of shapes `qrPdf`
 * turns into PDF operators. There is no second implementation of the design to
 * drift, so what somebody approves here is what comes out of the printer.
 *
 * ⚠ It was a CSS approximation until 2026-08-21 and it had already drifted: the
 * headline sized by counting characters rather than measuring the face, so the
 * proof showed type a fifth smaller than it printed.
 *
 * ⛔ THE CODE IS NEVER INVERTED. Cream on black would suit the poster and is out
 * of spec; a good share of phone cameras refuse it. The white plate is how the
 * design keeps a dark poster and a legal symbol at once, and its padding IS the
 * quiet zone — ⛔ never tint it, never crop it tighter.
 */
export default function QrPreview({
  url,
  title,
  kicker,
  footer = 'SCAN OR GO TO YESPLEEZ.COM',
  /** 'poster' for the full proof, 'chip' for a list row. */
  variant = 'poster',
  size,
  pageSize = DEFAULT_PAGE,
  ecl = 'Q',
}) {
  const canvasRef = useRef(null);
  const [state, setState] = useState('loading');

  const page = PAGE_SIZES[pageSize] || PAGE_SIZES[DEFAULT_PAGE];
  const width = size || 320;

  /* The chip is the bare symbol: a list row wants to be scannable at a glance,
     not a poster the size of a thumbnail. */
  const chipSymbol = useMemo(() => {
    if (variant !== 'chip' || !url) return null;
    try { return encodeQR(url, ecl); } catch { return null; }
  }, [variant, url, ecl]);

  useEffect(() => {
    if (variant === 'chip' || !url) return undefined;
    let cancelled = false;
    setState('loading');
    /* ⚠ Twice the CSS width, so the proof is sharp on a phone's 2x screen and
       the grain reads as texture rather than as mud. */
    renderPoster({ url, title, kicker, footer, ecl }, page, width * 2)
      .then(({ canvas }) => {
        if (cancelled || !canvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        canvasRef.current.width = canvas.width;
        canvasRef.current.height = canvas.height;
        ctx.drawImage(canvas, 0, 0);
        setState('ready');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [variant, url, title, kicker, footer, ecl, page, width]);

  if (variant === 'chip') {
    if (!chipSymbol) {
      return (
        <div style={{
          width: size || 56, height: size || 56, borderRadius: 8, flexShrink: 0,
          background: 'rgba(255,255,255,.05)', border: '1px dashed var(--border)',
        }} />
      );
    }
    const span = symbolSpan(chipSymbol);
    return (
      <div style={{ width: size || 56, height: size || 56, flexShrink: 0, borderRadius: 6, overflow: 'hidden' }}>
        <svg viewBox={`0 0 ${span} ${span}`} width="100%" height="100%" shapeRendering="crispEdges"
          role="img" aria-label={`QR code for ${title || url}`} style={{ display: 'block' }}>
          <rect width={span} height={span} fill={PAPER} />
          <path fill={INK} d={toPathData(chipSymbol)} />
        </svg>
      </div>
    );
  }

  /* ⚠ RENDERING CONTRACT. Nothing to encode, and a payload too long to encode,
     are different real states and both say so. ⛔ Neither is a blank box, which
     reads as a loading failure. */
  if (!url || state === 'error') {
    return (
      <div style={{
        width, maxWidth: '100%', aspectRatio: `${page.w} / ${page.h}`,
        borderRadius: 10, background: 'rgba(255,255,255,.05)',
        border: '1px dashed var(--border)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: 'var(--muted)', fontSize: 12, textAlign: 'center', padding: 12,
      }}>
        {url ? 'Too long to fit in a QR code' : 'Choose a destination'}
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`${pageSize} poster for ${title || url}`}
      style={{
        width, maxWidth: '100%', aspectRatio: `${page.w} / ${page.h}`, height: 'auto',
        display: 'block', borderRadius: 10, background: '#000',
        border: '1px solid rgba(255,255,255,.10)',
        opacity: state === 'ready' ? 1 : 0.35,
        transition: 'opacity .18s',
      }}
    />
  );
}
