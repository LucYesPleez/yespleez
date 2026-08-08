import { useEffect, useRef } from 'react';
import s from './TourDemos.module.css';

/**
 * REAL SCREENSHOTS, NOT RECREATIONS — see the file-level note in
 * TourDemos.module.css for the two things that used to live here instead (a
 * scripted typing/scrolling animation, then a CSS mockup) and why each was
 * replaced. Owner supplied actual signed-in captures of both screens
 * (Photoshop exports → WebP, public/tour-demos/*.webp); these components
 * just place and animate them.
 */

/**
 * ⚠⚠ ONE COMPONENT FOR BOTH SCREENS, because the behaviour is identical and
 * only the source image differs: show the real screenshot at full width
 * (never cropped sideways — see the `object-fit: cover` note this replaced),
 * scroll it down through itself and back on a loop, feather its top and
 * bottom edges into the dim around it.
 *
 * ⚠ THE FEATHER IS WHAT STOPS IT LOOKING "PLASTERED ON". A screenshot is a
 * flat, fully-lit rectangle; everything else on screen at this moment is
 * dimmed by the tour's veil. Butt the two together with a hard edge and the
 * image reads as a sticker dropped on top of the app rather than a part of
 * it — exactly the complaint this exists to fix. `mask-image` fades the top
 * ~10% and bottom ~14% of the image to transparent, so it dissolves into the
 * surrounding dim instead of ending in a visible line. Slightly asymmetric
 * (more at the bottom) because that edge sits closer to the card, where the
 * eye is about to land next.
 *
 * ⚠ THE SCROLL DISTANCE IS MEASURED, NOT GUESSED. How far there is to scroll
 * depends on the image's RENDERED height (which changes with the lift rect's
 * width) against the CONTAINER's height (which changes with the card above
 * it) — both unknown until the image has actually laid out. A fixed pixel
 * distance would stop short of the bottom on some devices and overshoot on
 * others.
 */
function ScrollingScreenshot({ src }) {
  const wrapRef = useRef(null);
  const imgRef = useRef(null);

  useEffect(() => {
    const wrap = wrapRef.current, img = imgRef.current;
    if (!wrap || !img) return undefined;

    const measure = () => {
      const overflow = Math.max(0, img.offsetHeight - wrap.offsetHeight);
      wrap.style.setProperty('--scroll-y', `${overflow}px`);
    };

    if (img.complete) measure(); else img.addEventListener('load', measure);
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    window.addEventListener('resize', measure);
    return () => {
      img.removeEventListener('load', measure);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div className={s.screen} ref={wrapRef}>
      <img ref={imgRef} className={s.shot} src={src} alt="" aria-hidden="true" />
    </div>
  );
}

/** PAGE 2 — MY SCENE. Cropped clear of the app's own header banner
 *  (public/tour-demos/myscene.webp starts at "MY SCENE", not "YESPLEEZ ·
 *  BETA") — that row is real, live chrome elsewhere on screen already; a
 *  second copy of it inside the screenshot would be the same "plastered"
 *  problem one level up. */
export function MySceneReelDemo() {
  return <ScrollingScreenshot src="/tour-demos/myscene.webp" />;
}

/**
 * PAGE 5 — INDUSTRY.
 *
 * ⚠ A SCREENSHOT DESPITE THE REAL PAGE RENDERING FINE, and the reason is
 * worth keeping. `/industry/venue` DOES load for a guest — it just loads
 * empty: "Set up your profile", 0 events, 0 enquiries, no upcoming. The
 * dashboard shows the SIGNED-IN user's own venue, so there is no way to
 * show it populated to someone who is not that venue. (Elbows Rest's public
 * profile at /profile/<id>?type=venue is real and guest-visible, but it is
 * a public profile, not the management surface this step's copy describes.)
 * So: the owner's own capture of the real Elbows Rest dashboard — 24
 * events, 4 enquiries, 10 available dates.
 */
export function IndustryDashboardDemo() {
  return <ScrollingScreenshot src="/tour-demos/industry.webp" />;
}

/**
 * PAGE 4 — MESSAGES.
 *
 * ⚠ NOT CROPPED THE SAME WAY AS MY SCENE, and that is correct, not an
 * inconsistency. public/tour-demos/messages.webp arrived pre-cropped —
 * owner had already removed the app's global header banner in Photoshop
 * before saving it, so the export starts at "MESSAGES" itself. An earlier
 * version of this cropped a further 65px off, assuming the same redundant
 * banner as My Scene's export and cutting the real "MESSAGES" heading along
 * with it. Each screenshot's crop depends on what it was exported WITH —
 * check the actual top of the file before assuming.
 */
export function MessagesChatDemo() {
  return <ScrollingScreenshot src="/tour-demos/messages.webp" />;
}
