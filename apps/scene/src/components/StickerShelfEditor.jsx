/**
 * THE STICKER SHELF, in the artist's own kit.
 * ---------------------------------------------------------------------------
 * ⭐⭐ STICKERS ARE PICTURES AND MUST BE SHOWN AS PICTURES. The row used to list
 * them as filenames — "yespleezbig.png · IMG_4398.png · YesPleez Hand Logo
 * trnspt2.png" — which tells the owner nothing about what a collector will
 * actually see, and nothing about which file is which. Nobody recognises their
 * own logo by its export name.
 *
 * ⛔⛔ AND THE EFFECT IS PER FILE, NOT PER ROW. LOGO_PACK is a `many` type, so
 * one profile holds several stickers and each carries its OWN `sticker_effect`.
 * The first version pointed the picker at `files[0]` and therefore styled a
 * file the owner had not chosen and reported the alpha gate for a file they
 * were not looking at — a flat export in slot one made the whole row claim
 * effects were unavailable. Selecting the thumbnail is what makes the picker
 * mean anything.
 *
 * ⚠ EACH THUMBNAIL RENDERS ITS OWN EFFECT, so the shelf here is a true preview
 * of the shelf on the event page. A grid of raw logos would hide the very
 * thing this screen exists to control.
 */

import { useEffect, useState } from 'react';
import { assetUrl } from '../lib/profileAssetStore';
import { renderSticker, loadStickerImage, hasAlpha, PROBE_MAX } from '../lib/stickerEffects';
import StickerEffectPicker from './StickerEffectPicker';

const THUMB = 190;   // render size; displayed at 54px

export default function StickerShelfEditor({ files, accent, busy, onEffect, onRemove }) {
  const [selectedId, setSelectedId] = useState(null);
  const [urls, setUrls] = useState({});

  /* Sign every file, not only the selected one — the thumbnails are all on
     screen at once, so signing lazily would pop them in one at a time. */
  useEffect(() => {
    let alive = true;
    (async () => {
      const next = {};
      for (const f of files) {
        if (!f.storage_path) continue;
        try { next[f.id] = await assetUrl(f.storage_path); } catch { /* dropped below */ }
      }
      if (alive) setUrls(next);
    })();
    return () => { alive = false; };
  }, [files.map(f => f.id).join(',')]);   // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ⭐⭐ THE DEFAULT SELECTION PREFERS A STICKER THAT CAN ACTUALLY TAKE AN
   * EFFECT (owner, 2026-09-03: "the previews aren't there").
   *
   * ⛔ IT USED TO BE files[0], AND THAT MADE A WORKING FEATURE LOOK BROKEN.
   * Every effect keys off the alpha channel, so landing on a flat export shows
   * the "no transparent background" notice and no previews at all — which
   * reads as the picker being dead rather than as this one file being
   * unsuitable. Production shipped with `yespleezbig.png` in slot one and that
   * is exactly what happened.
   *
   * ⚠ Only ever the DEFAULT. An explicit choice is never overridden, including
   * an explicit choice of a flat file — the notice is the right answer then,
   * because the reader asked about that file.
   */
  const [alphaById, setAlphaById] = useState({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const seen = {};
      for (const f of files) {
        const u = urls[f.id];
        if (!u) continue;
        try {
          const img = await loadStickerImage(u);
          if (!alive) return;
          /* Bounded — the question is only "is any of this transparent", and a
             smaller copy answers it just as well as a 4000px original. */
          const s = Math.min(1, PROBE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * s));
          c.height = Math.max(1, Math.round(img.naturalHeight * s));
          const cx = c.getContext('2d');
          cx.drawImage(img, 0, 0, c.width, c.height);
          seen[f.id] = hasAlpha(cx.getImageData(0, 0, c.width, c.height).data);
        } catch {
          seen[f.id] = null;      // unreadable — neither usable nor disqualified
        }
      }
      if (alive) setAlphaById(seen);
    })();
    return () => { alive = false; };
  }, [urls, files]);

  useEffect(() => {
    if (selectedId) return;                       // ⛔ never override a choice
    const usable = files.find(f => alphaById[f.id]);
    if (usable) setSelectedId(usable.id);
  }, [alphaById, selectedId, files]);

  // The selection follows the files: a removed selection falls back to the
  // first remaining sticker rather than leaving the picker pointed at nothing.
  const selected = files.find(f => f.id === selectedId) || files[0] || null;

  if (!files.length) return null;

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{
        fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1.1,
        color: 'var(--faint, #5A5A66)', marginBottom: 7,
      }}>
        YOUR STICKERS
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {files.map(f => (
          <StickerThumb
            key={f.id}
            file={f}
            url={urls[f.id]}
            selected={selected?.id === f.id}
            accent={accent}
            onSelect={() => setSelectedId(f.id)}
          />
        ))}
      </div>

      {selected && (
        <>
          <div style={{
            fontSize: 11, color: 'var(--muted)', marginTop: 8,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {selected.file_name}
            {files.length > 1 && (
              <button
                type="button"
                onClick={() => onRemove && onRemove(selected)}
                disabled={busy}
                style={{
                  marginLeft: 10, padding: 0, border: 'none', background: 'none',
                  color: 'var(--muted)', cursor: busy ? 'default' : 'pointer',
                  fontFamily: "'Bebas Neue'", fontSize: 11, letterSpacing: 1,
                  textDecoration: 'underline',
                }}
              >
                REMOVE
              </button>
            )}
          </div>

          {urls[selected.id] && (
            <StickerEffectPicker
              url={urls[selected.id]}
              value={selected.sticker_effect || 'NONE'}
              onChange={key => onEffect && onEffect(selected, key)}
              busy={busy}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * One sticker, rendered with whatever effect it carries.
 *
 * ⛔ THE RAW LOGO IS THE FALLBACK, never an empty frame. A logo that cannot be
 * composited — no alpha, a tainted canvas — still has to be recognisable here,
 * because this is the only place the owner can tell their three files apart.
 */
function StickerThumb({ file, url, selected, accent, onSelect }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!url) { setSrc(null); return; }
    if (!file.sticker_effect) { setSrc(url); return; }
    (async () => {
      try {
        const img = await loadStickerImage(url);
        if (alive) setSrc(renderSticker(img, file.sticker_effect, { size: THUMB }).toDataURL('image/png'));
      } catch {
        if (alive) setSrc(url);
      }
    })();
    return () => { alive = false; };
  }, [url, file.sticker_effect]);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={file.file_name}
      style={{
        width: 54, height: 54, padding: 3, borderRadius: 9, cursor: 'pointer',
        border: `1px solid ${selected ? accent : 'var(--border)'}`,
        background: selected ? `${accent}1A` : 'var(--card2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'border-color .15s, background .15s',
      }}
    >
      {/* ⚠ A CHEQUER UNDER THE ARTWORK. These are transparent PNGs and the
          effect band flips between white and dark depending on the logo; on a
          flat tile one of those two is always invisible. */}
      <span style={{
        width: '100%', height: '100%', borderRadius: 6, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#8b8b96',
        backgroundImage:
          'linear-gradient(45deg,#6f6f7a 25%,transparent 25%),' +
          'linear-gradient(-45deg,#6f6f7a 25%,transparent 25%),' +
          'linear-gradient(45deg,transparent 75%,#6f6f7a 75%),' +
          'linear-gradient(-45deg,transparent 75%,#6f6f7a 75%)',
        backgroundSize: '8px 8px',
        backgroundPosition: '0 0,0 4px,4px -4px,-4px 0',
      }}>
        {src && <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }} />}
      </span>
    </button>
  );
}
