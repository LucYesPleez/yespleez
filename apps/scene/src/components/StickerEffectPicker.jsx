/**
 * STICKER EFFECT PICKER — choose the look, on the artwork it will apply to.
 * ---------------------------------------------------------------------------
 * ⭐ EVERY OPTION IS THE ARTIST'S OWN LOGO, rendered. Not a swatch, not an
 * icon, not a word: the effects differ enormously between one logo and the
 * next — a dark mark gets a white band, a light one gets a dark band, line art
 * fills solid — so a generic preview would be a picture of a decision the
 * artist is not actually making.
 *
 * ⛔⛔ THE ALPHA GATE IS A REAL GATE. Every effect keys off the silhouette in
 * the artwork's transparency. A flat export has none, so the effects would
 * trace a rectangle and the artist would reasonably conclude the feature is
 * broken. When there is no alpha the options are withheld and the reason is
 * given — absent with a reason, never a row of identical broken thumbnails.
 *
 * ⚠ RENDERING IS ASYNC AND CAN FAIL. Loading is a state, and so is "could not
 * read that image" — a canvas tainted by a cross-origin fetch without CORS
 * throws on getImageData, and silently showing nothing would look identical to
 * a logo with no effects available.
 */

import { useEffect, useRef, useState } from 'react';
import {
  STICKER_EFFECTS, DEFAULT_STICKER_EFFECT,
  renderSticker, loadStickerImage, hasAlpha,
} from '../lib/stickerEffects';

const PREVIEW = 132;   // the rendered size; the tile displays smaller

export default function StickerEffectPicker({ url, value, onChange, busy = false }) {
  const [state, setState] = useState({ status: 'loading', previews: {}, reason: null });
  const boxRef = useRef(null);

  useEffect(() => {
    let alive = true;
    if (!url) { setState({ status: 'idle', previews: {}, reason: null }); return; }

    setState({ status: 'loading', previews: {}, reason: null });

    (async () => {
      try {
        const img = await loadStickerImage(url);
        if (!alive) return;

        /* The gate, checked once on the source rather than per option — the
           answer cannot differ between effects. */
        const probe = document.createElement('canvas');
        probe.width = img.naturalWidth; probe.height = img.naturalHeight;
        probe.getContext('2d').drawImage(img, 0, 0);
        const data = probe.getContext('2d')
          .getImageData(0, 0, probe.width, probe.height).data;

        if (!hasAlpha(data)) {
          setState({
            status: 'no-alpha', previews: {},
            reason: 'This image has no transparent background, so there is no shape to outline. Upload a PNG with the background removed to use effects.',
          });
          return;
        }

        const previews = {};
        for (const eff of STICKER_EFFECTS) {
          previews[eff.key] = renderSticker(img, eff.key, { size: PREVIEW }).toDataURL('image/png');
        }
        if (alive) setState({ status: 'ready', previews, reason: null });
      } catch {
        if (alive) {
          setState({
            status: 'error', previews: {},
            reason: 'That image could not be read, so effects are unavailable.',
          });
        }
      }
    })();

    return () => { alive = false; };
  }, [url]);

  if (!url || state.status === 'idle') return null;

  const current = value || DEFAULT_STICKER_EFFECT;

  return (
    <div style={{ marginTop: 10 }} ref={boxRef}>
      <div style={{
        fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.1,
        color: 'var(--faint, #5A5A66)', marginBottom: 7,
      }}>
        STICKER EFFECT
      </div>

      {state.status === 'loading' && (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Rendering previews…</div>
      )}

      {(state.status === 'no-alpha' || state.status === 'error') && (
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45, maxWidth: 380 }}>
          {state.reason}
        </div>
      )}

      {state.status === 'ready' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {STICKER_EFFECTS.map(eff => {
            const on = eff.key === current;
            return (
              <button
                key={eff.key}
                type="button"
                disabled={busy}
                onClick={() => onChange && onChange(eff.key)}
                aria-pressed={on}
                title={eff.label}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                  padding: 6, borderRadius: 10, cursor: busy ? 'default' : 'pointer',
                  background: on ? 'rgba(0,229,255,.10)' : 'transparent',
                  border: `1px solid ${on ? 'rgba(0,229,255,.45)' : 'var(--border)'}`,
                  opacity: busy ? 0.6 : 1,
                  transition: 'border-color .15s, background .15s',
                  fontFamily: 'inherit',
                }}
              >
                {/* ⚠ A CHEQUER, NOT A FLAT FILL. These are transparent PNGs and
                    the band colour flips with the artwork; on a plain dark tile
                    a dark band is invisible and the artist would think the
                    option does nothing. The chequer shows transparency AS
                    transparency, which is what they are choosing between. */}
                <span style={{
                  width: 56, height: 56, borderRadius: 7, overflow: 'hidden',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: '#8b8b96',
                  backgroundImage:
                    'linear-gradient(45deg,#6f6f7a 25%,transparent 25%),' +
                    'linear-gradient(-45deg,#6f6f7a 25%,transparent 25%),' +
                    'linear-gradient(45deg,transparent 75%,#6f6f7a 75%),' +
                    'linear-gradient(-45deg,transparent 75%,#6f6f7a 75%)',
                  backgroundSize: '10px 10px',
                  backgroundPosition: '0 0,0 5px,5px -5px,-5px 0',
                }}>
                  <img
                    src={state.previews[eff.key]}
                    alt=""
                    style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }}
                  />
                </span>
                <span style={{
                  fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6,
                  textTransform: 'uppercase',
                  color: on ? 'var(--neon2, #00E5FF)' : 'var(--muted)',
                }}>
                  {eff.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
