// Event Hero — the Event Cover.
//
// Spec: docs/event-page-layout-spec.md §0, §1
//
// ── What this is ─────────────────────────────────────────────────────
// The Cover sells the experience; the Poster preserves the artwork. This is
// the Cover's surface and the only one it has: Cover and Gallery images render
// here and nowhere else on the page. The Poster is never a slide — it has § 9,
// where it renders whole.
//
// The frame is a FIXED cinematic aspect that images fill and may crop. That is
// the whole difference from the superseded Version 1, which derived the frame
// from a portrait poster and pillarboxed it. Cropping atmosphere costs nothing;
// cropping artwork deletes what the organiser designed, which is why the two
// were split.
//
// No overlaid controls. Image overlays are reserved for artefact-level actions
// (Collect, on the poster); the Favourite is an event-level action and lives in
// the Decision block. Exactly one overlaid control exists on the page, and it
// is not here.

import { useState, useRef } from 'react';
import { resolveHeroMedia } from './heroMedia';
import s from './EventHero.module.css';

export default function EventHero({
  cover = null,
  gallery = [],
  landscapeArtwork = null,
  poster = null,
  posterCropY = null,
  alt = '',
}) {
  const [active, setActive] = useState(0);
  const trackRef = useRef(null);

  // The rung is decided ONCE, against the desktop frame, and does not vary by
  // viewport — otherwise the same event could show a cropped poster on desktop
  // and a blurred one on mobile, which would read as a bug to anyone who
  // checked their event on both.
  const media = resolveHeroMedia({ cover, gallery, landscapeArtwork, poster, posterCropY });

  // R1 · absent. Nothing to show is not an empty state to decorate: the Hero
  // does not render, and the layout gives Band A's width back to the summary.
  if (!media) return null;

  if (media.mode === 'crop') {
    return (
      <div className={s.hero}>
        <img
          className={`${s.image} ${s.cropped}`}
          style={{ '--yp-hero-crop-y': `${media.cropY}%` }}
          src={media.slide.url}
          alt={alt}
        />
      </div>
    );
  }

  if (media.mode === 'blur') {
    return (
      <div className={s.hero}>
        <img className={`${s.image} ${s.blurred}`} src={media.slide.url} alt="" aria-hidden="true" />
        <div className={s.blurScrim} />
      </div>
    );
  }

  const { slides } = media;
  const multiple = slides.length > 1;

  function onScroll() {
    const el = trackRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== active) setActive(i);
  }

  if (!multiple) {
    return (
      <div className={s.hero}>
        <img className={s.image} src={slides[0].url} alt={slides[0].alt || alt} />
      </div>
    );
  }

  return (
    <div className={s.hero}>
      <div className={s.track} ref={trackRef} onScroll={onScroll}>
        {slides.map((img, i) => (
          <div className={s.slide} key={img.url}>
            <img
              className={s.image}
              src={img.url}
              alt={i === 0 ? (img.alt || alt) : (img.alt || '')}
              loading={i === 0 ? 'eager' : 'lazy'}
            />
          </div>
        ))}
      </div>

      <div className={s.dots} aria-hidden="true">
        {slides.map((img, i) => (
          <span key={img.url} className={s.dot + (i === active ? ' ' + s.dotOn : '')} />
        ))}
      </div>
    </div>
  );
}
