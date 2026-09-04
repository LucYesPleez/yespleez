// § 11 · Official Poster & Collectables — THE LAST SECTION ON THE PAGE
//
// Spec: docs/event-page-layout-spec.md § 0, § 11
//
// Moved to the bottom 2026-08-01. It answers none of the decision questions —
// the Hero, Lineup and summary card did that work long before the reader
// arrives — and what it offers is "keep this artwork", which is the last thing
// to offer, after who is behind the event and how we know.
//
// ⚠ THE HEADING IS "OFFICIAL POSTER" (owner, 2026-08-04). It previously read
// "OFFICIAL POSTER & COLLECTABLES", pluralised in advance so that adding more
// collectables later would be an addition rather than a rename. That bet did
// not pay: the poster is still the only collectable, and a heading naming a
// category with one member in it promises a shelf that isn't there.
//
// The section still TREATS the poster as something collectable — COLLECT
// POSTER, the logo shelf below it, `buildCollectables` — and none of that
// changed. Only the label did. If a second kind of collectable ever lands,
// renaming this back is a one-line change and a far smaller cost than the
// heading having over-promised in the meantime.
//
// The canonical artwork. It FITS and is NEVER CROPPED — the exact opposite of
// the Hero, and the whole reason the two were split. Cropping a poster deletes
// content the organiser designed, typically at the edges: dates, lineup,
// ticket source, sponsor marks.
//
// It renders even when the Hero was derived from this same poster (ladder rungs
// 4–6). A crop at the top of the page takes nothing away from the whole artwork
// here — that is the point of having both.
//
// ── Collect ──────────────────────────────────────────────────────────
// Collect is NOT Favourite and NOT Save. Favourite follows an event; Collect
// keeps a poster — digital memorabilia, a permanent artefact on the collector's
// profile. Different verb, different object, different outcome.
//
// They share no iconography: no heart, no bookmark, no star, because every one
// of those reads as "save this event". The word does the work the icon
// deliberately does not.
//
// This is also the page's ONLY image overlay context: image overlays are
// reserved for artefact-level actions, which is why the Favourite moved off the
// Hero and into the Decision block.

import { useState, useEffect, useRef } from 'react';
import { CollectIcon, ExpandIcon, DownloadIcon } from './eventIcons';
import s from './EventSections.module.css';
import { renderSticker, loadStickerImage } from '../../lib/stickerEffects';
import {
  saveStickerToDevice, renderStickerFile, isAppleTouchDevice,
} from '../../lib/saveSticker';

export default function EventPoster({
  poster = null,
  collectables = [],
  collected = false,
  onToggleCollect = null,
}) {
  const [viewing, setViewing] = useState(false);
  /* 'share' | 'download' | null — which route the last sticker save actually
     took. ⚠ It is the ROUTE, not a boolean: the Photos instructions below are
     only true of the share sheet, and a desktop download must not claim them. */
  const [savedVia, setSavedVia] = useState(null);

  // Escape closes the viewer. A full-screen overlay with no keyboard exit is a
  // trap for anyone not using a mouse.
  useEffect(() => {
    if (!viewing) return;
    const onKey = e => { if (e.key === 'Escape') setViewing(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewing]);

  const items = (collectables || []).filter(c => c && c.url);

  // R1 · absent. No poster and no collectables means there is nothing to keep.
  if (!poster?.url && !items.length) return null;

  return (
    <section className={s.card}>
      <div className={s.headRow}><h2 className={s.heading}>OFFICIAL POSTER</h2></div>

      {poster?.url && <>
        <div className={s.posterFrame}>
          <img
            className={s.poster}
            src={poster.url}
            alt={poster.alt || 'Official event poster'}
            loading="lazy"
            onClick={() => setViewing(true)}
          />
        </div>

        <div className={s.posterActions}>
          {onToggleCollect && (
            <button
              className={s.collect + (collected ? ' ' + s.collected : '')}
              onClick={onToggleCollect}
              aria-pressed={collected}
            >
              <CollectIcon size={15} />
              {collected ? 'COLLECTED' : 'COLLECT POSTER'}
            </button>
          )}
          <button className={s.linkRow} style={{ flex: '0 0 auto', width: 'auto' }}
            onClick={() => setViewing(true)} aria-label="View poster full size">
            <ExpandIcon />
          </button>
        </div>
      </>}

      {/* ── STICKERS — the logos of everyone on this event ────────────────
          Each saves to the reader's device. Distinct from COLLECT above:
          collecting a poster keeps it in the collector's YesPleez profile,
          saving a sticker puts the file on their phone. Two different verbs
          with two different destinations, so they do not share a control.

          ⚠ THE SHELF IS NAMED NOW (owner, 2026-09-02: "stickers are just the
          logos, poster stays the poster"). It was unlabelled, so the word
          "collectables" lived only in the code and no reader ever met it —
          renaming without a heading would have changed nothing on screen.

          ⭐ This does NOT reopen 2026-08-04, when the section heading went
          from "OFFICIAL POSTER & COLLECTABLES" back to "OFFICIAL POSTER"
          because a plural heading promised a shelf that was not there. The
          shelf IS here, and it now carries its own name instead of sharing
          the poster's — which is the thing that heading could not do. ⛔ The
          poster is not a sticker; two objects, two names, two verbs. */}
      {items.length > 0 && (
        <>
        <div className={s.headRow}><h3 className={s.subHeading}>STICKERS</h3></div>
        <div className={s.collectables}>
          {items.map(item => (
            <StickerTile key={item.id || item.url} item={item} onSaved={setSavedVia} />
          ))}
        </div>
        {/* ── HOW IT BECOMES A MESSAGES STICKER ─────────────────────────────
            ⛔⛔ NOTHING ON THE WEB CAN PUT A FILE IN THE MESSAGES STICKER
            DRAWER. iOS fills that drawer from Photos, Memoji and native
            sticker-pack extensions, and offers no API to a page. The sheet
            gets the PNG into Photos; the last step is iOS's own, and the only
            honest thing to do is say what it is.

            ⚠ SHOWN AFTER THE SHARE, NOT BEFORE. As standing copy it is a
            three-step instruction attached to a shelf most readers will just
            tap; after a save it is the answer to the question they now have.
            It stays put once shown, because it is a recipe, not a toast. */}
        {savedVia === 'share' && isAppleTouchDevice() && (
          <p className={s.stickerHint}>
            Saved. Choose Save Image, then touch and hold the sticker in Photos
            and tap Add Sticker to keep it in Messages.
          </p>
        )}
        </>
      )}

      {/* Full resolution, whole. Being able to see all of it is what makes the
          poster an artefact rather than a thumbnail. */}
      {viewing && (
        <div className={s.viewer} onClick={() => setViewing(false)} role="dialog" aria-modal="true">
          <img className={s.viewerImage} src={poster.url} alt={poster.alt || 'Official event poster'} />
        </div>
      )}
    </section>
  );
}

/**
 * ONE STICKER ON THE SHELF.
 *
 * ⭐⭐ THE TILE RENDERS THE EFFECT, AND SO DOES THE SAVE. Those are the same
 * pixels produced by the same function at two sizes — if the tile were a CSS
 * filter over the raw <img>, the collector would tap a puffy sticker and be
 * handed a flat logo. Whatever is shown is what is saved.
 *
 * ⚠ IT IS A BUTTON, NOT A LINK, and that is a fix rather than a preference.
 * The old markup was `<a href={signedUrl} download>`, and `download` is IGNORED
 * cross-origin — Supabase storage is another origin, so SAVE opened a tab and
 * left the reader to long-press. See lib/saveSticker.
 *
 * ⛔ THE RAW LOGO IS THE FALLBACK, NEVER A BLANK TILE. If the render fails —
 * a tainted canvas, a logo that will not load — the plain artwork still shows.
 * A sticker shelf with a hole in it reads as broken (R4: broken ≠ sparse);
 * an unstyled logo reads as a logo.
 *
 * ⚠⚠ THE SAVE FILE IS RENDERED ON POINTERDOWN, NOT ON CLICK, and that ordering
 * is the whole reason the share sheet opens at all on an iPhone. Compositing a
 * 1024px PNG takes longer than iOS keeps the tap's transient activation alive,
 * so awaiting the render inside the click handler throws NotAllowedError and
 * drops the reader back to a Files download. `pointerdown` fires first and
 * gives the render a head start; the click then has the file already. See the
 * header of lib/saveSticker. ⛔ Do not "simplify" this back into onSave.
 */
function StickerTile({ item, onSaved }) {
  const [src, setSrc] = useState(item.url);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /* The composited PNG, and the in-flight render that produces it. Two refs
     rather than state: neither one paints anything, and re-rendering the tile
     mid-gesture is exactly what we are trying to avoid. */
  const fileRef = useRef(null);
  const warmingRef = useRef(null);

  /* ⚠ A WARMED FILE BELONGS TO ONE ARTWORK AND ONE EFFECT. Without this the
     shelf would hand over the previous effect's pixels after a change in the
     editor, which is the failure the tile's own render was built to prevent. */
  useEffect(() => {
    fileRef.current = null;
    warmingRef.current = null;
  }, [item?.url, item?.effect]);

  useEffect(() => {
    let alive = true;
    if (!item?.url || !item.effect) { setSrc(item?.url || null); return; }
    (async () => {
      try {
        const img = await loadStickerImage(item.url);
        if (!alive) return;
        // Tile-sized: the shelf cell is 84px, so rendering at save resolution
        // here would be six full-size composites nobody looks at.
        setSrc(renderSticker(img, item.effect, { size: 220 }).toDataURL('image/png'));
      } catch {
        if (alive) setSrc(item.url);
      }
    })();
    return () => { alive = false; };
  }, [item?.url, item?.effect]);

  /** Start compositing now, or return the render already in flight. */
  function warm() {
    if (fileRef.current) return Promise.resolve(fileRef.current);
    if (!warmingRef.current) {
      warmingRef.current = renderStickerFile(item).then(file => {
        fileRef.current = file;
        return file;
      });
    }
    return warmingRef.current;
  }

  async function onSave() {
    if (busy) return;
    setFailed(false);
    /* ⛔ NO `setBusy(true)` BEFORE THE SHARE ON THE WARM PATH. A state update
       here re-renders the tile and disables the button underneath the gesture,
       and Safari treats that as the activation ending. The spinner is only
       worth having when there is actually a wait, which is the cold path. */
    const file = fileRef.current || (setBusy(true), await warm());
    const res = await saveStickerToDevice(item, { file });
    /* ⭐ A DISMISSED SHARE SHEET IS NOT A FAILURE — see saveStickerToDevice. */
    if (res.saved) onSaved?.(res.method);
    else if (!res.cancelled) setFailed(true);
    setBusy(false);
  }

  return (
    <button
      type="button"
      className={s.collectable}
      onPointerDown={warm}
      onClick={onSave}
      disabled={busy}
      title={failed ? 'That sticker could not be saved' : (item.alt || 'Save to your device')}
      aria-label={`Save ${item.alt || 'sticker'} to your device`}
    >
      {src && <img className={s.collectableImg} src={src} alt={item.alt || ''} loading="lazy" />}
      {/* Revealed on hover for mouse users, always visible on touch — see the
          pointer query in the stylesheet. A hover-only affordance is invisible
          on the device most people are on. */}
      <span className={s.collectableSave}>
        <DownloadIcon size={14} /> {busy ? '…' : failed ? 'RETRY' : 'SAVE'}
      </span>
    </button>
  );
}
