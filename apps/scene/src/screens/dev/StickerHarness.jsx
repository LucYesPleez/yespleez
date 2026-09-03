// DEV ONLY — the sticker effects harness.
//
// Route: /#/dev/stickers   (the app uses HashRouter)
//
// ⭐⭐ THIS EXISTS BECAUSE THE EFFECTS CANNOT BE JUDGED FROM CODE OR FROM
// NUMBERS. Every earlier round was iterated by injecting a throwaway preview
// into whatever page happened to be open, measuring pixel statistics, and
// arguing about them — and the statistics kept saying "better" while the
// stickers looked worse. Solidity, hole counts and contour jumps do not
// measure whether a thing reads as a sticker.
//
// So: every effect, on the artwork that matters, against the backgrounds it
// will really sit on, at the sizes it will really be seen at, with the one
// parameter that governs the look on a slider. ⛔ Not routed in production.
//
// ⚠ DROP YOUR OWN LOGO IN. The bundled marks are convenient but they are all
// the same kind of artwork — white line art. A coloured logo, a dense one and
// a wordmark all behave differently, and the file input is the only way to
// find that out before an artist does.

import { useEffect, useRef, useState } from 'react';
import {
  STICKER_EFFECTS, renderSticker, loadStickerImage, hasAlpha,
} from '../../lib/stickerEffects';

/* The app's own marks — enough to see the difference between a fine line
   drawing and a heavier one without leaving the page. */
const BUNDLED = [
  { label: 'HAND MARK',  url: '/hand-mark.png'  },
  { label: 'HAND LOGO',  url: '/hand-logo.png'  },
  { label: 'HAND ICON',  url: '/hand-icon.png'  },
  { label: 'APP ICON',   url: '/icon-512.png'   },
];

/* ⚠ THE BACKGROUNDS ARE NOT DECORATION. An outline that is invisible on white
   and perfect on dark is a broken outline, and a sticker is saved to a phone
   whose background nobody controls. The chequer is what a transparent PNG
   actually looks like in a file browser. */
const CHEQUER = {
  backgroundColor: '#8b8b96',
  backgroundImage:
    'linear-gradient(45deg,#6f6f7a 25%,transparent 25%),' +
    'linear-gradient(-45deg,#6f6f7a 25%,transparent 25%),' +
    'linear-gradient(45deg,transparent 75%,#6f6f7a 75%),' +
    'linear-gradient(-45deg,transparent 75%,#6f6f7a 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
};

const BACKGROUNDS = [
  { label: 'app dark', style: { background: '#1a1a24' } },
  { label: 'white',    style: { background: '#ffffff' } },
  { label: 'brand',    style: { background: '#FF2D78' } },
  { label: 'photo',    style: { background: 'linear-gradient(135deg,#4a5568,#a0aec0 40%,#2d3748)' } },
  { label: 'chequer',  style: CHEQUER },
];

/* The three sizes that actually occur. ⚠ The shelf tile is 84px — an effect
   that only works at 200px is not shipped, it is just untested. */
const SIZES = [
  { label: 'SHELF TILE 84', display: 84,  render: 220  },
  { label: 'PICKER 56',     display: 56,  render: 160  },
  { label: 'SAVED 1024',    display: 180, render: 1024 },
];

export default function StickerHarness() {
  const [src, setSrc]           = useState(BUNDLED[0].url);
  const [srcLabel, setSrcLabel] = useState(BUNDLED[0].label);
  const [padScale, setPadScale] = useState(1);
  const [sizeIdx, setSizeIdx]   = useState(0);
  const [img, setImg]           = useState(null);
  const [gate, setGate]         = useState(null);
  const [err, setErr]           = useState('');

  useEffect(() => {
    let alive = true;
    setErr('');
    loadStickerImage(src).then(loaded => {
      if (!alive) return;
      setImg(loaded);

      // The alpha gate, reported rather than silently applied — the whole
      // point of a harness is that nothing is hidden.
      const c = document.createElement('canvas');
      c.width = loaded.naturalWidth; c.height = loaded.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(loaded, 0, 0);
      try {
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        setGate({ ok: hasAlpha(d), w: c.width, h: c.height });
      } catch {
        setGate({ ok: null, w: c.width, h: c.height });
      }
    }).catch(() => {
      if (alive) { setImg(null); setErr('That image could not be loaded.'); }
    });
    return () => { alive = false; };
  }, [src]);

  function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setSrc(URL.createObjectURL(f));
    setSrcLabel(f.name);
  }

  const size = SIZES[sizeIdx];

  return (
    <div style={{
      minHeight: '100vh', background: '#0f0f16', color: '#f0f0f0',
      padding: '18px 20px 60px', fontFamily: 'system-ui, sans-serif',
    }}>
      <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 400, fontSize: 26, letterSpacing: '.08em', margin: '0 0 4px' }}>
        STICKER EFFECTS
      </h1>
      <p style={{ margin: '0 0 18px', fontSize: 12, color: '#8a8a96' }}>
        Every effect, every background, at the sizes they are really seen.
      </p>

      <Row label="ARTWORK">
        {BUNDLED.map(b => (
          <Chip key={b.url} on={src === b.url} onClick={() => { setSrc(b.url); setSrcLabel(b.label); }}>
            {b.label}
          </Chip>
        ))}
        <label style={{ ...chipStyle(false), cursor: 'pointer' }}>
          UPLOAD YOUR OWN
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
        </label>
      </Row>

      <Row label="SIZE">
        {SIZES.map((s, i) => (
          <Chip key={s.label} on={i === sizeIdx} onClick={() => setSizeIdx(i)}>{s.label}</Chip>
        ))}
      </Row>

      <Row label="BAND">
        <input
          type="range" min="0" max="3" step="0.05"
          value={padScale}
          onChange={e => setPadScale(Number(e.target.value))}
          style={{ width: 260 }}
        />
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#00E5FF', minWidth: 130 }}>
          ×{padScale.toFixed(2)}
          {' · outline '}{(0.06 * padScale).toFixed(3)}
          {' · puffy '}{(0.10 * padScale).toFixed(3)}
        </span>
        <Chip on={false} onClick={() => setPadScale(1)}>RESET</Chip>
      </Row>

      <div style={{ fontSize: 11.5, color: '#8a8a96', margin: '4px 0 16px' }}>
        {srcLabel}
        {gate && ` · ${gate.w}×${gate.h}`}
        {gate && gate.ok === false && (
          <b style={{ color: '#FFB830' }}>{'  ·  NO TRANSPARENCY — effects will trace a rectangle'}</b>
        )}
        {gate && gate.ok === null && (
          <b style={{ color: '#FF4D6A' }}>{'  ·  tainted canvas, alpha unknown'}</b>
        )}
        {err && <b style={{ color: '#FF4D6A' }}>{'  ·  ' + err}</b>}
      </div>

      {/* The grid. Effects across, backgrounds down — so one effect can be
          judged against every surface by reading a single column. */}
      <div style={{ display: 'grid', gridTemplateColumns: `120px repeat(${STICKER_EFFECTS.length}, auto)`, gap: 10, alignItems: 'center' }}>
        <div />
        {STICKER_EFFECTS.map(e => (
          <div key={e.key} style={{
            fontFamily: "'Bebas Neue'", fontSize: 13, letterSpacing: '.1em',
            color: '#f0f0f0', textAlign: 'center',
          }}>{e.label}</div>
        ))}

        {BACKGROUNDS.map(bg => (
          <Cells key={bg.label} bg={bg} img={img} size={size} padScale={padScale} />
        ))}
      </div>

      <p style={{ marginTop: 26, fontSize: 11.5, color: '#5A5A66', maxWidth: 680, lineHeight: 1.6 }}>
        The band slider is a harness-only override. Whatever value settles here belongs
        back in <code>STICKER_EFFECTS.pad</code> in lib/stickerEffects — nothing in the
        product passes <code>padScale</code>.
      </p>
    </div>
  );
}

function Cells({ bg, img, size, padScale }) {
  return (
    <>
      <div style={{ fontSize: 11, color: '#8a8a96', textAlign: 'right', paddingRight: 4 }}>{bg.label}</div>
      {STICKER_EFFECTS.map(e => (
        <div key={e.key} style={{
          ...bg.style, borderRadius: 12, padding: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minWidth: size.display + 24, minHeight: size.display + 24,
        }}>
          <StickerCanvas img={img} effect={e.key} size={size} padScale={padScale} />
        </div>
      ))}
    </>
  );
}

/**
 * ⚠ RENDERED, NOT CSS-FILTERED. The harness has to composite exactly the way
 * the shelf and the download do, or it is a preview of something that does not
 * exist.
 */
function StickerCanvas({ img, effect, size, padScale }) {
  const host = useRef(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.innerHTML = '';
    setNote('');
    if (!img) return;
    try {
      const c = renderSticker(img, effect, { size: size.render, padScale });
      c.style.cssText = `max-width:${size.display}px;max-height:${size.display}px;width:auto;height:auto;display:block`;
      el.appendChild(c);
      setNote(`${c.width}px`);
    } catch {
      setNote('failed');
    }
  }, [img, effect, size, padScale]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div ref={host} />
      <span style={{ fontSize: 9, color: 'rgba(128,128,140,.75)', fontFamily: 'monospace' }}>{note}</span>
    </div>
  );
}

/* ── controls ──────────────────────────────────────────────────────── */

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 }}>
      <span style={{
        fontFamily: "'Bebas Neue'", fontSize: 10, letterSpacing: '.14em',
        color: 'rgba(255,255,255,.32)', minWidth: 70,
      }}>{label}</span>
      {children}
    </div>
  );
}

function chipStyle(on) {
  return {
    fontFamily: "'Bebas Neue'", fontSize: 10.5, letterSpacing: '.11em',
    padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${on ? 'rgba(0,229,255,.45)' : 'rgba(255,255,255,.12)'}`,
    background: on ? 'rgba(0,229,255,.10)' : 'transparent',
    color: on ? '#00E5FF' : '#8a8a96',
  };
}

function Chip({ on, onClick, children }) {
  return <button type="button" onClick={onClick} style={chipStyle(on)}>{children}</button>;
}
