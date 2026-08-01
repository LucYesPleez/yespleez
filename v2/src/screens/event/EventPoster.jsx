// § 11 · Official Poster & Collectables — THE LAST SECTION ON THE PAGE
//
// Spec: docs/event-page-layout-spec.md § 0, § 11
//
// Moved to the bottom 2026-08-01. It answers none of the decision questions —
// the Hero, Lineup and summary card did that work long before the reader
// arrives — and what it offers is "keep this artwork", which is the last thing
// to offer, after who is behind the event and how we know.
//
// It is framed as the event's COLLECTABLES section, not just its poster. The
// poster is the first and currently only collectable; the heading is already
// plural so that adding more later is an addition, not a rename. Nothing about
// a wider collectables feature is designed here — that is deliberately out of
// scope, and this section simply treats the poster as something collectable.
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

import { useState, useEffect } from 'react';
import { CollectIcon, ExpandIcon, DownloadIcon } from './eventIcons';
import s from './EventSections.module.css';

export default function EventPoster({
  poster = null,
  collectables = [],
  collected = false,
  onToggleCollect = null,
}) {
  const [viewing, setViewing] = useState(false);

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
      <div className={s.headRow}><h2 className={s.heading}>OFFICIAL POSTER &amp; COLLECTABLES</h2></div>

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

      {/* ── Under the poster: the other official images and stickers ──────
          Each saves to the reader's device. Distinct from COLLECT above:
          collecting a poster keeps it in the collector's YesPleez profile,
          saving a sticker puts the file on their phone. Two different verbs
          with two different destinations, so they do not share a control. */}
      {items.length > 0 && (
        <div className={s.collectables}>
          {items.map(item => (
            <a
              key={item.id || item.url}
              className={s.collectable}
              href={item.url}
              download={item.filename || ''}
              // Cross-origin hrefs ignore `download` and open instead, which is
              // still a usable outcome — the reader can long-press to save.
              target="_blank"
              rel="noopener noreferrer"
              title={item.alt || 'Save to your device'}
            >
              <img className={s.collectableImg} src={item.url} alt={item.alt || ''} loading="lazy" />
              {/* Revealed on hover for mouse users, always visible on touch —
                  see the pointer query in the stylesheet. A hover-only
                  affordance is invisible on the device most people are on. */}
              <span className={s.collectableSave}>
                <DownloadIcon size={14} /> SAVE
              </span>
            </a>
          ))}
        </div>
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
